import type { Page, PostCard, SkillResult } from "../types";
import { randomScrollAmount } from "../shared/safety.js";

/**
 * Convert relative time text ("2h", "1d", "3w", "30m") into an ISO timestamp.
 */
function relativeToISO(relText: string): string {
  const match = relText.match(/(\d+)\s*([mhdw])/i);
  if (!match) return "";
  const value = parseInt(match[1]!, 10);
  const unit = match[2]!.toLowerCase();
  const ms = { m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000 }[unit] ?? 0;
  return new Date(Date.now() - value * ms).toISOString();
}

/**
 * Scroll the LinkedIn feed and extract structured post card data.
 *
 * Uses a single page.evaluate() call to extract all data at once (fast),
 * rather than individual Playwright locator calls per card (slow).
 *
 * Relies on stable ARIA roles and data-testid attributes:
 * - Post cards: div[role="listitem"]
 * - Post text: [data-testid="expandable-text-box"]
 * - Author: button[aria-label*="post by"]
 * - Engagement: text matching "N reactions", "N comments", "N reposts"
 */
export async function scrollFeed(
  page: Page,
  scrollPasses = 5
): Promise<SkillResult<PostCard[]>> {
  try {
    // Wait for at least one listitem to appear
    await page.locator("div[role='listitem']").first().waitFor({ timeout: 10_000 }).catch(() => {});

    const initialCount = await page.locator("div[role='listitem']").count().catch(() => 0);
    console.log(JSON.stringify({ ts: new Date().toISOString(), event: "scroll_start", initialCards: initialCount }));

    if (initialCount === 0) {
      return { success: true, data: [] };
    }

    // Scroll to load more posts
    for (let i = 0; i < scrollPasses; i++) {
      const scrollPx = randomScrollAmount();
      await page.evaluate((px) => window.scrollBy(0, px), scrollPx);
      await page.waitForTimeout(1_200 + Math.random() * 800);
    }

    // Scroll back to top so we can interact with posts later
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(500);

    // Extract ALL post data in a single evaluate call (much faster than per-element locator calls)
    const rawPosts = await page.evaluate(() => {
      const items = document.querySelectorAll("div[role='listitem']");
      const results: {
        author: string;
        authorUrl: string;
        content: string;
        postUrl: string;
        fullText: string;
        index: number;
      }[] = [];

      items.forEach((item, idx) => {
        // Author from control menu button
        let author = "";
        const controlBtn = item.querySelector("button[aria-label*='post by']");
        if (controlBtn) {
          const label = controlBtn.getAttribute("aria-label") ?? "";
          author = label.replace(/^.*post by\s*/i, "").trim();
        }

        // Full text for engagement/time parsing and promo detection
        const fullText = (item as HTMLElement).innerText ?? "";

        // Skip promoted posts
        if (fullText.includes("Promoted")) return;

        // Skip job postings, recruiting content, and "open to work" posts
        const jobSignals = [
          "View job", "View job preferences", "is open to work",
          "is hiring", "Apply now", "Easy Apply",
          "NEW Opportunity", "We're hiring", "Join our team",
        ];
        if (jobSignals.some((s) => fullText.includes(s))) return;

        // Author URL
        let authorUrl = "";
        const profileLink = item.querySelector("a[href*='/in/']") as HTMLAnchorElement;
        if (profileLink) {
          authorUrl = profileLink.href;
        } else {
          const companyLink = item.querySelector("a[href*='/company/']") as HTMLAnchorElement;
          if (companyLink) authorUrl = companyLink.href;
        }

        // Post content from expandable text box
        const textBox = item.querySelector("[data-testid='expandable-text-box']");
        const content = textBox ? (textBox as HTMLElement).innerText?.trim() ?? "" : "";

        if (!content) return;

        // Post URL (rare in new LinkedIn)
        let postUrl = "";
        const updateLink = item.querySelector("a[href*='/feed/update/']") as HTMLAnchorElement;
        if (updateLink) postUrl = updateLink.href.split("?")[0] ?? "";

        results.push({ author, authorUrl, content, postUrl, fullText, index: idx });
      });

      return results;
    });

    // Post-process in Node (engagement parsing, timestamp conversion, dedup)
    const posts: PostCard[] = [];
    const seen = new Set<string>();

    for (const raw of rawPosts) {
      const dedupKey = raw.content.slice(0, 100);
      if (seen.has(dedupKey)) continue;
      seen.add(dedupKey);

      // Parse engagement from full text
      const parseCount = (text: string, keyword: string): number => {
        const re = new RegExp(`(\\d[\\d,]*)\\s*${keyword}`, "i");
        const m = text.match(re);
        return m ? parseInt(m[1]!.replace(/,/g, ""), 10) || 0 : 0;
      };

      const likes = parseCount(raw.fullText, "reaction");
      const comments = parseCount(raw.fullText, "comment");
      const reposts = parseCount(raw.fullText, "repost");

      // Parse timestamp
      let timestamp = "";
      const timeMatch = raw.fullText.match(/(\d+[hmdw])\s*•/);
      if (timeMatch) {
        timestamp = relativeToISO(timeMatch[1]!);
      }

      posts.push({
        author: raw.author,
        authorUrl: raw.authorUrl,
        content: raw.content,
        postUrl: raw.postUrl,
        likes,
        comments,
        reposts,
        timestamp,
        postIndex: raw.index,
      });
    }

    console.log(JSON.stringify({
      ts: new Date().toISOString(),
      event: "scroll_done",
      extractedPosts: posts.length,
    }));

    return { success: true, data: posts };
  } catch (err) {
    return { success: false, error: `Failed to scroll feed: ${String(err)}` };
  }
}
