import { chromium } from "playwright";
import type { Browser } from "playwright";
import * as fs from "fs";
import * as path from "path";
import type { Config } from "../config";
import { SEARCH_QUERIES, loadConfig } from "../config";
import { generateReply } from "../llm/claude-client";
import { loginCheck } from "./login-check";
import { searchTopic } from "./search-topic";
import { scrollResults } from "./scroll-results";
import { findTargetTweet } from "./find-target-tweet";
import { readThread } from "./read-thread";
import { typeReply } from "./type-reply";
import { submitReply } from "./submit-reply";
import { verifyReply } from "./verify-reply";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EngagementResult {
  tweetUrl: string;
  replyText: string;
  verified: boolean;
  error?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const LOG_FILE = path.join(process.cwd(), "engagement-log.jsonl");

function log(entry: Record<string, unknown>): void {
  const line = JSON.stringify({ ts: new Date().toISOString(), ...entry });
  console.log(line);
  try {
    fs.appendFileSync(LOG_FILE, line + "\n");
  } catch {
    // Non-fatal — keep going even if log file write fails
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readVoiceGuide(filePath: string): string {
  try {
    return fs.readFileSync(filePath, "utf-8");
  } catch {
    console.warn(
      `[outbound] Voice guide not found at ${filePath} — using built-in default`
    );
    return "Write in a direct, conversational tone. Be genuinely helpful and insightful. Add real value, not filler.";
  }
}

async function launchBrowser(cdpUrl?: string): Promise<Browser> {
  if (cdpUrl) {
    return chromium.connectOverCDP(cdpUrl);
  }
  return chromium.launch({ headless: false });
}

// ---------------------------------------------------------------------------
// Main orchestrator
// ---------------------------------------------------------------------------

export async function runOutboundEngagement(
  config: Config
): Promise<EngagementResult[]> {
  const voiceGuide = readVoiceGuide(config.VOICE_FILE_PATH);
  const cdpUrl = process.env["CHROME_CDP_URL"];
  const browser = await launchBrowser(cdpUrl);
  const page = await browser.newPage();
  const results: EngagementResult[] = [];

  try {
    // ── Step 1: Login check ──────────────────────────────────────────────────
    const loginResult = await loginCheck(page);
    if (!loginResult.success || !loginResult.data) {
      log({ event: "abort", reason: "not_logged_in" });
      return results;
    }
    log({ event: "login_ok" });

    // ── Step 2: Search with a rotating query ────────────────────────────────
    const query =
      SEARCH_QUERIES[Math.floor(Math.random() * SEARCH_QUERIES.length)]!;
    log({ event: "search_start", query });

    const searchResult = await searchTopic(page, query, "latest");
    if (!searchResult.success) {
      log({ event: "abort", reason: "search_failed", error: searchResult.error });
      return results;
    }

    // ── Step 3: Scroll and extract tweet cards ───────────────────────────────
    const scrollResult = await scrollResults(page, 4);
    if (!scrollResult.success || !scrollResult.data) {
      log({
        event: "abort",
        reason: "scroll_failed",
        error: scrollResult.error,
      });
      return results;
    }
    log({ event: "scroll_done", count: scrollResult.data.length });

    // ── Step 4: Filter to engagement-worthy targets ──────────────────────────
    const filterResult = findTargetTweet(scrollResult.data, {
      minEngagement: 50,
      maxAgeHours: 24,
    });

    if (
      !filterResult.success ||
      !filterResult.data ||
      filterResult.data.length === 0
    ) {
      log({ event: "abort", reason: "no_targets_found" });
      return results;
    }

    const targets = filterResult.data.slice(0, config.MAX_REPLIES_PER_SESSION);
    log({ event: "targets_ready", count: targets.length });

    // ── Step 5: Reply to each target tweet ───────────────────────────────────
    for (let i = 0; i < targets.length; i++) {
      const tweet = targets[i]!;
      log({
        event: "tweet_start",
        index: i + 1,
        total: targets.length,
        tweetUrl: tweet.tweetUrl,
        author: tweet.author,
      });

      try {
        // Read thread for richer context
        const threadResult = await readThread(page, tweet.tweetUrl);
        const threadContext =
          threadResult.data
            ?.slice(0, 3)
            .map((r) => `${r.commenter}: ${r.text}`)
            .join("\n") ?? "";

        const authorInfo = `${tweet.author} (${tweet.handle})`;
        const postContent = threadContext
          ? `${tweet.content}\n\nTop replies:\n${threadContext}`
          : tweet.content;

        // ── ONLY LLM CALL: generate reply text ──────────────────────────────
        const replyText = await generateReply(postContent, authorInfo, voiceGuide);
        log({ event: "reply_generated", tweetUrl: tweet.tweetUrl, replyText });

        // Navigate back to tweet before typing (readThread already navigated there
        // but the page state may have changed; a fresh goto is deterministic)
        await page.goto(tweet.tweetUrl, {
          waitUntil: "domcontentloaded",
          timeout: 15_000,
        });
        await page.waitForTimeout(1_000);

        // ── Type reply ───────────────────────────────────────────────────────
        const typeResult = await typeReply(page, replyText);
        if (!typeResult.success) {
          log({
            event: "type_failed",
            tweetUrl: tweet.tweetUrl,
            error: typeResult.error,
          });
          results.push({
            tweetUrl: tweet.tweetUrl,
            replyText,
            verified: false,
            error: typeResult.error,
          });
          continue;
        }

        // ── Submit reply ─────────────────────────────────────────────────────
        const submitResult = await submitReply(page);
        if (!submitResult.success) {
          log({
            event: "submit_failed",
            tweetUrl: tweet.tweetUrl,
            error: submitResult.error,
          });
          results.push({
            tweetUrl: tweet.tweetUrl,
            replyText,
            verified: false,
            error: submitResult.error,
          });
          continue;
        }

        // ── Verify reply ─────────────────────────────────────────────────────
        const verifyResult = await verifyReply(page, tweet.tweetUrl, replyText);
        const verified =
          verifyResult.success && (verifyResult.data ?? false);

        log({ event: "tweet_done", tweetUrl: tweet.tweetUrl, verified });
        results.push({ tweetUrl: tweet.tweetUrl, replyText, verified });
      } catch (err) {
        const error = String(err);
        log({ event: "tweet_error", tweetUrl: tweet.tweetUrl, error });
        results.push({
          tweetUrl: tweet.tweetUrl,
          replyText: "",
          verified: false,
          error,
        });
      }

      // ── Natural pacing (skip delay after the last reply) ─────────────────
      if (i < targets.length - 1) {
        const delay = Math.floor(
          Math.random() *
            (config.REPLY_DELAY_MAX_MS - config.REPLY_DELAY_MIN_MS) +
            config.REPLY_DELAY_MIN_MS
        );
        log({ event: "pacing_delay", delayMs: delay });
        await sleep(delay);
      }
    }

    log({
      event: "session_complete",
      repliesAttempted: results.length,
      repliesVerified: results.filter((r) => r.verified).length,
    });
    return results;
  } finally {
    await browser.close();
  }
}

// ---------------------------------------------------------------------------
// Entry point (direct execution via tsx or node)
// ---------------------------------------------------------------------------

if (require.main === module) {
  const config = loadConfig();
  runOutboundEngagement(config)
    .then((results) => {
      const verified = results.filter((r) => r.verified).length;
      console.log(
        `\n[outbound] Session complete — ${verified}/${results.length} replies verified`
      );
      process.exit(0);
    })
    .catch((err) => {
      console.error("[outbound] Fatal error:", err);
      process.exit(1);
    });
}
