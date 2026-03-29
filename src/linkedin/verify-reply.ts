import type { Page, SkillResult } from "../types";
import { readComments } from "./read-comments";

/**
 * Verify that a reply was successfully posted by re-reading the comments
 * and checking for the expected text.
 */
export async function verifyReply(
  page: Page,
  postUrl: string,
  expectedText: string,
  myName = "Trent"
): Promise<SkillResult<boolean>> {
  try {
    // Re-read comments after a short wait
    await page.waitForTimeout(1500);
    const result = await readComments(page, postUrl);

    if (!result.success || !result.data) {
      return { success: false, error: result.error ?? "Could not read comments" };
    }

    const myNameLower = myName.toLowerCase();
    const snippet = expectedText.slice(0, 30).toLowerCase();

    const found = result.data.some(
      (c) =>
        c.commenter.toLowerCase().includes(myNameLower) &&
        c.text.toLowerCase().includes(snippet)
    );

    return { success: true, data: found };
  } catch (err) {
    return { success: false, error: `Failed to verify reply: ${String(err)}` };
  }
}
