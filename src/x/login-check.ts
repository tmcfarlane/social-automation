import type { Page, SkillResult } from "../types";

/**
 * Check whether the browser is currently logged into X (Twitter).
 */
export async function loginCheck(page: Page): Promise<SkillResult<boolean>> {
  try {
    await page.goto("https://x.com/home", {
      waitUntil: "domcontentloaded",
      timeout: 15_000,
    });

    const url = page.url();

    // X redirects unauthenticated users to /i/flow/login
    if (url.includes("/login") || url.includes("/flow/login")) {
      return { success: true, data: false };
    }

    // Confirm the home timeline feed nav is present
    const feedPresent = await page
      .locator('[data-testid="primaryColumn"]')
      .isVisible({ timeout: 5_000 })
      .catch(() => false);

    return { success: true, data: feedPresent };
  } catch (err) {
    return { success: false, error: `Login check failed: ${String(err)}` };
  }
}
