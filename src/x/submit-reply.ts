import type { Page, SkillResult } from "../types";

/**
 * Click the submit button to post the reply currently typed in the compose box.
 * Assumes typeReply() has already been called.
 */
export async function submitReply(page: Page): Promise<SkillResult<void>> {
  try {
    // X's reply submit button inside the reply dialog
    const submitBtn = page
      .locator('[data-testid="tweetButton"]')
      .first();

    await submitBtn.waitFor({ timeout: 5_000 });
    await submitBtn.click();

    // Wait for the post to submit
    await page.waitForTimeout(1_500);

    return { success: true };
  } catch (err) {
    return { success: false, error: `Failed to submit reply: ${String(err)}` };
  }
}
