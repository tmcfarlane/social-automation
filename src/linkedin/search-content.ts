/**
 * LinkedIn content search — navigates to LinkedIn's content search with a query.
 * After this, scrollFeed() can be used to extract post cards from the results.
 *
 * Uses relevance sort by default — this surfaces high-engagement posts.
 * Date sort gives fresh-but-zero-engagement posts, which aren't useful.
 */
import type { Page } from "playwright";
import type { SkillResult } from "../types.js";

export async function searchContent(
  page: Page,
  query: string,
  sortBy: "relevance" | "date_posted" = "relevance"
): Promise<SkillResult<void>> {
  try {
    const encoded = encodeURIComponent(query);
    // Only add sortBy param for date_posted; omitting it gives relevance (default)
    const sortParam = sortBy === "date_posted" ? `&sortBy=%22date_posted%22` : "";
    const url = `https://www.linkedin.com/search/results/content/?keywords=${encoded}${sortParam}`;

    console.log(JSON.stringify({ ts: new Date().toISOString(), event: "search_navigate", query, sortBy, url }));

    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15_000 });
    await page.waitForTimeout(5_000);

    // LinkedIn search results use div[role='listitem'] just like the feed
    const selectors = [
      "div[role='listitem']",
      "div[role='list']",
    ];

    for (const sel of selectors) {
      const count = await page.locator(sel).count().catch(() => 0);
      if (count > 0) {
        console.log(JSON.stringify({ ts: new Date().toISOString(), event: "search_results_found", selector: sel, count }));
        return { success: true };
      }
    }

    console.log(JSON.stringify({ ts: new Date().toISOString(), event: "search_no_results", url: page.url() }));
    return { success: false, error: "No search results found" };
  } catch (err) {
    return { success: false, error: `searchContent failed: ${String(err)}` };
  }
}
