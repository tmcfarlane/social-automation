/**
 * Cleanup duplicate replies.
 *
 * Flow:
 * 1. Go to profile → Replies tab
 * 2. Collect every unique thread URL we've replied to
 * 3. Visit each thread
 * 4. Find all our replies, keep the OLDEST, delete the rest
 * 5. Re-navigate between each delete for a clean DOM
 *
 * Usage:
 *   npx tsx src/x/cleanup-duplicates.ts                    # auto-discover from profile
 *   npx tsx src/x/cleanup-duplicates.ts <thread-url>       # clean a specific thread
 */
import type { Page } from "playwright";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { ensureBrowser } from "./ensure-chrome.js";

const MY_HANDLE = "hodlmecloseplz";
const LOG_DIR = "C:\\Users\\Trent\\rep\\COMMAND CENTER\\Command Center\\SocialMediaEngine\\X\\state";

/** Append ?sort_replies=recency to a thread URL so our recent duplicates show first */
function recencyUrl(threadUrl: string): string {
  const u = new URL(threadUrl);
  u.searchParams.set("sort_replies", "recency");
  return u.toString();
}

function log(entry: Record<string, unknown>): void {
  console.log(JSON.stringify({ ts: new Date().toISOString(), ...entry }));
}

// ── Discover thread URLs from profile ─────────────────────────────────────

async function discoverThreadsFromProfile(page: Page): Promise<string[]> {
  await page.goto(`https://x.com/${MY_HANDLE}/with_replies`, {
    waitUntil: "domcontentloaded",
    timeout: 30_000,
  });
  await page.waitForTimeout(2_500);

  // Scroll aggressively to load 10+ hours of activity
  for (let i = 0; i < 12; i++) {
    await page.evaluate(() => window.scrollBy(0, 900));
    await page.waitForTimeout(800 + Math.random() * 400);
  }

  const T = { timeout: 2_000 };
  const cards = await page.locator('[data-testid="tweet"]').all().catch(() => []);
  const threadUrls = new Set<string>();

  for (const card of cards) {
    try {
      // Check this is our tweet
      const handleHref = await card
        .locator('[data-testid="User-Name"] a[href*="/"]')
        .nth(1)
        .getAttribute("href", T)
        .catch(() => "");
      const handle = handleHref?.replace("/", "").toLowerCase() ?? "";
      if (handle !== MY_HANDLE.toLowerCase()) continue;

      // Look for "Replying to" links — these point to the parent tweet
      // On profile page, our replies show a "in reply to @X" context
      // The tweet URL itself gives us our reply; we need the parent thread.
      // Best approach: grab our tweet URL, we'll resolve the parent when we visit it.
      const timeEl = card.locator("time").first();
      const replyPath = await timeEl.locator("..").getAttribute("href", T).catch(() => "");
      if (replyPath) {
        threadUrls.add(`https://x.com${replyPath}`);
      }
    } catch {
      // skip
    }
  }

  return [...threadUrls];
}

// ── Resolve parent thread from a reply URL ────────────────────────────────

async function resolveParentThread(page: Page, replyUrl: string): Promise<string> {
  await page.goto(replyUrl, { waitUntil: "domcontentloaded", timeout: 15_000 });
  await page.waitForTimeout(1_500);

  const T = { timeout: 2_000 };
  const cards = await page.locator('[data-testid="tweet"]').all().catch(() => []);

  // Walk cards from top — first non-us tweet is the parent
  for (const card of cards) {
    const handleHref = await card
      .locator('[data-testid="User-Name"] a[href*="/"]')
      .nth(1)
      .getAttribute("href", T)
      .catch(() => "");
    const handle = handleHref?.replace("/", "").toLowerCase() ?? "";

    if (handle && handle !== MY_HANDLE.toLowerCase()) {
      const parentPath = await card
        .locator("time")
        .first()
        .locator("..")
        .getAttribute("href", T)
        .catch(() => "");
      if (parentPath) return `https://x.com${parentPath}`;
    }
  }

  return "";
}

// ── Load thread with recency sort and get reply cards (stop at "Discover more")

async function loadThreadCards(page: Page, threadUrl: string): Promise<import("playwright").Locator[]> {
  await page.goto(recencyUrl(threadUrl), { waitUntil: "domcontentloaded", timeout: 20_000 });
  await page.waitForTimeout(2_000);

  for (let i = 0; i < 4; i++) {
    await page.evaluate(() => window.scrollBy(0, 600));
    await page.waitForTimeout(600);
  }

  const allCards = await page.locator('[data-testid="tweet"]').all().catch(() => []);
  const T = { timeout: 1_000 };
  const cards: import("playwright").Locator[] = [];

  for (const card of allCards) {
    // Stop if we hit a "Discover more" / "More Tweets" boundary
    const text = await card.innerText(T).catch(() => "");
    if (/discover more/i.test(text)) break;
    cards.push(card);
  }

  return cards;
}

// ── Find all our reply texts in a thread ──────────────────────────────────

async function findOurRepliesInThread(page: Page, threadUrl: string): Promise<string[]> {
  const cards = await loadThreadCards(page, threadUrl);
  const T = { timeout: 2_000 };
  const ourTexts: string[] = [];

  for (const card of cards) {
    const handleHref = await card
      .locator('[data-testid="User-Name"] a[href*="/"]')
      .nth(1)
      .getAttribute("href", T)
      .catch(() => "");
    const handle = handleHref?.replace("/", "").toLowerCase() ?? "";
    if (handle !== MY_HANDLE.toLowerCase()) continue;

    const text = await card.locator('[data-testid="tweetText"]').first().innerText(T).catch(() => "");
    if (text) ourTexts.push(text);
  }

  return ourTexts;
}

// ── Delete ONE specific reply by text match (navigate fresh each time) ────

async function deleteOneReply(page: Page, threadUrl: string, snippet: string): Promise<boolean> {
  const cards = await loadThreadCards(page, threadUrl);
  const T = { timeout: 2_000 };

  for (const card of cards) {
    const handleHref = await card
      .locator('[data-testid="User-Name"] a[href*="/"]')
      .nth(1)
      .getAttribute("href", T)
      .catch(() => "");
    const handle = handleHref?.replace("/", "").toLowerCase() ?? "";
    if (handle !== MY_HANDLE.toLowerCase()) continue;

    const text = await card.locator('[data-testid="tweetText"]').first().innerText(T).catch(() => "");
    if (!text.toLowerCase().includes(snippet.toLowerCase())) continue;

    // Click caret menu
    const caret = card.locator('[data-testid="caret"]');
    await caret.waitFor({ timeout: 3_000 });
    await caret.click();
    await page.waitForTimeout(1_000);

    // Click Delete
    const deleteItem = page.locator('[role="menuitem"]', { hasText: /Delete/i });
    if (!(await deleteItem.isVisible({ timeout: 3_000 }).catch(() => false))) {
      log({ event: "no_delete_option", snippet: snippet.slice(0, 50) });
      await page.keyboard.press("Escape");
      await page.waitForTimeout(500);
      return false;
    }
    await deleteItem.click();
    await page.waitForTimeout(1_000);

    // Confirm
    const confirmBtn = page.locator('[data-testid="confirmationSheetConfirm"]');
    await confirmBtn.waitFor({ timeout: 3_000 });
    await confirmBtn.click();
    await page.waitForTimeout(2_000);

    return true;
  }

  return false;
}

// ── Clean one thread: keep oldest, delete the rest ────────────────────────

async function cleanThread(page: Page, threadUrl: string): Promise<{ deleted: number; failed: number }> {
  let deleted = 0;
  let failed = 0;

  // Find all our replies
  const ourTexts = await findOurRepliesInThread(page, threadUrl);
  log({ event: "our_replies_in_thread", threadUrl, count: ourTexts.length });

  if (ourTexts.length <= 1) return { deleted: 0, failed: 0 };

  // On X thread pages, replies are ordered top-to-bottom newest-to-oldest.
  // The LAST one in the array is the oldest — that's the one we keep.
  const keepText = ourTexts[ourTexts.length - 1]!;
  const toDelete = ourTexts.slice(0, -1); // everything except the last (oldest)

  log({
    event: "thread_plan",
    threadUrl,
    keeping: keepText.slice(0, 60),
    deleting: toDelete.length,
  });

  // Delete one at a time with fresh navigation each time
  for (const text of toDelete) {
    const snippet = text.slice(0, 40);
    log({ event: "deleting", snippet });

    const success = await deleteOneReply(page, threadUrl, snippet);
    if (success) {
      log({ event: "deleted_ok", snippet });
      deleted++;
    } else {
      log({ event: "delete_failed", snippet });
      failed++;
    }

    // Pace between deletes
    await page.waitForTimeout(1_000 + Math.random() * 1_000);
  }

  // Final verification
  const remaining = await findOurRepliesInThread(page, threadUrl);
  log({ event: "thread_verified", threadUrl, remaining: remaining.length });

  return { deleted, failed };
}

// ── Main ──────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const browser = await ensureBrowser();
  const contexts = browser.contexts();
  const context = contexts.length > 0 ? contexts[0] : await browser.newContext();
  const existingPages = context.pages();
  const page = existingPages.length > 0 ? existingPages[0] : await context.newPage();

  log({ event: "cleanup_start" });

  // Check args: --dry-run and/or a specific thread URL
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const argUrl = args.find((a) => a.startsWith("http"));
  let threadUrls: string[] = [];
  if (dryRun) log({ event: "dry_run_mode" });

  if (argUrl) {
    // Direct thread URL provided
    threadUrls = [argUrl];
    log({ event: "direct_thread", url: argUrl });
  } else {
    // Discover from profile — collect our reply URLs
    const replyUrls = await discoverThreadsFromProfile(page);
    log({ event: "profile_replies_found", count: replyUrls.length });

    // Visit each reply URL, resolve parent + check for duplicates in one visit.
    // Skip threads we've already seen.
    const seenParents = new Set<string>();
    for (const replyUrl of replyUrls) {
      await page.goto(replyUrl, { waitUntil: "domcontentloaded", timeout: 15_000 });
      await page.waitForTimeout(1_500);

      // Find parent thread URL (first non-us tweet)
      const T = { timeout: 2_000 };
      const cards = await page.locator('[data-testid="tweet"]').all().catch(() => []);
      let parentUrl = "";
      let ourCount = 0;

      for (const card of cards) {
        const handleHref = await card
          .locator('[data-testid="User-Name"] a[href*="/"]')
          .nth(1)
          .getAttribute("href", T)
          .catch(() => "");
        const handle = handleHref?.replace("/", "").toLowerCase() ?? "";

        if (handle === MY_HANDLE.toLowerCase()) {
          ourCount++;
        } else if (handle && !parentUrl) {
          const parentPath = await card.locator("time").first().locator("..").getAttribute("href", T).catch(() => "");
          if (parentPath) parentUrl = `https://x.com${parentPath}`;
        }
      }

      if (!parentUrl || seenParents.has(parentUrl)) continue;
      seenParents.add(parentUrl);

      // Only queue threads where we have multiple replies
      if (ourCount > 1) {
        threadUrls.push(parentUrl);
        log({ event: "thread_needs_cleanup", parentUrl, ourReplies: ourCount });
      } else {
        log({ event: "thread_ok", parentUrl, ourReplies: ourCount });
      }
    }

    log({ event: "threads_to_clean", count: threadUrls.length });
  }

  // Clean each thread
  let totalDeleted = 0;
  let totalFailed = 0;

  for (const threadUrl of threadUrls) {
    log({ event: "checking_thread", threadUrl });

    if (dryRun) {
      // Just scan and report, don't delete
      const ourTexts = await findOurRepliesInThread(page, threadUrl);
      log({
        event: "dry_run_thread",
        threadUrl,
        ourReplies: ourTexts.length,
        wouldDelete: Math.max(0, ourTexts.length - 1),
        keeping: ourTexts.length > 0 ? ourTexts[ourTexts.length - 1]!.slice(0, 60) : "",
      });
      continue;
    }

    const result = await cleanThread(page, threadUrl);
    totalDeleted += result.deleted;
    totalFailed += result.failed;

    if (result.deleted > 0) {
      await page.waitForTimeout(2_000 + Math.random() * 2_000);
    }
  }

  // Summary
  const summary = { event: "cleanup_complete", threads: threadUrls.length, deleted: totalDeleted, failed: totalFailed };
  log(summary);

  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    fs.appendFileSync(path.join(LOG_DIR, "cleanup.log"), JSON.stringify({ ...summary, ts: new Date().toISOString() }) + "\n");
  } catch {}

  await browser.close().catch(() => {});
}

const isMain =
  process.argv[1] != null &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (isMain) {
  main()
    .then(() => {
      console.log("\n[cleanup] Done.");
      process.exit(0);
    })
    .catch((err) => {
      console.error("[cleanup] Fatal:", err);
      process.exit(1);
    });
}

export { main as runCleanup };
