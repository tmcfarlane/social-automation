import type { Page, SkillResult } from "../types";
import { readComments } from "./read-comments";

/**
 * Check whether Trent has already commented on a LinkedIn post.
 * Returns true if a comment by myName exists, false otherwise.
 */
export async function checkAlreadyReplied(
  page: Page,
  postUrl: string,
  myName = "Trent"
): Promise<SkillResult<boolean>> {
  try {
    const result = await readComments(page, postUrl);

    if (!result.success || !result.data) {
      return { success: false, error: result.error ?? "Could not read comments" };
    }

    const myNameLower = myName.toLowerCase();
    const alreadyReplied = result.data.some((c) =>
      c.commenter.toLowerCase().includes(myNameLower)
    );

    return { success: true, data: alreadyReplied };
  } catch (err) {
    return {
      success: false,
      error: `Failed to check reply status: ${String(err)}`,
    };
  }
}
