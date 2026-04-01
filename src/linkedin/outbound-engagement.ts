/**
 * LinkedIn outbound engagement orchestrator.
 *
 * Discovery: searches LinkedIn for high-engagement content using rotating
 * keyword queries (relevance sort), then interacts with posts IN-PLACE
 * on the search results page.
 *
 * Duplicate protection: maintains a persistent set of author+content
 * fingerprints in the state file to avoid replying to the same post twice,
 * even across sessions.
 *
 * Additionally, the post URL is written to commentedPostUrls in the state
 * file BEFORE attempting to comment — so a mid-session crash cannot cause
 * the same post to be commented on twice.
 */
import type { Browser } from "playwright";
import { ensureBrowser } from "./ensure-chrome.js";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import type { Config } from "../config.js";
import { LINKEDIN_SEARCH_QUERIES, loadConfig } from "../config.js";
import { generateReply, appendCostLog, type ReplyUsage } from "../llm/claude-client.js";
import { loginCheck } from "./login-check.js";
import { searchContent } from "./search-content.js";
import { scrollFeed } from "./scroll-feed.js";
import { findTargetPost } from "./find-target-post.js";
import { typeReply } from "./type-reply.js";
import { submitReply } from "./submit-reply.js";
import { LINKEDIN_OUTBOUND_LOG_DIR, LINKEDIN_OUTBOUND_STATE_PATH, LINKEDIN_COSTS_PATH } from "../paths.js";
import { checkForRateLimit, isOverDailyCap, humanPause } from "../shared/safety.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LinkedInEngagementResult {
  postUrl: string;
  author: string;
  theirText: string;
  replyText: string;
  verified: boolean;
  error?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const LOG_DIR = LINKEDIN_OUTBOUND_LOG_DIR;
const STATE_PATH = LINKEDIN_OUTBOUND_STATE_PATH;
const MY_NAME = "Trent";

function log(entry: Record<string, unknown>): void {
  console.log(JSON.stringify({ ts: new Date().toISOString(), ...entry }));
}

function appendToLog(results: LinkedInEngagementResult[]): void {
  if (results.length === 0) return;
  const today = new Date().toISOString().slice(0, 10);
  const logPath = path.join(LOG_DIR, `${today}.md`);

  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });

    let existing = "";
    try {
      existing = fs.readFileSync(logPath, "utf-8");
    } catch {
      existing = `# LinkedIn Outbound Engagement Log\n**Date:** ${today}\n**Account:** ${MY_NAME}\n\n`;
    }

    const entryNum = (existing.match(/^## OUTBOUND REPLY \[/gm) ?? []).length;
    const entries = results
      .filter((r) => r.replyText)
      .map((r, i) =>
        [
          `## OUTBOUND REPLY [${entryNum + i + 1}]`,
          `**Author:** ${r.author}`,
          `**Their post:** "${r.theirText.slice(0, 200)}"`,
          `**Our reply:** "${r.replyText}"`,
          `**Post URL:** ${r.postUrl || "(search interaction)"}`,
          `**Time:** ${new Date().toISOString()}`,
          `**Verified:** ${r.verified}`,
        ].join("\n")
      );

    fs.writeFileSync(logPath, existing + entries.join("\n\n") + "\n\n", "utf-8");
    log({ event: "log_written", path: logPath, count: entries.length });
  } catch (err) {
    console.warn(`[linkedin-outbound] Failed to write log: ${err}`);
  }
}

// ---------------------------------------------------------------------------
// State — tracks replied posts to avoid duplicates across sessions
// ---------------------------------------------------------------------------

interface OutboundState {
  total_replies_posted_today: number;
  last_date: string;
  recent_queries: string[];
  /** Fingerprints of posts we've replied to (author:contentPrefix). Kept for 7 days. */
  replied_fingerprints: { fp: string; date: string }[];
  /**
   * Post URLs recorded BEFORE each comment attempt.
   * Written immediately so a mid-session crash cannot cause a double-comment.
   * check-already-replied.ts reads this for a fast DOM-free guard.
   */
  commentedPostUrls: string[];
  /** ISO timestamp of last completed session. */
  last_session_at: string | null;
}

function postFingerprint(author: string, content: string): string {
  // Use author + first 80 chars of content as a stable fingerprint
  return `${author.toLowerCase().trim()}::${content.slice(0, 80).toLowerCase().trim()}`;
}

function loadOutboundState(): OutboundState {
  try {
    const raw = JSON.parse(fs.readFileSync(STATE_PATH, "utf-8"));
    return {
      ...raw,
      recent_queries: raw.recent_queries ?? [],
      replied_fingerprints: raw.replied_fingerprints ?? [],
      commentedPostUrls: raw.commentedPostUrls ?? [],
      last_session_at: raw.last_session_at ?? null,
    };
  } catch {
    return {
      total_replies_posted_today: 0,
      last_date: new Date().toISOString().slice(0, 10),
      recent_queries: [],
      replied_fingerprints: [],
      commentedPostUrls: [],
      last_session_at: null,
    };
  }
}

function pickQuery(recentQueries: string[]): string {
  const recent = recentQueries ?? [];
  const available = LINKEDIN_SEARCH_QUERIES.filter((q) => !recent.slice(-4).includes(q));
  const pool = available.length > 0 ? available : LINKEDIN_SEARCH_QUERIES;
  return pool[Math.floor(Math.random() * pool.length)]!;
}

/**
 * Record a post URL in commentedPostUrls IMMEDIATELY — before we attempt
 * to comment. If the session crashes mid-comment, this prevents a retry
 * next session from double-commenting the same post.
 */
function saveCommentedPostUrl(postUrl: string): void {
  if (!postUrl) return;
  try {
    fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
    const current = loadOutboundState();
    const commentedPostUrls = current.commentedPostUrls ?? [];
    if (!commentedPostUrls.includes(postUrl)) {
      commentedPostUrls.push(postUrl);
    }
    fs.writeFileSync(STATE_PATH, JSON.stringify({ ...current, commentedPostUrls }, null, 2));
  } catch (err) {
    console.warn(`[linkedin-outbound] Failed to save commented URL: ${err}`);
  }
}

function saveOutboundState(
  repliesPosted: number,
  query: string,
  newFingerprints: string[]
): void {
  try {
    fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
    const today = new Date().toISOString().slice(0, 10);
    const current = loadOutboundState();

    const total = current.last_date !== today
      ? repliesPosted
      : current.total_replies_posted_today + repliesPosted;

    const recent_queries = [...(current.recent_queries ?? []), query].slice(-8);

    // Add new fingerprints and prune entries older than 7 days
    const cutoff = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10);
    const existing = (current.replied_fingerprints ?? []).filter((f) => f.date >= cutoff);
    const added = newFingerprints.map((fp) => ({ fp, date: today }));
    const replied_fingerprints = [...existing, ...added];

    fs.writeFileSync(
      STATE_PATH,
      JSON.stringify({
        total_replies_posted_today: total,
        last_date: today,
        recent_queries,
        replied_fingerprints,
        commentedPostUrls: current.commentedPostUrls ?? [],
        last_session_at: new Date().toISOString(),
      }, null, 2)
    );
  } catch (err) {
    console.warn(`[linkedin-outbound] Failed to save state: ${err}`);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readVoiceGuide(filePath: string): string {
  try {
    return fs.readFileSync(filePath, "utf-8");
  } catch {
    console.warn(`[linkedin-outbound] Voice guide not found at ${filePath} — using built-in default`);
    return "Write in a direct, conversational tone. Be genuinely helpful and insightful. Add real value, not filler.";
  }
}

// ---------------------------------------------------------------------------
// Main orchestrator
// ---------------------------------------------------------------------------

export async function runLinkedInOutboundEngagement(
  config: Config
): Promise<LinkedInEngagementResult[]> {
  const voiceGuide = readVoiceGuide(config.VOICE_FILE_PATH);
  const browser = await ensureBrowser();
  const contexts = browser.contexts();
  const context = contexts.length > 0 ? contexts[0] : await browser.newContext();
  const page = await context.newPage();
  const results: LinkedInEngagementResult[] = [];
  const sessionUsage: ReplyUsage = { inputTokens: 0, outputTokens: 0, costUsd: 0, retried: false };
  const newFingerprints: string[] = [];

  try {
    // ── Pre-flight: daily cap + session cooldown ────────────────────────────
    const state = loadOutboundState();
    const today = new Date().toISOString().slice(0, 10);
    const todayReplies = state.last_date === today ? state.total_replies_posted_today : 0;

    if (isOverDailyCap("linkedin", todayReplies)) {
      log({ event: "abort", reason: "daily_cap_reached", todayReplies, cap: 15 });
      return results;
    }

    if (state.last_session_at) {
      const elapsed = Date.now() - new Date(state.last_session_at).getTime();
      const minGap = 30 * 60_000; // 30 min
      if (elapsed < minGap) {
        const waitMin = Math.ceil((minGap - elapsed) / 60_000);
        log({ event: "abort", reason: "session_cooldown", waitMin, lastSession: state.last_session_at });
        return results;
      }
    }

    // ── Step 1: Login check ───────────────────────────────────────────────
    const loginResult = await loginCheck(page);
    if (!loginResult.success || !loginResult.data) {
      log({ event: "abort", reason: "not_logged_in" });
      return results;
    }
    log({ event: "login_ok" });

    // Safety check after login
    const loginSafety = await checkForRateLimit(page, "linkedin");
    if (!loginSafety.safe) {
      log({ event: "abort", reason: "safety_check_failed", ...loginSafety });
      return results;
    }

    // ── Step 2: Search for high-engagement content ────────────────────────
    const repliedSet = new Set(state.replied_fingerprints.map((f) => f.fp));
    const commentedUrlSet = new Set(state.commentedPostUrls ?? []);
    const query = pickQuery(state.recent_queries);
    log({ event: "search_start", query, knownFingerprints: repliedSet.size, commentedUrls: commentedUrlSet.size, todayReplies });

    const searchResult = await searchContent(page, query, "relevance");
    if (!searchResult.success) {
      log({ event: "search_failed", error: searchResult.error });
      return results;
    }

    // ── Step 3: Scroll and extract post cards ─────────────────────────────
    const scrollResult = await scrollFeed(page, 4);
    if (!scrollResult.success || !scrollResult.data) {
      log({ event: "abort", reason: "scroll_failed", error: scrollResult.error });
      return results;
    }
    log({ event: "scroll_done", count: scrollResult.data.length });

    if (scrollResult.data.length === 0) {
      log({ event: "abort", reason: "no_posts_found" });
      return results;
    }

    // ── Step 4: Filter — engagement + not already replied ─────────────────
    // Remove posts we've already replied to (by fingerprint OR by URL)
    const fresh = scrollResult.data.filter((p) => {
      const fp = postFingerprint(p.author, p.content);
      if (repliedSet.has(fp)) return false;
      if (p.postUrl && commentedUrlSet.has(p.postUrl)) return false;
      return true;
    });

    log({ event: "dedup_filter", before: scrollResult.data.length, after: fresh.length });

    if (fresh.length === 0) {
      log({ event: "abort", reason: "all_posts_already_replied" });
      return results;
    }

    const filterResult = findTargetPost(fresh, {
      minEngagement: 10,
      maxAgeHours: 168, // Search results can be older but high-engagement
      excludeKeywords: [
        "hiring", "we're hiring", "join our team", "apply now",
        "open to work", "job opening", "job opportunity",
        "new opportunity", "looking for a", "open role",
        "accepting applications", "dm me for details",
      ],
    });

    let targets;
    if (!filterResult.success || !filterResult.data || filterResult.data.length === 0) {
      // Fallback: take posts with substantial content
      log({ event: "filter_fallback", reason: "no_posts_above_engagement_threshold" });
      targets = fresh.filter((p) => p.content.length > 80).slice(0, 5);
    } else {
      targets = filterResult.data;
    }

    const overrideReplies = parseInt(process.env["MAX_REPLIES_OVERRIDE"] ?? "", 10);
    const maxReplies = overrideReplies > 0 ? overrideReplies : config.LINKEDIN_MAX_REPLIES_PER_SESSION;
    targets = targets.slice(0, maxReplies);
    log({
      event: "targets_ready",
      count: targets.length,
      sample: targets.map((t) => ({
        author: t.author,
        likes: t.likes,
        comments: t.comments,
        reposts: t.reposts,
        idx: t.postIndex,
      })),
    });

    // ── Step 5: Reply to each target post (in-place on search results) ────
    const authorsReplied = new Set<string>(); // Same-author guard

    for (let i = 0; i < targets.length; i++) {
      // Daily cap check mid-session
      if (isOverDailyCap("linkedin", todayReplies + results.filter((r) => !r.error).length)) {
        log({ event: "stop_early", reason: "daily_cap_reached_mid_session" });
        break;
      }

      const post = targets[i]!;
      const postIndex = post.postIndex ?? -1;
      log({ event: "post_start", index: i + 1, total: targets.length, author: post.author, postIndex });

      // Max 1 comment per post guard — re-check against the live commentedUrlSet
      // (which may have been updated by a concurrent session or earlier iteration)
      if (post.postUrl && commentedUrlSet.has(post.postUrl)) {
        log({ event: "skip_post", reason: "already_in_commented_urls", postUrl: post.postUrl });
        continue;
      }

      // Same-author guard: don't reply to 2+ posts by the same person
      const authorKey = post.author.toLowerCase().trim();
      if (authorsReplied.has(authorKey)) {
        log({ event: "skip_post", reason: "same_author_already_replied", author: post.author });
        continue;
      }

      try {
        // Get the listitem locator for this post
        const listItems = await page.locator("div[role='listitem']").all();
        if (postIndex < 0 || postIndex >= listItems.length) {
          log({ event: "skip_post", reason: "listitem_not_found", postIndex });
          continue;
        }
        const postLocator = listItems[postIndex]!;

        // Scroll the post into view
        await postLocator.scrollIntoViewIfNeeded().catch(() => {});
        await humanPause(400, 1200); // Random pause after scrolling (like a human reading)

        // ── Generate reply text via LLM ──────────────────────────────────
        const generated = await generateReply(post.content, post.author, voiceGuide, "linkedin");
        const replyText = generated.text;
        sessionUsage.inputTokens += generated.usage.inputTokens;
        sessionUsage.outputTokens += generated.usage.outputTokens;
        sessionUsage.costUsd += generated.usage.costUsd;
        if (generated.usage.retried) sessionUsage.retried = true;
        log({ event: "reply_generated", author: post.author, replyText, chars: replyText.length, ...generated.usage });

        // ── IMPORTANT: Record URL BEFORE clicking Comment ────────────────
        // This ensures even a crash after clicking but before submitting
        // won't cause a double-comment on the next session.
        if (post.postUrl) {
          saveCommentedPostUrl(post.postUrl);
          commentedUrlSet.add(post.postUrl); // Keep in-memory set in sync
        }

        // ── Click "Comment" button on the post ───────────────────────────
        const commentBtn = postLocator.locator("button").filter({ hasText: /^Comment$/i }).first();
        const commentBtnVisible = await commentBtn.isVisible().catch(() => false);

        if (!commentBtnVisible) {
          log({ event: "skip_post", reason: "no_comment_button", author: post.author });
          results.push({ postUrl: post.postUrl, author: post.author, theirText: post.content, replyText, verified: false, error: "no_comment_button" });
          continue;
        }

        await humanPause(300, 700); // Brief pause before clicking (human doesn't instant-click)
        await commentBtn.click();
        await page.waitForTimeout(1_500);

        // ── Type reply ───────────────────────────────────────────────────
        const typeResult = await typeReply(page, replyText);
        if (!typeResult.success) {
          log({ event: "type_failed", author: post.author, error: typeResult.error });
          results.push({ postUrl: post.postUrl, author: post.author, theirText: post.content, replyText, verified: false, error: typeResult.error });
          continue;
        }

        // ── Submit reply ─────────────────────────────────────────────────
        const submitResult = await submitReply(page, postLocator);
        if (!submitResult.success) {
          log({ event: "submit_failed", author: post.author, error: submitResult.error });
          results.push({ postUrl: post.postUrl, author: post.author, theirText: post.content, replyText, verified: false, error: submitResult.error });
          continue;
        }

        // ── Verify reply ─────────────────────────────────────────────────
        const editorText = await page
          .locator("div[contenteditable='true'][role='textbox']")
          .first()
          .innerText()
          .catch(() => null);
        const editorCleared = editorText === null || editorText.trim() === "";

        const updatedText = await postLocator.innerText().catch(() => "");
        const snippet = replyText.slice(0, 30).toLowerCase();
        const textFound = updatedText.toLowerCase().includes(snippet);

        const verified = editorCleared || textFound;

        log({ event: "post_done", author: post.author, verified });
        results.push({ postUrl: post.postUrl, author: post.author, theirText: post.content, replyText, verified });

        // Track fingerprint for session-end state save
        newFingerprints.push(postFingerprint(post.author, post.content));
        authorsReplied.add(authorKey);

        // Safety check after submitting — detect rate limits / blocks
        const postSafety = await checkForRateLimit(page, "linkedin");
        if (!postSafety.safe) {
          log({ event: "safety_abort", ...postSafety });
          break; // Stop immediately, don't try more replies
        }
      } catch (err) {
        const error = String(err);
        log({ event: "post_error", author: post.author, error });
        results.push({ postUrl: post.postUrl, author: post.author, theirText: post.content, replyText: "", verified: false, error });
      }

      // ── Natural pacing (longer for LinkedIn) ────────────────────────────
      if (i < targets.length - 1) {
        const delay = Math.floor(
          Math.random() * (config.LINKEDIN_REPLY_DELAY_MAX_MS - config.LINKEDIN_REPLY_DELAY_MIN_MS) +
            config.LINKEDIN_REPLY_DELAY_MIN_MS
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
      totalCostUsd: +sessionUsage.costUsd.toFixed(6),
    });

    appendToLog(results);
    appendCostLog("linkedin-outbound", sessionUsage, { replies: results.length });
    saveOutboundState(results.filter((r) => !r.error).length, query, newFingerprints);

    return results;
  } finally {
    await page.close();
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

const isMain = process.argv[1] != null &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  const config = loadConfig();
  runLinkedInOutboundEngagement(config)
    .then((results) => {
      const verified = results.filter((r) => r.verified).length;
      console.log(`\n[linkedin-outbound] Session complete — ${verified}/${results.length} replies verified`);
      process.exit(0);
    })
    .catch((err) => {
      console.error("[linkedin-outbound] Fatal error:", err);
      process.exit(1);
    });
}
