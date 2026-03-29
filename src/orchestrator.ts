import { chromium } from "playwright";
import fs from "fs";
import path from "path";

// LinkedIn skills
import { loginCheck as linkedinLoginCheck } from "./linkedin/login-check";
import { openFeed } from "./linkedin/open-feed";
import { scrollFeed } from "./linkedin/scroll-feed";
import { findTargetPost } from "./linkedin/find-target-post";
import { readComments } from "./linkedin/read-comments";
import { checkAlreadyReplied } from "./linkedin/check-already-replied";
import { typeReply as linkedinTypeReply } from "./linkedin/type-reply";
import { submitReply as linkedinSubmitReply } from "./linkedin/submit-reply";
import { verifyReply as linkedinVerifyReply } from "./linkedin/verify-reply";

// X skills
import { loginCheck as xLoginCheck } from "./x/login-check";
import { searchTopic } from "./x/search-topic";
import { scrollResults } from "./x/scroll-results";
import { findTargetTweet } from "./x/find-target-tweet";
import { readThread } from "./x/read-thread";
import { typeReply as xTypeReply } from "./x/type-reply";
import { submitReply as xSubmitReply } from "./x/submit-reply";
import { verifyReply as xVerifyReply } from "./x/verify-reply";

import type { FilterCriteria } from "./types";

export type TaskType =
  | "linkedin-reply"
  | "x-reply";

export interface OrchestratorConfig {
  taskType: TaskType;
  /** LinkedIn: keywords to find relevant posts */
  keywords?: string[];
  /** X: search query */
  searchQuery?: string;
  /** Minimum total engagement to target */
  minEngagement?: number;
  /** Max post/tweet age in hours */
  maxAgeHours?: number;
  /** The reply text to post (generated externally by Claude) */
  replyText: string;
  /** Your display name (for dedup checks) */
  myName?: string;
  /** If true, actually submit the reply. If false, dry-run only. */
  dryRun?: boolean;
  /** Max retry attempts for failed steps */
  maxRetries?: number;
}

export interface OrchestratorResult {
  success: boolean;
  platform: string;
  targetUrl?: string;
  repliedText?: string;
  verified?: boolean;
  skipped?: string;
  error?: string;
}

function log(msg: string) {
  const ts = new Date().toISOString();
  const line = `[${ts}] ${msg}`;
  console.log(line);
  // Append to log file
  const logFile = path.join(process.cwd(), "orchestrator.log");
  fs.appendFileSync(logFile, line + "\n");
}

async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries: number,
  label: string
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      log(`  [retry ${attempt}/${maxRetries}] ${label} failed: ${String(err)}`);
      await new Promise((r) => setTimeout(r, 1_000 * attempt));
    }
  }
  throw lastErr;
}

export async function runLinkedInReply(
  config: OrchestratorConfig
): Promise<OrchestratorResult> {
  const maxRetries = config.maxRetries ?? 2;
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    log("LinkedIn: checking login...");
    const loginResult = await withRetry(
      () => linkedinLoginCheck(page),
      maxRetries,
      "login-check"
    );
    if (!loginResult.success || !loginResult.data) {
      return {
        success: false,
        platform: "linkedin",
        error: "Not logged into LinkedIn. Please log in manually first.",
      };
    }

    log("LinkedIn: opening feed...");
    const feedResult = await withRetry(
      () => openFeed(page),
      maxRetries,
      "open-feed"
    );
    if (!feedResult.success) {
      return { success: false, platform: "linkedin", error: feedResult.error };
    }

    log("LinkedIn: scrolling feed...");
    const scrollResult = await withRetry(
      () => scrollFeed(page, 6),
      maxRetries,
      "scroll-feed"
    );
    if (!scrollResult.success || !scrollResult.data) {
      return { success: false, platform: "linkedin", error: scrollResult.error };
    }
    log(`  Found ${scrollResult.data.length} posts`);

    const criteria: FilterCriteria = {
      keywords: config.keywords,
      minEngagement: config.minEngagement ?? 50,
      maxAgeHours: config.maxAgeHours ?? 48,
    };

    const targetResult = findTargetPost(scrollResult.data, criteria);
    if (!targetResult.success || !targetResult.data?.length) {
      return {
        success: false,
        platform: "linkedin",
        error: "No matching posts found with given criteria",
      };
    }

    const target = targetResult.data[0];
    log(`LinkedIn: targeting post by ${target.author} — ${target.postUrl}`);

    log("LinkedIn: checking if already replied...");
    const alreadyReplied = await withRetry(
      () => checkAlreadyReplied(page, target.postUrl, config.myName),
      maxRetries,
      "check-already-replied"
    );
    if (alreadyReplied.data === true) {
      return {
        success: true,
        platform: "linkedin",
        targetUrl: target.postUrl,
        skipped: "Already replied to this post",
      };
    }

    if (config.dryRun) {
      log(`[DRY RUN] Would post to ${target.postUrl}: "${config.replyText}"`);
      return {
        success: true,
        platform: "linkedin",
        targetUrl: target.postUrl,
        repliedText: config.replyText,
        verified: false,
        skipped: "dry-run",
      };
    }

    // Navigate to the post
    await page.goto(target.postUrl, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1_000);

    log("LinkedIn: typing reply...");
    const typeResult = await withRetry(
      () => linkedinTypeReply(page, config.replyText),
      maxRetries,
      "type-reply"
    );
    if (!typeResult.success) {
      return { success: false, platform: "linkedin", error: typeResult.error };
    }

    log("LinkedIn: submitting reply...");
    const submitResult = await withRetry(
      () => linkedinSubmitReply(page),
      maxRetries,
      "submit-reply"
    );
    if (!submitResult.success) {
      return { success: false, platform: "linkedin", error: submitResult.error };
    }

    log("LinkedIn: verifying reply...");
    const verifyResult = await linkedinVerifyReply(
      page,
      target.postUrl,
      config.replyText,
      config.myName
    );

    log(verifyResult.data ? "  Reply verified!" : "  Could not verify (may still have posted)");

    return {
      success: true,
      platform: "linkedin",
      targetUrl: target.postUrl,
      repliedText: config.replyText,
      verified: verifyResult.data ?? false,
    };
  } finally {
    await browser.close();
  }
}

export async function runXReply(
  config: OrchestratorConfig
): Promise<OrchestratorResult> {
  if (!config.searchQuery) {
    return { success: false, platform: "x", error: "searchQuery required for X tasks" };
  }

  const maxRetries = config.maxRetries ?? 2;
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    log("X: checking login...");
    const loginResult = await withRetry(
      () => xLoginCheck(page),
      maxRetries,
      "login-check"
    );
    if (!loginResult.success || !loginResult.data) {
      return {
        success: false,
        platform: "x",
        error: "Not logged into X. Please log in manually first.",
      };
    }

    log(`X: searching for "${config.searchQuery}"...`);
    const searchResult = await withRetry(
      () => searchTopic(page, config.searchQuery!, "latest"),
      maxRetries,
      "search-topic"
    );
    if (!searchResult.success) {
      return { success: false, platform: "x", error: searchResult.error };
    }

    log("X: scrolling results...");
    const scrollResult = await withRetry(
      () => scrollResults(page, 4),
      maxRetries,
      "scroll-results"
    );
    if (!scrollResult.success || !scrollResult.data) {
      return { success: false, platform: "x", error: scrollResult.error };
    }
    log(`  Found ${scrollResult.data.length} tweets`);

    const criteria: FilterCriteria = {
      keywords: config.keywords,
      minEngagement: config.minEngagement ?? 10,
      maxAgeHours: config.maxAgeHours ?? 24,
    };

    const targetResult = findTargetTweet(scrollResult.data, criteria);
    if (!targetResult.success || !targetResult.data?.length) {
      return {
        success: false,
        platform: "x",
        error: "No matching tweets found with given criteria",
      };
    }

    const target = targetResult.data[0];
    log(`X: targeting tweet by ${target.handle} — ${target.tweetUrl}`);

    if (config.dryRun) {
      log(`[DRY RUN] Would reply to ${target.tweetUrl}: "${config.replyText}"`);
      return {
        success: true,
        platform: "x",
        targetUrl: target.tweetUrl,
        repliedText: config.replyText,
        verified: false,
        skipped: "dry-run",
      };
    }

    // Navigate to the tweet
    await page.goto(target.tweetUrl, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1_000);

    log("X: typing reply...");
    const typeResult = await withRetry(
      () => xTypeReply(page, config.replyText),
      maxRetries,
      "type-reply"
    );
    if (!typeResult.success) {
      return { success: false, platform: "x", error: typeResult.error };
    }

    log("X: submitting reply...");
    const submitResult = await withRetry(
      () => xSubmitReply(page),
      maxRetries,
      "submit-reply"
    );
    if (!submitResult.success) {
      return { success: false, platform: "x", error: submitResult.error };
    }

    log("X: verifying reply...");
    const verifyResult = await xVerifyReply(
      page,
      target.tweetUrl,
      config.replyText,
      config.myName
    );

    log(verifyResult.data ? "  Reply verified!" : "  Could not verify (may still have posted)");

    return {
      success: true,
      platform: "x",
      targetUrl: target.tweetUrl,
      repliedText: config.replyText,
      verified: verifyResult.data ?? false,
    };
  } finally {
    await browser.close();
  }
}

export async function runTask(
  config: OrchestratorConfig
): Promise<OrchestratorResult> {
  log(`Starting task: ${config.taskType}`);

  switch (config.taskType) {
    case "linkedin-reply":
      return runLinkedInReply(config);
    case "x-reply":
      return runXReply(config);
    default:
      return {
        success: false,
        platform: "unknown",
        error: `Unknown task type: ${String(config.taskType)}`,
      };
  }
}

// CLI entry point
if (require.main === module) {
  const config: OrchestratorConfig = {
    taskType: (process.env.TASK_TYPE as TaskType) ?? "linkedin-reply",
    keywords: process.env.KEYWORDS?.split(","),
    searchQuery: process.env.SEARCH_QUERY,
    minEngagement: Number(process.env.MIN_ENGAGEMENT ?? 50),
    maxAgeHours: Number(process.env.MAX_AGE_HOURS ?? 48),
    replyText: process.env.REPLY_TEXT ?? "",
    myName: process.env.MY_NAME ?? "Trent",
    dryRun: process.env.DRY_RUN === "true",
    maxRetries: Number(process.env.MAX_RETRIES ?? 2),
  };

  if (!config.replyText) {
    console.error("REPLY_TEXT env var is required");
    process.exit(1);
  }

  runTask(config)
    .then((result) => {
      console.log(JSON.stringify(result, null, 2));
      process.exit(result.success ? 0 : 1);
    })
    .catch((err) => {
      console.error("Fatal:", err);
      process.exit(1);
    });
}
