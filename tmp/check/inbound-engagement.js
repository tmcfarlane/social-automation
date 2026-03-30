import { chromium } from "playwright";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { loadConfig } from "../config";
import { generateReply, appendCostLog } from "../llm/claude-client";
import { loginCheck } from "./login-check";
import { typeReply } from "./type-reply";
import { submitReply } from "./submit-reply";
import { verifyReply } from "./verify-reply";
const STATE_PATH = "C:\\Users\\Trent\\rep\\COMMAND CENTER\\Command Center\\SocialMediaEngine\\X\\state\\x-inbound-state.json";
const LOG_DIR = "C:\\Users\\Trent\\rep\\COMMAND CENTER\\Command Center\\SocialMediaEngine\\X\\replies";
const MY_HANDLE = "hodlmecloseplz";
const MAX_REPLIES_PER_THREAD = 3;
const MAX_REPLIES_PER_SESSION = 5;
const SAFETY_LIMIT = 100;
function log(obj) {
  console.log(JSON.stringify({ ts: (/* @__PURE__ */ new Date()).toISOString(), ...obj }));
}
function readVoiceGuide(filePath) {
  try {
    return fs.readFileSync(filePath, "utf-8");
  } catch {
    console.warn(`[inbound] Voice guide not found at ${filePath} \u2014 using default`);
    return "Write in a direct, conversational tone. Be genuinely helpful and insightful.";
  }
}
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
function loadState() {
  try {
    const raw = fs.readFileSync(STATE_PATH, "utf-8");
    return JSON.parse(raw);
  } catch {
    return {
      mode: "aggressive",
      last_scan_time: (/* @__PURE__ */ new Date(0)).toISOString(),
      last_reply_found_time: (/* @__PURE__ */ new Date(0)).toISOString(),
      aggressive_window_start: (/* @__PURE__ */ new Date()).toISOString(),
      total_replies_posted_today: 0,
      last_date: (/* @__PURE__ */ new Date()).toISOString().slice(0, 10)
    };
  }
}
function saveState(state) {
  try {
    fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
    fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2), "utf-8");
  } catch (err) {
    console.warn(`[inbound] Failed to save state: ${err}`);
  }
}
function shouldSkip(state) {
  const now = Date.now();
  const lastScan = new Date(state.last_scan_time).getTime();
  const minutesSince = (now - lastScan) / 6e4;
  if (state.mode === "aggressive" && minutesSince < 25) {
    return { skip: true, reason: `Aggressive mode, last scan ${Math.round(minutesSince)}min ago` };
  }
  if (state.mode === "idle" && minutesSince < 55) {
    return { skip: true, reason: `Idle mode, next scan in ${Math.round(55 - minutesSince)}min` };
  }
  return { skip: false };
}
function updateStateAfterRun(state, repliesFound, repliesPosted) {
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const today = now.slice(0, 10);
  const totalToday = state.last_date !== today ? repliesPosted : state.total_replies_posted_today + repliesPosted;
  const aggressiveWindowAge = (Date.now() - new Date(state.aggressive_window_start).getTime()) / 6e4;
  let mode = state.mode;
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
    last_date: today
  };
}
function appendToLog(results) {
  if (results.length === 0) return;
  const today = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
  const logPath = path.join(LOG_DIR, `${today}.md`);
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    let existing = "";
    try {
      existing = fs.readFileSync(logPath, "utf-8");
    } catch {
      existing = `# X Reply Engagement Log
**Date:** ${today}
**Account:** @${MY_HANDLE}

`;
    }
    const entryNum = (existing.match(/^## REPLY \[/gm) ?? []).length;
    const entries = results.map(
      (r, i) => [
        `## REPLY [${entryNum + i + 1}]`,
        `**To:** @${r.handle}`,
        `**Their reply:** "${r.theirText}"`,
        `**Our response:** "${r.replyText}"`,
        `**Thread URL:** ${r.tweetUrl}`,
        `**Time:** ${(/* @__PURE__ */ new Date()).toISOString()}`,
        `**Verified:** ${r.verified}`
      ].join("\n")
    );
    fs.writeFileSync(logPath, existing + entries.join("\n\n") + "\n\n", "utf-8");
    log({ event: "log_written", path: logPath, count: results.length });
  } catch (err) {
    console.warn(`[inbound] Failed to write log: ${err}`);
  }
}
async function launchBrowser(cdpUrl) {
  if (cdpUrl) {
    return chromium.connectOverCDP(cdpUrl);
  }
  return chromium.launch({ headless: false });
}
async function scrapeMentions(page) {
  log({ event: "scrape_nav_start" });
  await page.goto("https://x.com/notifications/mentions", {
    waitUntil: "domcontentloaded",
    timeout: 3e4
  });
  log({ event: "scrape_nav_done", url: page.url() });
  await page.waitForTimeout(1500 + Math.random() * 1e3);
  await page.evaluate(() => window.scrollBy(0, 300 + Math.random() * 200));
  await page.waitForTimeout(800 + Math.random() * 600);
  await page.evaluate(() => window.scrollBy(0, 300 + Math.random() * 200));
  await page.waitForTimeout(600 + Math.random() * 400);
  const cards = await page.locator('[data-testid="tweet"]').all().catch(() => []);
  log({ event: "scrape_cards_found", count: cards.length });
  const mentions = [];
  const seen = /* @__PURE__ */ new Set();
  const T = { timeout: 3e3 };
  const Ts = { timeout: 500 };
  for (const [cardIdx, card] of cards.slice(0, 10).entries()) {
    log({ event: "scrape_card_start", cardIdx });
    if (cardIdx > 0 && cardIdx % 3 === 0) {
      await page.evaluate(() => window.scrollBy(0, 250 + Math.random() * 150));
      await page.waitForTimeout(400 + Math.random() * 300);
    }
    try {
      const handle = (await card.locator('[data-testid="User-Name"] a[href*="/"]').nth(1).getAttribute("href", T).catch(() => ""))?.replace("/", "") ?? "";
      log({ event: "scrape_card_handle", cardIdx, handle });
      if (handle.toLowerCase() === MY_HANDLE.toLowerCase()) continue;
      const author = await card.locator('[data-testid="User-Name"] span').first().innerText(T).catch(() => "");
      const textEl = card.locator('[data-testid="tweetText"]').first();
      const text = await textEl.innerText(T).catch(() => "");
      const linkEls = await textEl.locator("a").all().catch(() => []);
      const links = [];
      for (const link of linkEls) {
        const href = await link.getAttribute("href", Ts).catch(() => "");
        if (href && !href.startsWith("/") && !href.includes("twitter.com/") && !href.includes("x.com/")) {
          links.push(href);
        }
      }
      const tweetPath = await card.locator("time").first().locator("..").getAttribute("href", T).catch(() => "");
      const tweetUrl = tweetPath ? `https://x.com${tweetPath}` : "";
      if (!tweetUrl || seen.has(tweetUrl)) continue;
      seen.add(tweetUrl);
      const timestamp = await card.locator("time").first().getAttribute("datetime", T).catch(() => "");
      const parentEl = card.locator('[data-testid="tweetText"]').nth(1);
      const parentText = await parentEl.innerText(Ts).catch(() => "");
      const parentLinkEls = parentText ? await parentEl.locator("a").all().catch(() => []) : [];
      const parentLinks = [];
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
          timestamp: timestamp ?? ""
        });
      }
    } catch {
    }
  }
  return mentions;
}
async function countOurRepliesInThread(page, tweetUrl) {
  try {
    await page.goto(tweetUrl, { waitUntil: "domcontentloaded", timeout: 15e3 });
    await page.waitForTimeout(1500);
    const cards = await page.locator('[data-testid="tweet"]').all().catch(() => []);
    let count = 0;
    for (const card of cards.slice(1)) {
      const handleHref = await card.locator('[data-testid="User-Name"] a[href*="/"]').nth(1).getAttribute("href").catch(() => "");
      if (handleHref?.replace("/", "").toLowerCase() === MY_HANDLE.toLowerCase()) {
        count++;
      }
    }
    return count;
  } catch {
    return 0;
  }
}
async function runInboundEngagement(config) {
  const state = loadState();
  if (state.total_replies_posted_today >= SAFETY_LIMIT) {
    log({ event: "abort", reason: "safety_limit_reached", total: state.total_replies_posted_today });
    return [];
  }
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
  const results = [];
  const sessionUsage = { inputTokens: 0, outputTokens: 0, costUsd: 0, retried: false };
  let mentions = [];
  try {
    const loginResult = await loginCheck(page);
    if (!loginResult.success || !loginResult.data) {
      log({ event: "abort", reason: "not_logged_in" });
      saveState(updateStateAfterRun(state, 0, 0));
      return results;
    }
    log({ event: "login_ok" });
    mentions = await scrapeMentions(page);
    log({ event: "mentions_found", count: mentions.length });
    if (mentions.length === 0) {
      log({ event: "no_mentions" });
      saveState(updateStateAfterRun(state, 0, 0));
      return results;
    }
    const repliedHandles = /* @__PURE__ */ new Set();
    for (const mention of mentions) {
      if (results.length >= MAX_REPLIES_PER_SESSION) break;
      if (repliedHandles.has(mention.handle.toLowerCase())) continue;
      log({ event: "mention_check", handle: mention.handle, tweetUrl: mention.tweetUrl });
      const ourReplyCount = await countOurRepliesInThread(page, mention.tweetUrl);
      if (ourReplyCount >= MAX_REPLIES_PER_THREAD) {
        log({ event: "skip_mention", reason: "thread_reply_limit", handle: mention.handle });
        continue;
      }
      let replyText;
      try {
        const parentPart = mention.parentText ? `[Original post]: "${mention.parentText}"${mention.parentLinks.length ? `
[Links in original post]: ${mention.parentLinks.join(", ")}` : ""}

` : "";
        const mentionLinks = mention.links.length ? `
[Links they shared]: ${mention.links.join(", ")}` : "";
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
      await page.goto(mention.tweetUrl, { waitUntil: "domcontentloaded", timeout: 15e3 });
      await page.waitForTimeout(1500);
      const typeResult = await typeReply(page, replyText);
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
        verified
      });
      repliedHandles.add(mention.handle.toLowerCase());
      if (results.length < MAX_REPLIES_PER_SESSION) {
        const delay = 15e3 + Math.random() * 15e3;
        log({ event: "pacing_delay", delayMs: Math.round(delay) });
        await sleep(delay);
      }
    }
  } finally {
    await browser.close().catch(() => {
    });
  }
  log({
    event: "session_complete",
    repliesAttempted: results.length,
    repliesVerified: results.filter((r) => r.verified).length,
    totalInputTokens: sessionUsage.inputTokens,
    totalOutputTokens: sessionUsage.outputTokens,
    totalCostUsd: +sessionUsage.costUsd.toFixed(6)
  });
  appendToLog(results);
  appendCostLog("inbound", sessionUsage, { replies: results.length });
  saveState(updateStateAfterRun(state, mentions.length ?? 0, results.length));
  return results;
}
const isMain = process.argv[1] != null && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  const config = loadConfig();
  runInboundEngagement(config).then((results) => {
    const verified = results.filter((r) => r.verified).length;
    console.log(
      `
[inbound] Session complete \u2014 ${verified}/${results.length} replies verified`
    );
    process.exit(0);
  }).catch((err) => {
    console.error("[inbound] Fatal error:", err);
    process.exit(1);
  });
}
export {
  runInboundEngagement
};
