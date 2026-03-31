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
      await page.evaluate(() => window.scrollBy(0, 1000 + Math.random() * 400));
      await page.waitForTimeout(1_500 + Math.random() * 500);

      const cards = await page.locator('[data-testid="tweet"]').all().catch(() => []);

      for (const card of cards) {
        try {
          const T = { timeout: 2_000 };

          // Author display name
          const author = await card
            .locator('[data-testid="User-Name"] span')
            .first()
            .innerText(T)
            .catch(() => "");

          // @handle
          const handle = await card
            .locator('[data-testid="User-Name"] a[href*="/"]')
            .nth(1)
            .getAttribute("href", T)
            .catch(() => "");

          // Tweet text
          const content = await card
            .locator('[data-testid="tweetText"]')
            .first()
            .innerText(T)
            .catch(() => "");

          // Tweet URL (from the time element link)
          const tweetPath = await card
            .locator("time")
            .first()
            .locator("..")
            .getAttribute("href", T)
            .catch(() => "");

          const tweetUrl = tweetPath
            ? `https://x.com${tweetPath}`
            : "";

          if (!tweetUrl || seen.has(tweetUrl)) continue;
          seen.add(tweetUrl);

          // Engagement counts — try innerText first (visible number), fall back to aria-label
          const extractCount = async (testId: string): Promise<number> => {
            const el = card.locator(`[data-testid="${testId}"]`);
            const text = await el.innerText(T).catch(() => "");
            const fromText = text.match(/[\d,.]+[KkMm]?/)?.[0];
            if (fromText) return parseXCount(fromText);
            const label = await el.getAttribute("aria-label", T).catch(() => "");
            const fromLabel = label?.match(/[\d,.]+[KkMm]?/)?.[0];
            return parseXCount(fromLabel ?? "0");
          };

          const timestamp = await card
            .locator("time")
            .first()
            .getAttribute("datetime", T)
            .catch(() => "");

          const [likes, retweets, replies] = await Promise.all([
            extractCount("like"),
            extractCount("retweet"),
            extractCount("reply"),
          ]);

          tweets.push({
            author: author.trim(),
            handle: handle ? handle.replace("/", "@") : "",
            content: content.trim(),
            tweetUrl,
            likes,
            retweets,
            replies,
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
