import type { Page } from "playwright";

const MY_HANDLE = "hodlmecloseplz";

function extractHandle(href: string | null | undefined): string {
  if (!href) return "";
  // href is typically "/username" — strip all leading slashes
  return href.replace(/^\/+/, "").toLowerCase();
}

/**
 * Scroll down to ensure replies are loaded before checking the thread.
 */
async function loadReplies(page: Page): Promise<void> {
  await page.evaluate(() => window.scrollBy(0, 600));
  await page.waitForTimeout(1_000);
  await page.evaluate(() => window.scrollBy(0, 600));
  await page.waitForTimeout(800);
}

/**
 * Check if we are the last commenter in a thread.
 * Returns true if we should SKIP this thread (we already replied last).
 */
export async function isLastCommenterUs(page: Page): Promise<boolean> {
  try {
    await loadReplies(page);

    const cards = await page.locator('[data-testid="tweet"]').all().catch(() => []);
    if (cards.length < 2) return false;

    // Last reply card in the visible thread
    const lastCard = cards[cards.length - 1]!;
    const handleHref = await lastCard
      .locator('[data-testid="User-Name"] a[href*="/"]')
      .nth(1)
      .getAttribute("href", { timeout: 2_000 })
      .catch(() => "");

    return extractHandle(handleHref) === MY_HANDLE.toLowerCase();
  } catch {
    return false;
  }
}

/**
 * Check if we have ANY reply in this thread.
 * More reliable than isLastCommenterUs — catches cases where someone replied after us.
 */
export async function hasOurReply(page: Page): Promise<boolean> {
  try {
    await loadReplies(page);

    const cards = await page.locator('[data-testid="tweet"]').all().catch(() => []);

    // Skip the first card (the original tweet) — check all replies
    for (const card of cards.slice(1)) {
      const handleHref = await card
        .locator('[data-testid="User-Name"] a[href*="/"]')
        .nth(1)
        .getAttribute("href", { timeout: 2_000 })
        .catch(() => "");
      if (extractHandle(handleHref) === MY_HANDLE.toLowerCase()) {
        return true;
      }
    }

    return false;
  } catch {
    return false;
  }
}

/**
 * Count how many times we've replied in a thread.
 */
export async function countOurReplies(page: Page): Promise<number> {
  try {
    const cards = await page.locator('[data-testid="tweet"]').all().catch(() => []);
    let count = 0;

    for (const card of cards.slice(1)) {
      const handleHref = await card
        .locator('[data-testid="User-Name"] a[href*="/"]')
        .nth(1)
        .getAttribute("href", { timeout: 2_000 })
        .catch(() => "");
      if (extractHandle(handleHref) === MY_HANDLE.toLowerCase()) {
        count++;
      }
    }

    return count;
  } catch {
    return 0;
  }
}
