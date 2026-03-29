import type { Page, SkillResult } from "../types";

/**
 * Check whether the browser is currently logged into LinkedIn.
 * Returns true if authenticated, false if on the login/auth page.
 */
export async function loginCheck(page: Page): Promise<SkillResult<boolean>> {
  try {
    await page.goto("https://www.linkedin.com/feed/", {
      waitUntil: "domcontentloaded",
      timeout: 15_000,
    });

    const url = page.url();

    // LinkedIn redirects unauthenticated users to /login or /authwall
    if (
      url.includes("/login") ||
      url.includes("/authwall") ||
      url.includes("/checkpoint")
    ) {
      return { success: true, data: false };
    }

    // Confirm nav is present (logged-in indicator)
    const navPresent = await page
      .locator("nav.global-nav")
      .isVisible({ timeout: 5_000 })
      .catch(() => false);

    return { success: true, data: navPresent };
  } catch (err) {
    return { success: false, error: `Login check failed: ${String(err)}` };
  }
}
