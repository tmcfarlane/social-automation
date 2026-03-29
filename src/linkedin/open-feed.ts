import type { Page, SkillResult } from "../types";

/**
 * Navigate to the LinkedIn feed and wait for post cards to appear.
 */
export async function openFeed(page: Page): Promise<SkillResult<void>> {
  try {
    await page.goto("https://www.linkedin.com/feed/", {
      waitUntil: "domcontentloaded",
      timeout: 15_000,
    });

    // Wait for at least one post card to appear
    await page
      .locator('[data-id^="urn:li:activity"]')
      .first()
      .waitFor({ timeout: 10_000 });

    return { success: true };
  } catch (err) {
    return { success: false, error: `Failed to open feed: ${String(err)}` };
  }
}
