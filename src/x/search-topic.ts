import type { Page, SkillResult } from "../types";

/**
 * Navigate to X search for a given query.
 * @param query The search term(s)
 * @param tab   Which tab to open: "latest" (default) or "top"
 */
export async function searchTopic(
  page: Page,
  query: string,
  tab: "latest" | "top" = "latest"
): Promise<SkillResult<void>> {
  try {
    const encoded = encodeURIComponent(query);
    const tabParam = tab === "latest" ? "&f=live" : "";
    const url = `https://x.com/search?q=${encoded}${tabParam}`;

    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15_000 });

    // Wait for tweet cards to appear
    await page
      .locator('[data-testid="tweet"]')
      .first()
      .waitFor({ timeout: 10_000 });

    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: `Failed to search topic "${query}": ${String(err)}`,
    };
  }
}
