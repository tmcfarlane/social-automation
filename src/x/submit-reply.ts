import type { Page, SkillResult } from "../types";

/**
 * Submit the reply currently typed in the compose box.
 * Logs what buttons it finds for debugging, then tries every approach.
 */
export async function submitReply(page: Page): Promise<SkillResult<{ submitted: boolean }>> {
  try {
    const textarea = page.locator('[data-testid="tweetTextarea_0"]').first();
    await textarea.waitFor({ timeout: 5_000 });

    const textBefore = await textarea.innerText().catch(() => "");

    // ── Debug: snapshot all buttons with data-testid containing "tweet" ──
    const allButtons = await page.locator('[data-testid*="tweet" i]').all().catch(() => []);
    const buttonInfo: string[] = [];
    for (const btn of allButtons) {
      const testid = await btn.getAttribute("data-testid").catch(() => "");
      const text = await btn.innerText().catch(() => "");
      const visible = await btn.isVisible().catch(() => false);
      buttonInfo.push(`${testid}|${visible}|"${text.slice(0, 30)}"`);
    }
    console.log(JSON.stringify({ event: "submit_debug_buttons", buttons: buttonInfo }));

    // ── Try every known submit approach ──────────────────────────────────
    let clicked = false;

    // Approach 1: Any visible button with data-testid containing "tweetButton"
    const tweetButtons = await page.locator('[data-testid*="tweetButton"]').all().catch(() => []);
    for (const btn of tweetButtons) {
      if (await btn.isVisible().catch(() => false)) {
        const testid = await btn.getAttribute("data-testid").catch(() => "");
        console.log(JSON.stringify({ event: "submit_clicking", testid }));
        await btn.click({ timeout: 3_000 }).catch(() => {});
        clicked = true;
        break;
      }
    }

    // Approach 2: Keyboard shortcut
    if (!clicked) {
      console.log(JSON.stringify({ event: "submit_keyboard_fallback" }));
      await textarea.click({ force: true });
      await page.waitForTimeout(150);
      await page.keyboard.press("Control+Enter");
    }

    // ── Check if submit succeeded ───────────────────────────────────────
    let submitted = false;
    for (let i = 0; i < 20; i++) {
      await page.waitForTimeout(500);

      const visible = await textarea.isVisible().catch(() => false);
      if (!visible) {
        submitted = true;
        break;
      }

      const textNow = await textarea.innerText().catch(() => "");
      if (textBefore.length > 10 && textNow.trim().length === 0) {
        submitted = true;
        break;
      }
    }

    console.log(JSON.stringify({ event: "submit_result", clicked, submitted }));
    return { success: true, data: { submitted } };
  } catch (err) {
    return { success: false, error: `Failed to submit reply: ${String(err)}` };
  }
}
