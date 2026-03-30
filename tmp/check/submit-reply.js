async function submitReply(page) {
  try {
    const textarea = page.locator('[data-testid="tweetTextarea_0"]').first();
    await textarea.waitFor({ timeout: 5e3 });
    const textBefore = await textarea.innerText().catch(() => "");
    const buttonSelectors = [
      '[data-testid="tweetButtonInline"]',
      // Inline reply on tweet detail page
      '[data-testid="tweetButton"]:has-text("Reply")',
      // Modal reply button
      '[data-testid="tweetButton"]'
      // Generic post/reply button
    ];
    let clicked = false;
    for (const selector of buttonSelectors) {
      const btn = page.locator(selector).first();
      if (await btn.isVisible({ timeout: 1e3 }).catch(() => false)) {
        await btn.click({ timeout: 3e3 }).catch(() => {
        });
        clicked = true;
        break;
      }
    }
    if (!clicked) {
      await textarea.click({ force: true });
      await page.waitForTimeout(150);
      await page.keyboard.press("Control+Enter");
    }
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
    return { success: true, data: { submitted } };
  } catch (err) {
    return { success: false, error: `Failed to submit reply: ${String(err)}` };
  }
}
export {
  submitReply
};
