import type { Page, Comment, SkillResult } from "../types";

/**
 * Navigate to a tweet URL and extract the thread/replies as structured data.
 */
export async function readThread(
  page: Page,
  tweetUrl: string
): Promise<SkillResult<Comment[]>> {
  try {
    await page.goto(tweetUrl, { waitUntil: "domcontentloaded", timeout: 15_000 });

    // Wait for the tweet detail to load
    await page
      .locator('[data-testid="tweet"]')
      .first()
      .waitFor({ timeout: 8_000 });

    await page.waitForTimeout(1_000);

    // All tweet cards on the thread page (index 0 is the original tweet)
    const cards = await page.locator('[data-testid="tweet"]').all().catch(() => []);

    const replies: Comment[] = [];

    const T = { timeout: 2_000 };

    // Skip the first card (the original tweet itself)
    for (const card of cards.slice(1)) {
      try {
        const commenter = await card
          .locator('[data-testid="User-Name"] span')
          .first()
          .innerText(T)
          .catch(() => "");

        const text = await card
          .locator('[data-testid="tweetText"]')
          .first()
          .innerText(T)
          .catch(() => "");

        const timestamp = await card
          .locator("time")
          .first()
          .getAttribute("datetime", T)
          .catch(() => "");

        const likeLabel = await card
          .locator('[data-testid="like"]')
          .getAttribute("aria-label", T)
          .catch(() => "0");

        const likes = parseInt(likeLabel?.match(/\d+/)?.[0] ?? "0", 10);

        if (commenter || text) {
          replies.push({
            commenter: commenter.trim(),
            text: text.trim(),
            timestamp: timestamp ?? "",
            likes,
          });
        }
      } catch {
        // Skip malformed entries
      }
    }

    return { success: true, data: replies };
  } catch (err) {
    return {
      success: false,
      error: `Failed to read thread: ${String(err)}`,
    };
  }
}
