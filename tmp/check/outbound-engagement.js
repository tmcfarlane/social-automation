import { chromium } from "playwright";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { SEARCH_QUERIES, loadConfig } from "../config";
import { generateReply, appendCostLog } from "../llm/claude-client";
import { loginCheck } from "./login-check";
import { searchTopic } from "./search-topic";
import { scrollResults } from "./scroll-results";
import { findTargetTweet } from "./find-target-tweet";
import { readThread } from "./read-thread";
import { typeReply } from "./type-reply";
import { submitReply } from "./submit-reply";
import { verifyReply } from "./verify-reply";
const LOG_DIR = "C:\\Users\\Trent\\rep\\COMMAND CENTER\\Command Center\\SocialMediaEngine\\X\\outbound";
const STATE_PATH = "C:\\Users\\Trent\\rep\\COMMAND CENTER\\Command Center\\SocialMediaEngine\\X\\state\\x-outbound-state.json";
const MY_HANDLE = "hodlmecloseplz";
function log(entry) {
  console.log(JSON.stringify({ ts: (/* @__PURE__ */ new Date()).toISOString(), ...entry }));
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
      existing = `# X Outbound Engagement Log
**Date:** ${today}
**Account:** @${MY_HANDLE}

`;
    }
    const entryNum = (existing.match(/^## OUTBOUND REPLY \[/gm) ?? []).length;
    const entries = results.filter((r) => r.replyText).map(
      (r, i) => [
        `## OUTBOUND REPLY [${entryNum + i + 1}]`,
        `**Replied to:** @${r.handle}`,
        `**Author:** ${r.author}`,
        `**Their post:** "${r.theirText}"`,
        `**Our reply:** "${r.replyText}"`,
        `**Post URL:** ${r.tweetUrl}`,
        `**Time:** ${(/* @__PURE__ */ new Date()).toISOString()}`,
        `**Verified:** ${r.verified}`
      ].join("\n")
    );
    fs.writeFileSync(logPath, existing + entries.join("\n\n") + "\n\n", "utf-8");
    log({ event: "log_written", path: logPath, count: entries.length });
  } catch (err) {
    console.warn(`[outbound] Failed to write log: ${err}`);
  }
}
function loadOutboundState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_PATH, "utf-8"));
  } catch {
    return { total_replies_posted_today: 0, last_date: (/* @__PURE__ */ new Date()).toISOString().slice(0, 10), recent_queries: [] };
  }
}
function pickQuery(recentQueries) {
  const available = SEARCH_QUERIES.filter((q) => !recentQueries.slice(-4).includes(q));
  const pool = available.length > 0 ? available : SEARCH_QUERIES;
  return pool[Math.floor(Math.random() * pool.length)];
}
function saveOutboundState(repliesPosted, query) {
  try {
    fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
    const today = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
    const current = loadOutboundState();
    const total = current.last_date !== today ? repliesPosted : current.total_replies_posted_today + repliesPosted;
    const recent_queries = [...current.recent_queries ?? [], query].slice(-8);
    fs.writeFileSync(STATE_PATH, JSON.stringify({ total_replies_posted_today: total, last_date: today, recent_queries }, null, 2));
  } catch (err) {
    console.warn(`[outbound] Failed to save state: ${err}`);
  }
}
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
function readVoiceGuide(filePath) {
  try {
    return fs.readFileSync(filePath, "utf-8");
  } catch {
    console.warn(
      `[outbound] Voice guide not found at ${filePath} \u2014 using built-in default`
    );
    return "Write in a direct, conversational tone. Be genuinely helpful and insightful. Add real value, not filler.";
  }
}
async function launchBrowser(cdpUrl) {
  if (cdpUrl) {
    return chromium.connectOverCDP(cdpUrl);
  }
  return chromium.launch({ headless: false });
}
async function runOutboundEngagement(config) {
  const voiceGuide = readVoiceGuide(config.VOICE_FILE_PATH);
  const cdpUrl = process.env["CHROME_CDP_URL"];
  const browser = await launchBrowser(cdpUrl);
  const contexts = browser.contexts();
  const context = contexts.length > 0 ? contexts[0] : await browser.newContext();
  const existingPages = context.pages();
  const page = existingPages.length > 0 ? existingPages[0] : await context.newPage();
  const results = [];
  const sessionUsage = { inputTokens: 0, outputTokens: 0, costUsd: 0, retried: false };
  try {
    const loginResult = await loginCheck(page);
    if (!loginResult.success || !loginResult.data) {
      log({ event: "abort", reason: "not_logged_in" });
      return results;
    }
    log({ event: "login_ok" });
    const state = loadOutboundState();
    const query = pickQuery(state.recent_queries);
    log({ event: "search_start", query });
    const searchResult = await searchTopic(page, query, "top");
    if (!searchResult.success) {
      log({ event: "abort", reason: "search_failed", error: searchResult.error });
      return results;
    }
    const scrollResult = await scrollResults(page, 4);
    if (!scrollResult.success || !scrollResult.data) {
      log({
        event: "abort",
        reason: "scroll_failed",
        error: scrollResult.error
      });
      return results;
    }
    const engagementSample = scrollResult.data.slice(0, 5).map((t) => ({
      handle: t.handle,
      likes: t.likes,
      retweets: t.retweets,
      replies: t.replies,
      total: t.likes + t.retweets + t.replies,
      timestamp: t.timestamp
    }));
    log({ event: "scroll_done", count: scrollResult.data.length, sample: engagementSample });
    const filterResult = findTargetTweet(scrollResult.data, {
      minEngagement: 50,
      maxAgeHours: 168
      // 7 days — top tab returns popular tweets from any time period
    });
    if (!filterResult.success || !filterResult.data || filterResult.data.length === 0) {
      log({ event: "abort", reason: "no_targets_found" });
      return results;
    }
    const targets = filterResult.data.slice(0, config.MAX_REPLIES_PER_SESSION);
    log({ event: "targets_ready", count: targets.length });
    for (let i = 0; i < targets.length; i++) {
      const tweet = targets[i];
      log({
        event: "tweet_start",
        index: i + 1,
        total: targets.length,
        tweetUrl: tweet.tweetUrl,
        author: tweet.author
      });
      try {
        const threadResult = await readThread(page, tweet.tweetUrl);
        const threadContext = threadResult.data?.slice(0, 3).map((r) => `${r.commenter}: ${r.text}`).join("\n") ?? "";
        const authorInfo = `${tweet.author} (${tweet.handle})`;
        const postContent = threadContext ? `${tweet.content}

Top replies:
${threadContext}` : tweet.content;
        const generated = await generateReply(postContent, authorInfo, voiceGuide);
        const replyText = generated.text;
        sessionUsage.inputTokens += generated.usage.inputTokens;
        sessionUsage.outputTokens += generated.usage.outputTokens;
        sessionUsage.costUsd += generated.usage.costUsd;
        if (generated.usage.retried) sessionUsage.retried = true;
        log({ event: "reply_generated", tweetUrl: tweet.tweetUrl, replyText, chars: replyText.length, ...generated.usage });
        await page.goto(tweet.tweetUrl, {
          waitUntil: "domcontentloaded",
          timeout: 15e3
        });
        await page.waitForTimeout(1e3);
        const typeResult = await typeReply(page, replyText);
        if (!typeResult.success) {
          log({ event: "type_failed", tweetUrl: tweet.tweetUrl, error: typeResult.error });
          results.push({ tweetUrl: tweet.tweetUrl, author: tweet.author, handle: tweet.handle, theirText: tweet.content, replyText, verified: false, error: typeResult.error });
          continue;
        }
        const submitResult = await submitReply(page);
        if (!submitResult.success) {
          log({ event: "submit_failed", tweetUrl: tweet.tweetUrl, error: submitResult.error });
          results.push({ tweetUrl: tweet.tweetUrl, author: tweet.author, handle: tweet.handle, theirText: tweet.content, replyText, verified: false, error: submitResult.error });
          continue;
        }
        const submitted = submitResult.data?.submitted ?? false;
        log({ event: "submit_done", tweetUrl: tweet.tweetUrl, submitted });
        if (!submitted) {
          results.push({ tweetUrl: tweet.tweetUrl, author: tweet.author, handle: tweet.handle, theirText: tweet.content, replyText, verified: false, error: "compose_box_never_closed" });
          continue;
        }
        const verifyResult = await verifyReply(page, tweet.tweetUrl, replyText);
        const verified = verifyResult.success && (verifyResult.data ?? false);
        log({ event: "tweet_done", tweetUrl: tweet.tweetUrl, verified });
        results.push({ tweetUrl: tweet.tweetUrl, author: tweet.author, handle: tweet.handle, theirText: tweet.content, replyText, verified });
      } catch (err) {
        const error = String(err);
        log({ event: "tweet_error", tweetUrl: tweet.tweetUrl, error });
        results.push({ tweetUrl: tweet.tweetUrl, author: tweet.author, handle: tweet.handle, theirText: tweet.content, replyText: "", verified: false, error });
      }
      if (i < targets.length - 1) {
        const delay = Math.floor(
          Math.random() * (config.REPLY_DELAY_MAX_MS - config.REPLY_DELAY_MIN_MS) + config.REPLY_DELAY_MIN_MS
        );
        log({ event: "pacing_delay", delayMs: delay });
        await sleep(delay);
      }
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
    appendCostLog("outbound", sessionUsage, { replies: results.length });
    saveOutboundState(results.filter((r) => !r.error).length, query);
    return results;
  } finally {
    await browser.close();
  }
}
const isMain = process.argv[1] != null && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  const config = loadConfig();
  runOutboundEngagement(config).then((results) => {
    const verified = results.filter((r) => r.verified).length;
    console.log(
      `
[outbound] Session complete \u2014 ${verified}/${results.length} replies verified`
    );
    process.exit(0);
  }).catch((err) => {
    console.error("[outbound] Fatal error:", err);
    process.exit(1);
  });
}
export {
  runOutboundEngagement
};
