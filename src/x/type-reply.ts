import type { Page, SkillResult } from "../types";

/**
 * Click the reply button on a tweet and type the provided reply text.
 * Assumes the browser is already on the tweet detail page.
 */
export async function typeReply(
  page: Page,
  text: string
): Promise<SkillResult<void>> {
  try {
    // Click the reply button on the main tweet (first card)
    const replyBtn = page
      .locator('[data-testid="tweet"]')
      .first()
      .locator('[data-testid="reply"]');

    await replyBtn.waitFor({ timeout: 8_000 });
    await replyBtn.click();
    await page.waitForTimeout(600);

    // The reply compose box
    const composeBox = page
      .locator('[data-testid="tweetTextarea_0"]')
      .first();

    await composeBox.waitFor({ timeout: 5_000 });
    await composeBox.click();
    await composeBox.type(text, { delay: 30 });

    const typed = await composeBox.innerText();
    if (!typed.trim()) {
      return { success: false, error: "Reply box appears empty after typing" };
    }

    return { success: true };
  } catch (err) {
    return { success: false, error: `Failed to type reply: ${String(err)}` };
  }
}
