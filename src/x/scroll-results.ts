import type { Page, TweetCard, SkillResult } from "../types";

function parseXCount(raw: string): number {
  if (!raw) return 0;
  const clean = raw.replace(/,/g, "").trim();
  if (clean.endsWith("K")) return Math.round(parseFloat(clean) * 1_000);
  if (clean.endsWith("M")) return Math.round(parseFloat(clean) * 1_000_000);
  return parseInt(clean, 10) || 0;
}

/**
 * Scroll X search results and extract structured tweet card data.
 * @param scrollPasses Number of scroll-and-extract passes
 */
export async function scrollResults(
  page: Page,
  scrollPasses = 5
): Promise<SkillResult<TweetCard[]>> {
  try {
    const tweets: TweetCard[] = [];
    const seen = new Set<string>();

    for (let i = 0; i < scrollPasses; i++) {
      await page.evaluate(() => window.scrollBy(0, 800));
      await page.waitForTimeout(1_200);

      const cards = await page.locator('[data-testid="tweet"]').all().catch(() => []);

      for (const card of cards) {
        try {
          // Author display name
          const author = await card
            .locator('[data-testid="User-Name"] span')
            .first()
            .innerText()
            .catch(() => "");

          // @handle
          const handle = await card
            .locator('[data-testid="User-Name"] a[href*="/"]')
            .nth(1)
            .getAttribute("href")
            .catch(() => "");

          // Tweet text
          const content = await card
            .locator('[data-testid="tweetText"]')
            .first()
            .innerText()
            .catch(() => "");

          // Tweet URL (from the time element link)
          const tweetPath = await card
            .locator("time")
            .first()
            .locator("..")
            .getAttribute("href")
            .catch(() => "");

          const tweetUrl = tweetPath
            ? `https://x.com${tweetPath}`
            : "";

          if (!tweetUrl || seen.has(tweetUrl)) continue;
          seen.add(tweetUrl);

          // Engagement aria-labels
          const replyLabel = await card
            .locator('[data-testid="reply"]')
            .getAttribute("aria-label")
            .catch(() => "0");
          const retweetLabel = await card
            .locator('[data-testid="retweet"]')
            .getAttribute("aria-label")
            .catch(() => "0");
          const likeLabel = await card
            .locator('[data-testid="like"]')
            .getAttribute("aria-label")
            .catch(() => "0");

          const extractNum = (s: string | null) =>
            parseXCount(s?.match(/[\d,.KM]+/)?.[0] ?? "0");

          const timestamp = await card
            .locator("time")
            .first()
            .getAttribute("datetime")
            .catch(() => "");

          tweets.push({
            author: author.trim(),
            handle: handle ? handle.replace("/", "@") : "",
            content: content.trim(),
            tweetUrl,
            likes: extractNum(likeLabel),
            retweets: extractNum(retweetLabel),
            replies: extractNum(replyLabel),
            timestamp: timestamp ?? "",
          });
        } catch {
          // Skip malformed cards
        }
      }
    }

    return { success: true, data: tweets };
  } catch (err) {
    return {
      success: false,
      error: `Failed to scroll results: ${String(err)}`,
    };
  }
}
