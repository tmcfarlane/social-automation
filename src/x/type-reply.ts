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
    // Dismiss any open overlay/modal that might block clicks (cookie prompts, notification dialogs, etc.)
    const mask = page.locator('[data-testid="twc-cc-mask"]');
    if (await mask.isVisible().catch(() => false)) {
      await page.keyboard.press("Escape");
      await page.waitForTimeout(400);
    }

    // Click the reply button on the main tweet (first card)
    const replyBtn = page
      .locator('[data-testid="tweet"]')
      .first()
      .locator('[data-testid="reply"]');

    await replyBtn.waitFor({ timeout: 8_000 });
    await replyBtn.click();
    await page.waitForTimeout(800);

    // The reply compose box
    const composeBox = page
      .locator('[data-testid="tweetTextarea_0"]')
      .first();

    await composeBox.waitFor({ timeout: 5_000 });

    // Wait for any mask overlay to clear before clicking (it may reappear briefly)
    await page.locator('[data-testid="twc-cc-mask"]').waitFor({ state: "hidden", timeout: 5_000 }).catch(() => {});

    // Use force:true as fallback if mask is still present but textarea is ready
    await composeBox.click({ force: true });
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
