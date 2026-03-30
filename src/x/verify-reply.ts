import type { Page, SkillResult } from "../types";

async function findSnippetOnPage(page: Page, snippet: string): Promise<boolean> {
  const cards = await page.locator('[data-testid="tweet"]').all().catch(() => []);
  for (const card of cards) {
    const text = await card
      .locator('[data-testid="tweetText"]')
      .first()
      .innerText()
      .catch(() => "");
    if (text.toLowerCase().includes(snippet)) return true;
  }
  return false;
}

/**
 * Verify that a reply was successfully posted.
 * Strategy:
 *   1. Check the current page first (X often renders the reply inline immediately after submit).
 *   2. If not found, wait and reload — gives X time to persist.
 *   3. Scroll down to trigger lazy-loaded replies before final check.
 */
export async function verifyReply(
  page: Page,
  tweetUrl: string,
  expectedText: string,
  _myHandle = "hodlmecloseplz"
): Promise<SkillResult<boolean>> {
  try {
    const snippet = expectedText.slice(0, 40).toLowerCase();

    // ── Pass 1: Check current page immediately (no navigation) ──────────────
    // After submitReply the compose modal closes and X often shows the new reply inline.
    await page.waitForTimeout(2_500);
    if (await findSnippetOnPage(page, snippet)) {
      return { success: true, data: true };
    }

    // ── Pass 2: Navigate with full wait + scroll to load replies ────────────
    await page.goto(tweetUrl, { waitUntil: "domcontentloaded", timeout: 20_000 });
    // Wait for at least one tweet card to appear
    await page.locator('[data-testid="tweet"]').first().waitFor({ timeout: 10_000 }).catch(() => {});
    // Scroll to trigger lazy-loaded reply cards
    await page.evaluate(() => window.scrollBy(0, 600));
    await page.waitForTimeout(2_000);

    if (await findSnippetOnPage(page, snippet)) {
      return { success: true, data: true };
    }

    // ── Pass 3: One more scroll + wait in case X is slow ───────────────────
    await page.evaluate(() => window.scrollBy(0, 600));
    await page.waitForTimeout(2_000);
    if (await findSnippetOnPage(page, snippet)) {
      return { success: true, data: true };
    }

    // ── Pass 4: Hard refresh — clears any stale/cached state ───────────────
    await page.reload({ waitUntil: "domcontentloaded", timeout: 20_000 });
    await page.locator('[data-testid="tweet"]').first().waitFor({ timeout: 10_000 }).catch(() => {});
    await page.evaluate(() => window.scrollBy(0, 600));
    await page.waitForTimeout(2_500);
    if (await findSnippetOnPage(page, snippet)) {
      return { success: true, data: true };
    }

    return { success: true, data: false };
  } catch (err) {
    return {
      success: false,
      error: `Failed to verify reply: ${String(err)}`,
    };
  }
}
