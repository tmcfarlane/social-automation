import type { Page, Comment, SkillResult } from "../types";

/**
 * Navigate to a post URL and extract its comments as structured data.
 */
export async function readComments(
  page: Page,
  postUrl: string
): Promise<SkillResult<Comment[]>> {
  try {
    await page.goto(postUrl, { waitUntil: "domcontentloaded", timeout: 15_000 });

    // Wait for comment section
    await page
      .locator("div.comments-comments-list")
      .waitFor({ timeout: 8_000 })
      .catch(() => {}); // comments may not exist yet

    // Expand "Load more comments" up to 3 times
    for (let i = 0; i < 3; i++) {
      const btn = page.locator("button.comments-comments-list__load-more-comments-button");
      if (await btn.isVisible().catch(() => false)) {
        await btn.click();
        await page.waitForTimeout(800);
      } else {
        break;
      }
    }

    const commentEls = await page
      .locator("article.comments-comment-item")
      .all()
      .catch(() => []);

    const comments: Comment[] = [];

    for (const el of commentEls) {
      try {
        const commenter = await el
          .locator("span.comments-post-meta__name-text")
          .first()
          .innerText()
          .catch(() => "");

        const text = await el
          .locator("div.comments-comment-item__main-content")
          .first()
          .innerText()
          .catch(() => "");

        const timestamp = await el
          .locator("time")
          .first()
          .getAttribute("datetime")
          .catch(() => "");

        const likesAttr = await el
          .locator("button[aria-label*='like']")
          .first()
          .getAttribute("aria-label")
          .catch(() => "0");

        const likes = parseInt(likesAttr?.match(/\d+/)?.[0] ?? "0", 10);

        if (commenter || text) {
          comments.push({
            commenter: commenter.trim(),
            text: text.trim(),
            timestamp: timestamp ?? "",
            likes,
          });
        }
      } catch {
        // Skip malformed comment
      }
    }

    return { success: true, data: comments };
  } catch (err) {
    return {
      success: false,
      error: `Failed to read comments: ${String(err)}`,
    };
  }
}
