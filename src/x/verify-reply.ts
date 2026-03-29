import type { Page, SkillResult } from "../types";
import { readThread } from "./read-thread";

/**
 * Verify that a reply was successfully posted by re-reading the thread
 * and checking for the expected text from our handle.
 */
export async function verifyReply(
  page: Page,
  tweetUrl: string,
  expectedText: string,
  myHandle = "Trent"
): Promise<SkillResult<boolean>> {
  try {
    await page.waitForTimeout(1_500);
    const result = await readThread(page, tweetUrl);

    if (!result.success || !result.data) {
      return { success: false, error: result.error ?? "Could not read thread" };
    }

    const myHandleLower = myHandle.toLowerCase();
    const snippet = expectedText.slice(0, 30).toLowerCase();

    const found = result.data.some(
      (r) =>
        r.commenter.toLowerCase().includes(myHandleLower) &&
        r.text.toLowerCase().includes(snippet)
    );

    return { success: true, data: found };
  } catch (err) {
    return {
      success: false,
      error: `Failed to verify reply: ${String(err)}`,
    };
  }
}
