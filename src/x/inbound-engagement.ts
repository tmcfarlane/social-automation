import type { Browser } from "playwright";
import { ensureBrowser } from "./ensure-chrome.js";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import type { Config } from "../config";
import { loadConfig } from "../config";
import { generateReply, appendCostLog, type ReplyUsage } from "../llm/claude-client";
import { loginCheck } from "./login-check";
import { typeReply } from "./type-reply";
import { submitReply } from "./submit-reply";
import { verifyReply } from "./verify-reply";
import { hasOurReply } from "./thread-guard";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Mention {
  handle: string;
  author: string;
  text: string;
  links: string[];       // URLs extracted from their tweet
  parentText: string;    // text of the tweet they were replying to
  parentLinks: string[]; // URLs from the parent tweet
  tweetUrl: string;
  timestamp: string;
}

interface InboundResult {
  tweetUrl: string;
  handle: string;
  theirText: string;
  replyText: string;
  verified: boolean;
}

interface InboundState {
  mode: "aggressive" | "idle";
  last_scan_time: string;
  last_reply_found_time: string;
  aggressive_window_start: string;
  total_replies_posted_today: number;
  last_date: string;
}

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

const STATE_PATH = "C:\\Users\\Trent\\rep\\COMMAND CENTER\\Command Center\\SocialMediaEngine\\X\\state\\x-inbound-state.json";
const LOG_DIR = "C:\\Users\\Trent\\rep\\COMMAND CENTER\\Command Center\\SocialMediaEngine\\X\\replies";
const MY_HANDLE = "hodlmecloseplz";
const MAX_REPLIES_PER_SESSION = 5;
const SAFETY_LIMIT = 100;

function log(obj: Record<string, unknown>): void {
  console.log(JSON.stringify({ ts: new Date().toISOString(), ...obj }));
}

function readVoiceGuide(filePath: string): string {
  try {
    return fs.readFileSync(filePath, "utf-8");
  } catch {
    console.warn(`[inbound] Voice guide not found at ${filePath} — using default`);
    return "Write in a direct, conversational tone. Be genuinely helpful and insightful.";
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// State management
// ---------------------------------------------------------------------------

function loadState(): InboundState {
  try {
    const raw = fs.readFileSync(STATE_PATH, "utf-8");
    return JSON.parse(raw) as InboundState;
  } catch {
    return {
      mode: "aggressive",
      last_scan_time: new Date(0).toISOString(),
      last_reply_found_time: new Date(0).toISOString(),
      aggressive_window_start: new Date().toISOString(),
      total_replies_posted_today: 0,
      last_date: new Date().toISOString().slice(0, 10),
    };
  }
}

function saveState(state: InboundState): void {
  try {
    fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
    fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2), "utf-8");
  } catch (err) {
    console.warn(`[inbound] Failed to save state: ${err}`);
  }
}

function shouldSkip(state: InboundState): { skip: boolean; reason?: string } {
  const now = Date.now();
  const lastScan = new Date(state.last_scan_time).getTime();
  const minutesSince = (now - lastScan) / 60_000;

  if (state.mode === "aggressive" && minutesSince < 25) {
    return { skip: true, reason: `Aggressive mode, last scan ${Math.round(minutesSince)}min ago` };
  }
  if (state.mode === "idle" && minutesSince < 55) {
    return { skip: true, reason: `Idle mode, next scan in ${Math.round(55 - minutesSince)}min` };
  }
  return { skip: false };
}

function updateStateAfterRun(
  state: InboundState,
  repliesFound: number,
  repliesPosted: number
): InboundState {
  const now = new Date().toISOString();
  const today = now.slice(0, 10);

  // Reset daily counter if date changed
  const totalToday =
    state.last_date !== today ? repliesPosted : state.total_replies_posted_today + repliesPosted;

  const aggressiveWindowAge =
    (Date.now() - new Date(state.aggressive_window_start).getTime()) / 60_000;

  let mode: "aggressive" | "idle" = state.mode;
  let aggressiveWindowStart = state.aggressive_window_start;

  if (repliesFound > 0) {
    mode = "aggressive";
    aggressiveWindowStart = now;
  } else if (state.mode === "aggressive" && aggressiveWindowAge >= 30) {
    mode = "idle";
  }

  return {
    mode,
    last_scan_time: now,
    last_reply_found_time: repliesFound > 0 ? now : state.last_reply_found_time,
    aggressive_window_start: aggressiveWindowStart,
    total_replies_posted_today: totalToday,
    last_date: today,
  };
}

// ---------------------------------------------------------------------------
// Log to file
// ---------------------------------------------------------------------------

function appendToLog(results: InboundResult[]): void {
  if (results.length === 0) return;

  const today = new Date().toISOString().slice(0, 10);
  const logPath = path.join(LOG_DIR, `${today}.md`);

  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });

    let existing = "";
    try {
      existing = fs.readFileSync(logPath, "utf-8");
    } catch {
      existing = `# X Reply Engagement Log\n**Date:** ${today}\n**Account:** @${MY_HANDLE}\n\n`;
    }

    const entryNum = (existing.match(/^## REPLY \[/gm) ?? []).length;

    const entries = results.map((r, i) =>
      [
        `## REPLY [${entryNum + i + 1}]`,
        `**To:** @${r.handle}`,
        `**Their reply:** "${r.theirText}"`,
        `**Our response:** "${r.replyText}"`,
        `**Thread URL:** ${r.tweetUrl}`,
        `**Time:** ${new Date().toISOString()}`,
        `**Verified:** ${r.verified}`,
      ].join("\n")
    );

    fs.writeFileSync(logPath, existing + entries.join("\n\n") + "\n\n", "utf-8");
    log({ event: "log_written", path: logPath, count: results.length });
  } catch (err) {
    console.warn(`[inbound] Failed to write log: ${err}`);
  }
}

// ---------------------------------------------------------------------------
// Browser
// ---------------------------------------------------------------------------

async function launchBrowser(cdpUrl?: string): Promise<Browser> {
  return ensureBrowser(cdpUrl);
}

// ---------------------------------------------------------------------------
// Scrape mentions from /notifications/mentions
// ---------------------------------------------------------------------------

async function scrapeMentions(
  page: import("playwright").Page
): Promise<Mention[]> {
  log({ event: "scrape_nav_start" });
  await page.goto("https://x.com/notifications/mentions", {
    waitUntil: "domcontentloaded",
    timeout: 30_000,
  });
  log({ event: "scrape_nav_done", url: page.url() });

  // Natural read behaviour: pause then scroll down slowly before extracting
  await page.waitForTimeout(1_500 + Math.random() * 1_000);
  await page.evaluate(() => window.scrollBy(0, 300 + Math.random() * 200));
  await page.waitForTimeout(800 + Math.random() * 600);
  await page.evaluate(() => window.scrollBy(0, 300 + Math.random() * 200));
  await page.waitForTimeout(600 + Math.random() * 400);

  const cards = await page.locator('[data-testid="tweet"]').all().catch(() => []);
  log({ event: "scrape_cards_found", count: cards.length });
  const mentions: Mention[] = [];
  const seen = new Set<string>();

  const T = { timeout: 3_000 };  // for elements that should exist
  const Ts = { timeout: 500 };   // for optional elements (quoted tweets, links) — fail fast

  for (const [cardIdx, card] of cards.slice(0, 10).entries()) {
    log({ event: "scrape_card_start", cardIdx });

    // Occasional mid-scrape scroll to look like a human reading the list
    if (cardIdx > 0 && cardIdx % 3 === 0) {
      await page.evaluate(() => window.scrollBy(0, 250 + Math.random() * 150));
      await page.waitForTimeout(400 + Math.random() * 300);
    }

    try {
      const handle = (
        await card
          .locator('[data-testid="User-Name"] a[href*="/"]')
          .nth(1)
          .getAttribute("href", T)
          .catch(() => "")
      )?.replace("/", "") ?? "";

      log({ event: "scrape_card_handle", cardIdx, handle });

      // Skip our own posts
      if (handle.toLowerCase() === MY_HANDLE.toLowerCase()) continue;

      const author = await card
        .locator('[data-testid="User-Name"] span')
        .first()
        .innerText(T)
        .catch(() => "");

      const textEl = card.locator('[data-testid="tweetText"]').first();
      const text = await textEl.innerText(T).catch(() => "");

      // Extract external hrefs from tweet text links
      const linkEls = await textEl.locator("a").all().catch(() => []);
      const links: string[] = [];
      for (const link of linkEls) {
        const href = await link.getAttribute("href", Ts).catch(() => "");
        if (href && !href.startsWith("/") && !href.includes("twitter.com/") && !href.includes("x.com/")) {
          links.push(href);
        }
      }

      const tweetPath = await card
        .locator("time")
        .first()
        .locator("..")
        .getAttribute("href", T)
        .catch(() => "");

      const tweetUrl = tweetPath ? `https://x.com${tweetPath}` : "";
      if (!tweetUrl || seen.has(tweetUrl)) continue;
      seen.add(tweetUrl);

      const timestamp = await card
        .locator("time")
        .first()
        .getAttribute("datetime", T)
        .catch(() => "");

      // Quoted/parent tweet — only present on some cards, use fast timeout
      const parentEl = card.locator('[data-testid="tweetText"]').nth(1);
      const parentText = await parentEl.innerText(Ts).catch(() => "");
      const parentLinkEls = parentText ? await parentEl.locator("a").all().catch(() => []) : [];
      const parentLinks: string[] = [];
      for (const link of parentLinkEls) {
        const href = await link.getAttribute("href", Ts).catch(() => "");
        if (href && !href.startsWith("/") && !href.includes("twitter.com/") && !href.includes("x.com/")) {
          parentLinks.push(href);
        }
      }

      if (text.trim()) {
        mentions.push({
          handle,
          author: author.trim(),
          text: text.trim(),
          links,
          parentText: parentText.trim(),
          parentLinks,
          tweetUrl,
          timestamp: timestamp ?? "",
        });
      }
    } catch {
      // Skip malformed cards
    }
  }

  return mentions;
}

// ---------------------------------------------------------------------------
// Check if we've already replied in a thread
// ---------------------------------------------------------------------------

async function checkAlreadyReplied(
  page: import("playwright").Page,
  tweetUrl: string
): Promise<boolean> {
  try {
    await page.goto(tweetUrl, { waitUntil: "domcontentloaded", timeout: 15_000 });
    await page.waitForTimeout(2_000);
    return await hasOurReply(page);
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Main orchestrator
// ---------------------------------------------------------------------------

export async function runInboundEngagement(
  config: Config
): Promise<InboundResult[]> {
  const state = loadState();

  // Safety limit
  if (state.total_replies_posted_today >= SAFETY_LIMIT) {
    log({ event: "abort", reason: "safety_limit_reached", total: state.total_replies_posted_today });
    return [];
  }

  // Skip logic
  const skipCheck = shouldSkip(state);
  if (skipCheck.skip) {
    log({ event: "skip", reason: skipCheck.reason });
    return [];
  }

  const voiceGuide = readVoiceGuide(config.VOICE_FILE_PATH);
  const cdpUrl = process.env["CHROME_CDP_URL"];
  const browser = await launchBrowser(cdpUrl);
  const contexts = browser.contexts();
  const context = contexts.length > 0 ? contexts[0] : await browser.newContext();
  const existingPages = context.pages();
  const page = existingPages.length > 0 ? existingPages[0] : await context.newPage();
  const results: InboundResult[] = [];
  const sessionUsage: ReplyUsage = { inputTokens: 0, outputTokens: 0, costUsd: 0, retried: false };
  let mentions: Mention[] = [];

  try {
    // ── Step 1: Login check ────────────────────────────────────────────────
    const loginResult = await loginCheck(page);
    if (!loginResult.success || !loginResult.data) {
      log({ event: "abort", reason: "not_logged_in" });
      saveState(updateStateAfterRun(state, 0, 0));
      return results;
    }
    log({ event: "login_ok" });

    // ── Step 2: Scrape mentions ────────────────────────────────────────────
    mentions = await scrapeMentions(page);
    log({ event: "mentions_found", count: mentions.length });

    if (mentions.length === 0) {
      log({ event: "no_mentions" });
      saveState(updateStateAfterRun(state, 0, 0));
      return results;
    }

    // ── Step 3: Reply to each mention ─────────────────────────────────────
    const repliedHandles = new Set<string>();

    for (const mention of mentions) {
      if (results.length >= MAX_REPLIES_PER_SESSION) break;

      // Never reply to same account twice in a session
      if (repliedHandles.has(mention.handle.toLowerCase())) continue;

      log({ event: "mention_check", handle: mention.handle, tweetUrl: mention.tweetUrl });

      // Check thread: skip if we already have any reply in this thread
      const alreadyReplied = await checkAlreadyReplied(page, mention.tweetUrl);
      if (alreadyReplied) {
        log({ event: "skip_mention", reason: "already_replied", handle: mention.handle });
        continue;
      }

      // Generate reply
      let replyText: string;
      try {
        const parentPart = mention.parentText
          ? `[Original post]: "${mention.parentText}"${mention.parentLinks.length ? `\n[Links in original post]: ${mention.parentLinks.join(", ")}` : ""}\n\n`
          : "";
        const mentionLinks = mention.links.length ? `\n[Links they shared]: ${mention.links.join(", ")}` : "";
        const fullContext = `${parentPart}[Their reply mentioning us]: "${mention.text}"${mentionLinks}`;

        const generated = await generateReply(
          fullContext,
          `${mention.author} (@${mention.handle})`,
          voiceGuide
        );
        replyText = generated.text;
        sessionUsage.inputTokens += generated.usage.inputTokens;
        sessionUsage.outputTokens += generated.usage.outputTokens;
        sessionUsage.costUsd += generated.usage.costUsd;
        if (generated.usage.retried) sessionUsage.retried = true;
        log({ event: "reply_generated", handle: mention.handle, replyText, chars: replyText.length, ...generated.usage });
      } catch (err) {
        log({ event: "reply_generation_failed", handle: mention.handle, error: String(err) });
        continue;
      }

      // Navigate to the tweet and reply
      await page.goto(mention.tweetUrl, { waitUntil: "domcontentloaded", timeout: 15_000 });
      await page.waitForTimeout(1_500);

      const typeResult = await typeReply(page, replyText, mention.tweetUrl);
      if (!typeResult.success) {
        log({ event: "type_failed", handle: mention.handle, error: typeResult.error });
        continue;
      }

      const submitResult = await submitReply(page);
      if (!submitResult.success) {
        log({ event: "submit_failed", handle: mention.handle, error: submitResult.error });
        continue;
      }
      const submitted = submitResult.data?.submitted ?? false;
      log({ event: "submit_done", handle: mention.handle, submitted });
      if (!submitted) {
        log({ event: "skip_verify", reason: "compose_box_never_closed", handle: mention.handle });
        results.push({ tweetUrl: mention.tweetUrl, handle: mention.handle, theirText: mention.text, replyText, verified: false });
        continue;
      }

      const verifyResult = await verifyReply(page, mention.tweetUrl, replyText, MY_HANDLE);
      const verified = verifyResult.data ?? false;

      log({ event: "mention_done", handle: mention.handle, verified });

      results.push({
        tweetUrl: mention.tweetUrl,
        handle: mention.handle,
        theirText: mention.text,
        replyText,
        verified,
      });

      repliedHandles.add(mention.handle.toLowerCase());

      // Pacing delay between replies
      if (results.length < MAX_REPLIES_PER_SESSION) {
        const delay = 15_000 + Math.random() * 15_000;
        log({ event: "pacing_delay", delayMs: Math.round(delay) });
        await sleep(delay);
      }
    }
  } finally {
    await browser.close().catch(() => {});
  }

  // ── Step 4: Log & update state ─────────────────────────────────────────
  log({
    event: "session_complete",
    repliesAttempted: results.length,
    repliesVerified: results.filter((r) => r.verified).length,
    totalInputTokens: sessionUsage.inputTokens,
    totalOutputTokens: sessionUsage.outputTokens,
    totalCostUsd: +sessionUsage.costUsd.toFixed(6),
  });

  appendToLog(results);
  appendCostLog("inbound", sessionUsage, { replies: results.length });
  saveState(updateStateAfterRun(state, mentions.length ?? 0, results.length));

  return results;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

const isMain =
  process.argv[1] != null &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (isMain) {
  const config = loadConfig();
  runInboundEngagement(config)
    .then((results) => {
      const verified = results.filter((r) => r.verified).length;
      console.log(
        `\n[inbound] Session complete — ${verified}/${results.length} replies verified`
      );
      process.exit(0);
    })
    .catch((err) => {
      console.error("[inbound] Fatal error:", err);
      process.exit(1);
    });
}
