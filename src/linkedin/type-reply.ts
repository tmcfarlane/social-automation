import type { Page, SkillResult } from "../types";

/**
 * Click the comment box on the current post page and type the provided reply text.
 * Assumes the browser is already on the post page.
 */
export async function typeReply(
  page: Page,
  text: string
): Promise<SkillResult<void>> {
  try {
    // Find and click the comment box (LinkedIn uses a contenteditable div)
    const commentBox = page
      .locator("div.ql-editor[contenteditable='true']")
      .first();

    await commentBox.waitFor({ timeout: 8_000 });
    await commentBox.click();
    await page.waitForTimeout(400);

    // Clear any existing text then type
    await commentBox.fill("");
    await commentBox.type(text, { delay: 30 });

    // Confirm text is present
    const typed = await commentBox.innerText();
    if (!typed.trim()) {
      return { success: false, error: "Comment box appears empty after typing" };
    }

    return { success: true };
  } catch (err) {
    return { success: false, error: `Failed to type reply: ${String(err)}` };
  }
}
