import type { Page, SkillResult } from "../types";

/**
 * Submit the reply currently typed in the compose box.
 * Tries multiple strategies: button click, then Ctrl+Enter fallback.
 * Checks both textarea hidden AND textarea emptied as success signals
 * (inline reply clears the text; modal reply hides the textarea).
 */
export async function submitReply(page: Page): Promise<SkillResult<{ submitted: boolean }>> {
  try {
    const textarea = page.locator('[data-testid="tweetTextarea_0"]').first();
    await textarea.waitFor({ timeout: 5_000 });

    // Capture the text before submit so we can detect if it was cleared
    const textBefore = await textarea.innerText().catch(() => "");

    // ── Strategy 1: Click the reply/post button ─────────────────────────
    // Try multiple selectors — X uses different testids/labels in different contexts
    const buttonSelectors = [
      '[data-testid="tweetButtonInline"]',     // Inline reply on tweet detail page
      '[data-testid="tweetButton"]:has-text("Reply")',  // Modal reply button
      '[data-testid="tweetButton"]',           // Generic post/reply button
    ];

    let clicked = false;
    for (const selector of buttonSelectors) {
      const btn = page.locator(selector).first();
      if (await btn.isVisible({ timeout: 1_000 }).catch(() => false)) {
        await btn.click({ timeout: 3_000 }).catch(() => {});
        clicked = true;
        break;
      }
    }

    // ── Strategy 2: Keyboard shortcut fallback ──────────────────────────
    if (!clicked) {
      await textarea.click({ force: true });
      await page.waitForTimeout(150);
      await page.keyboard.press("Control+Enter");
    }

    // ── Check if submit succeeded ───────────────────────────────────────
    // Two signals: textarea disappears (modal) or textarea empties (inline)
    let submitted = false;

    // Wait up to 10s, checking every 500ms
    for (let i = 0; i < 20; i++) {
      await page.waitForTimeout(500);

      // Signal 1: textarea is gone (modal closed)
      const visible = await textarea.isVisible().catch(() => false);
      if (!visible) {
        submitted = true;
        break;
      }

      // Signal 2: textarea text cleared (inline reply posted)
      const textNow = await textarea.innerText().catch(() => "");
      if (textBefore.length > 10 && textNow.trim().length === 0) {
        submitted = true;
        break;
      }
    }

    return { success: true, data: { submitted } };
  } catch (err) {
    return { success: false, error: `Failed to submit reply: ${String(err)}` };
  }
}
