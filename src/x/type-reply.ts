import type { Page, SkillResult } from "../types";

/**
 * Click the reply button on a tweet and type the provided reply text.
 *
 * When navigated to a specific tweet URL (e.g. x.com/user/status/123),
 * X highlights that tweet as the "focal" tweet. The focal tweet is the one
 * whose reply box we want to use.
 *
 * @param page - Playwright page already on the tweet detail page
 * @param text - Reply text to type
 * @param targetTweetUrl - If provided, find the card matching this URL and reply to it
 *                         (used by inbound to reply to the mention, not the parent)
 */
export async function typeReply(
  page: Page,
  text: string,
  targetTweetUrl?: string
): Promise<SkillResult<void>> {
  try {
    // Dismiss any open overlay/modal
    const mask = page.locator('[data-testid="twc-cc-mask"]');
    if (await mask.isVisible().catch(() => false)) {
      await page.keyboard.press("Escape");
      await page.waitForTimeout(400);
    }

    // Find the right tweet card to reply to
    let replyBtn;
    const T = { timeout: 2_000 };

    if (targetTweetUrl) {
      // Find the card whose time-link matches the target URL
      const cards = await page.locator('[data-testid="tweet"]').all().catch(() => []);
      let targetCard = null;

      for (const card of cards) {
        const timePath = await card
          .locator("time")
          .first()
          .locator("..")
          .getAttribute("href", T)
          .catch(() => "");
        if (timePath && targetTweetUrl.includes(timePath)) {
          targetCard = card;
          break;
        }
      }

      if (targetCard) {
        replyBtn = targetCard.locator('[data-testid="reply"]');
      } else {
        // Fallback: the focal tweet on the page (usually has a larger font / different style)
        // When navigated to a tweet URL, it's typically the first card with a visible reply button
        replyBtn = page.locator('[data-testid="tweet"]').first().locator('[data-testid="reply"]');
      }
    } else {
      // Default: reply to the first (parent) tweet — used by outbound
      replyBtn = page.locator('[data-testid="tweet"]').first().locator('[data-testid="reply"]');
    }

    await replyBtn.waitFor({ timeout: 8_000 });
    await replyBtn.click();
    await page.waitForTimeout(800);

    // The reply compose box
    const composeBox = page.locator('[data-testid="tweetTextarea_0"]').first();
    await composeBox.waitFor({ timeout: 5_000 });

    // Wait for any mask overlay to clear
    await page.locator('[data-testid="twc-cc-mask"]').waitFor({ state: "hidden", timeout: 5_000 }).catch(() => {});

    await composeBox.click({ force: true });
    await composeBox.type(text, { delay: 30 });

    const typed = await composeBox.innerText();
    if (!typed.trim()) {
      return { success: false, error: "Reply box appears empty after typing" };
    }

    return { success: true };
  } catch (err) {
    return { success: false, error: `Failed to type reply: ${String(err)}` };
  }
}
