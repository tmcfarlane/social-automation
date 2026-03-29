import type { Page, PostCard, SkillResult } from "../types";

function parseCount(raw: string): number {
  if (!raw) return 0;
  const clean = raw.replace(/,/g, "").trim();
  if (clean.endsWith("K")) return Math.round(parseFloat(clean) * 1_000);
  if (clean.endsWith("M")) return Math.round(parseFloat(clean) * 1_000_000);
  return parseInt(clean, 10) || 0;
}

/**
 * Scroll the LinkedIn feed and extract structured post card data.
 * @param scrollPasses Number of scroll-and-extract passes (each pass scrolls ~800px)
 */
export async function scrollFeed(
  page: Page,
  scrollPasses = 5
): Promise<SkillResult<PostCard[]>> {
  try {
    const posts: PostCard[] = [];
    const seen = new Set<string>();

    for (let i = 0; i < scrollPasses; i++) {
      // Scroll down
      await page.evaluate(() => window.scrollBy(0, 800));
      await page.waitForTimeout(1_200);

      // Extract all visible post cards
      const cards = await page
        .locator("div.feed-shared-update-v2")
        .all()
        .catch(() => []);

      for (const card of cards) {
        try {
          // Author name
          const author = await card
            .locator("span.update-components-actor__name")
            .first()
            .innerText()
            .catch(() => "");

          // Author profile URL
          const authorUrl = await card
            .locator("a.update-components-actor__meta-link")
            .first()
            .getAttribute("href")
            .catch(() => "");

          // Post content text
          const content = await card
            .locator("div.update-components-text")
            .first()
            .innerText()
            .catch(() => "");

          // Post URL — from the timestamp link
          const postUrl = await card
            .locator("a.app-aware-link[href*='/posts/']")
            .first()
            .getAttribute("href")
            .catch(() => "");

          const resolvedUrl = postUrl
            ? new URL(postUrl, "https://www.linkedin.com").href
            : "";

          if (!resolvedUrl || seen.has(resolvedUrl)) continue;
          seen.add(resolvedUrl);

          // Engagement counts
          const likesText = await card
            .locator("button[aria-label*='reaction']")
            .first()
            .getAttribute("aria-label")
            .catch(() => "0");
          const commentsText = await card
            .locator("button[aria-label*='comment']")
            .first()
            .getAttribute("aria-label")
            .catch(() => "0");
          const repostsText = await card
            .locator("button[aria-label*='repost']")
            .first()
            .getAttribute("aria-label")
            .catch(() => "0");

          // Extract leading number from aria-labels like "1,234 reactions"
          const extractNum = (s: string | null) =>
            parseCount(s?.match(/[\d,.KM]+/)?.[0] ?? "0");

          // Timestamp
          const timestamp = await card
            .locator("span.update-components-actor__sub-description time")
            .first()
            .getAttribute("datetime")
            .catch(() => "");

          posts.push({
            author: author.trim(),
            authorUrl: authorUrl ?? "",
            content: content.trim(),
            postUrl: resolvedUrl,
            likes: extractNum(likesText),
            comments: extractNum(commentsText),
            reposts: extractNum(repostsText),
            timestamp: timestamp ?? "",
          });
        } catch {
          // Skip malformed cards
        }
      }
    }

    return { success: true, data: posts };
  } catch (err) {
    return { success: false, error: `Failed to scroll feed: ${String(err)}` };
  }
}
