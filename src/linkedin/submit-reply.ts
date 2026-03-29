import type { Page, SkillResult } from "../types";

/**
 * Click the submit/post button for the comment currently typed in the box.
 * Assumes typeReply() has already been called.
 */
export async function submitReply(page: Page): Promise<SkillResult<void>> {
  try {
    // LinkedIn's comment submit button
    const submitBtn = page
      .locator("button.comments-comment-box__submit-button--cr")
      .first();

    const fallbackBtn = page
      .locator("button[data-control-name='comment.submit']")
      .first();

    let btn = submitBtn;
    if (!(await submitBtn.isVisible().catch(() => false))) {
      btn = fallbackBtn;
    }

    await btn.waitFor({ timeout: 5_000 });
    await btn.click();

    // Wait briefly for the comment to post
    await page.waitForTimeout(1_500);

    return { success: true };
  } catch (err) {
    return { success: false, error: `Failed to submit reply: ${String(err)}` };
  }
}
