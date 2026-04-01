/**
 * Shared safety utilities — rate-limit detection, CAPTCHA detection,
 * daily caps, session cooldowns, and human-like behavior helpers.
 */
import type { Page } from "playwright";

// ---------------------------------------------------------------------------
// Rate-limit & CAPTCHA detection
// ---------------------------------------------------------------------------

export interface SafetyCheckResult {
  safe: boolean;
  reason?: "captcha" | "rate_limited" | "action_blocked" | "account_locked" | "suspicious_activity";
  detail?: string;
}

/**
 * Check the current page for signs that the platform has detected automation.
 * Should be called after key actions (login, submit, navigation).
 */
export async function checkForRateLimit(page: Page, platform: "x" | "linkedin"): Promise<SafetyCheckResult> {
  try {
    const url = page.url().toLowerCase();
    const bodyText = await page.locator("body").innerText().catch(() => "");
    const textLower = bodyText.toLowerCase();

    // ── X / Twitter specific ──────────────────────────────────────────────
    if (platform === "x") {
      // CAPTCHA / challenge page
      if (url.includes("/account/access") || url.includes("/challenge")) {
        return { safe: false, reason: "captcha", detail: `Redirected to: ${url}` };
      }

      // Rate limit indicators
      if (textLower.includes("rate limit exceeded") || textLower.includes("try again later")) {
        return { safe: false, reason: "rate_limited", detail: "Rate limit text detected" };
      }

      // Action blocked
      if (textLower.includes("this request looks like it might be automated") ||
          textLower.includes("we've detected unusual activity")) {
        return { safe: false, reason: "action_blocked", detail: "Unusual activity warning" };
      }

      // Account locked/suspended
      if (url.includes("/account/locked") || url.includes("/suspended") ||
          textLower.includes("your account has been locked") ||
          textLower.includes("account is suspended")) {
        return { safe: false, reason: "account_locked", detail: "Account locked or suspended" };
      }

      // Too many requests modal
      const tooManyModal = await page.locator("[data-testid='toast'], [role='alert']").innerText().catch(() => "");
      if (tooManyModal.toLowerCase().includes("limit") || tooManyModal.toLowerCase().includes("try again")) {
        return { safe: false, reason: "rate_limited", detail: `Alert: ${tooManyModal.slice(0, 100)}` };
      }
    }

    // ── LinkedIn specific ─────────────────────────────────────────────────
    if (platform === "linkedin") {
      // CAPTCHA / challenge
      if (url.includes("/checkpoint") || url.includes("/authwall")) {
        return { safe: false, reason: "captcha", detail: `Redirected to: ${url}` };
      }

      // Rate limit / restriction — must be specific to avoid false positives
      // (LinkedIn pages routinely contain "restricted" in normal UI text)
      if (textLower.includes("you've reached the") && textLower.includes("limit")) {
        return { safe: false, reason: "rate_limited", detail: "Limit reached text detected" };
      }
      if (textLower.includes("your account has been restricted") ||
          textLower.includes("your account is temporarily limited") ||
          textLower.includes("we've restricted your account")) {
        return { safe: false, reason: "action_blocked", detail: "Account restricted" };
      }

      // "We've detected unusual activity" — require full phrase, not just "unusual activity"
      if (textLower.includes("we've detected unusual activity") ||
          textLower.includes("we detected unusual activity") ||
          textLower.includes("security verification required")) {
        return { safe: false, reason: "suspicious_activity", detail: "Unusual activity or verification required" };
      }

      // Account restricted page — URL-based (reliable, not affected by page content)
      if (url.includes("/checkpoint/restrict") || url.includes("/safety/blocked")) {
        return { safe: false, reason: "account_locked", detail: `Redirected to: ${url}` };
      }
    }

    return { safe: true };
  } catch {
    // If we can't even check, assume safe but log it
    return { safe: true };
  }
}

// ---------------------------------------------------------------------------
// Daily cap enforcement
// ---------------------------------------------------------------------------

const DAILY_OUTBOUND_CAPS: Record<string, number> = {
  "x": 20,        // Max 20 outbound replies/day on X
  "linkedin": 15,  // Max 15 outbound replies/day on LinkedIn (stricter platform)
};

export function getDailyOutboundCap(platform: "x" | "linkedin"): number {
  return DAILY_OUTBOUND_CAPS[platform] ?? 20;
}

export function isOverDailyCap(
  platform: "x" | "linkedin",
  totalRepliesToday: number
): boolean {
  return totalRepliesToday >= getDailyOutboundCap(platform);
}

// ---------------------------------------------------------------------------
// Session cooldown
// ---------------------------------------------------------------------------

const MIN_SESSION_GAP_MS: Record<string, number> = {
  "x": 20 * 60_000,       // At least 20 min between X outbound sessions
  "linkedin": 30 * 60_000, // At least 30 min between LinkedIn outbound sessions
};

export function getMinSessionGapMs(platform: "x" | "linkedin"): number {
  return MIN_SESSION_GAP_MS[platform] ?? 20 * 60_000;
}

export function isTooSoonSinceLastSession(
  platform: "x" | "linkedin",
  lastCompletedAt: string | null
): boolean {
  if (!lastCompletedAt) return false;
  const elapsed = Date.now() - new Date(lastCompletedAt).getTime();
  return elapsed < getMinSessionGapMs(platform);
}

// ---------------------------------------------------------------------------
// Human-like behavior helpers
// ---------------------------------------------------------------------------

/**
 * Random delay within a range (inclusive).
 */
export function randomDelay(minMs: number, maxMs: number): number {
  return Math.floor(Math.random() * (maxMs - minMs) + minMs);
}

/**
 * Sleep for a random duration within a range.
 * Use for micro-delays between actions (100-800ms feels human).
 */
export function humanPause(minMs = 200, maxMs = 800): Promise<void> {
  const ms = randomDelay(minMs, maxMs);
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Get a randomized per-character typing delay.
 * Humans type at variable speed — faster on common letters, slower on punctuation.
 */
export function typingDelay(char: string): number {
  // Base: 25-55ms per character
  let base = randomDelay(25, 55);

  // Slower on punctuation and special characters
  if (/[.,!?;:'"()]/.test(char)) base += randomDelay(30, 80);

  // Occasional brief pause (2% chance) simulating thought
  if (Math.random() < 0.02) base += randomDelay(200, 600);

  return base;
}

/**
 * Random scroll amount (not always the same pixel count).
 */
export function randomScrollAmount(): number {
  return Math.floor(600 + Math.random() * 500); // 600-1100px
}
