import type { Page, SkillResult } from "../types";
import * as fs from "fs";
import { LINKEDIN_OUTBOUND_STATE_PATH } from "../paths.js";

/**
 * Check whether Trent has already commented on a LinkedIn post.
 *
 * Fast path: checks the outbound state file's commentedPostUrls array first.
 * If the URL is recorded there, returns true without touching the DOM.
 *
 * Slow path: navigates to the post, opens the comment section, expands all
 * collapsed comments, then scans commenter names for Trent's name.
 */

function isInCommentedState(postUrl: string): boolean {
  if (!postUrl) return false;
  try {
    const raw = JSON.parse(fs.readFileSync(LINKEDIN_OUTBOUND_STATE_PATH, "utf-8"));
    const commentedPostUrls: string[] = raw.commentedPostUrls ?? [];
    return commentedPostUrls.includes(postUrl);
  } catch {
    return false;
  }
}

export async function checkAlreadyReplied(
  page: Page,
  postUrl: string,
  myName = "Trent"
): Promise<SkillResult<boolean>> {
  try {
    // Step 1: Check state file first — no DOM interaction needed if already known
    if (isInCommentedState(postUrl)) {
      return { success: true, data: true };
    }

    // Step 2: Navigate to the post
    await page.goto(postUrl, { waitUntil: "domcontentloaded", timeout: 15_000 });
    await page.waitForTimeout(1_500);

    // Step 3: Click "Comment" to open the comment composer and reveal the comment list
    const commentBtn = page
      .locator("button")
      .filter({ hasText: /^Comment$/i })
      .first();
    if (await commentBtn.isVisible().catch(() => false)) {
      await commentBtn.click();
      await page.waitForTimeout(1_500);
    }

    // Step 4: Expand ALL comments — LinkedIn collapses them by default.
    // Click any "See all X comments" / "Load more" / "View more" buttons
    // repeatedly until none remain.
    const loadMorePatterns = [
      /see all \d+ comments?/i,
      /load more comments/i,
      /view more comments/i,
      /\d+ more comments?/i,
    ];

    for (let round = 0; round < 10; round++) {
      let clicked = false;

      for (const pattern of loadMorePatterns) {
        const btn = page
          .locator("button, span[role='button']")
          .filter({ hasText: pattern })
          .first();
        if (await btn.isVisible().catch(() => false)) {
          await btn.click();
          await page.waitForTimeout(1_000);
          clicked = true;
          break;
        }
      }

      // Also try LinkedIn's specific load-more class as a fallback
      if (!clicked) {
        const loadMoreClass = page.locator(
          "button.comments-comments-list__load-more-comments-button"
        );
        if (await loadMoreClass.isVisible().catch(() => false)) {
          await loadMoreClass.click();
          await page.waitForTimeout(1_000);
          clicked = true;
        }
      }

      if (!clicked) break;
    }

    // Step 5: Scan commenter names for Trent's name (case-insensitive).
    // LinkedIn renders commenter names in span.comments-post-meta__name-text.
    const commenterEls = await page
      .locator("span.comments-post-meta__name-text")
      .all()
      .catch(() => []);

    const myNameLower = myName.toLowerCase();

    for (const el of commenterEls) {
      const text = await el.innerText().catch(() => "");
      const textLower = text.toLowerCase();
      if (textLower.includes(myNameLower) || textLower.includes("trent mcfarlane")) {
        return { success: true, data: true };
      }
    }

    // Also check for Trent's profile URL slug in any comment author links
    const profileLinksCount = await page
      .locator("a[href*='trent-mcfarlane'], a[href*='trentmcfarlane']")
      .count()
      .catch(() => 0);

    return { success: true, data: profileLinksCount > 0 };
  } catch (err) {
    return {
      success: false,
      error: `Failed to check reply status: ${String(err)}`,
    };
  }
}
