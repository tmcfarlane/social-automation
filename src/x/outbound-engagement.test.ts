import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { TweetCard } from "../types";
import type { EngagementResult } from "./outbound-engagement";
import type { Config } from "../config";

// ---------------------------------------------------------------------------
// Module mocks — hoisted before imports by vitest
// ---------------------------------------------------------------------------

vi.mock("playwright", () => ({
  chromium: {
    launch: vi.fn(),
    connectOverCDP: vi.fn(),
  },
}));

vi.mock("../llm/claude-client", () => ({
  generateReply: vi.fn(),
}));

vi.mock("./login-check", () => ({
  loginCheck: vi.fn(),
}));

vi.mock("./search-topic", () => ({
  searchTopic: vi.fn(),
}));

vi.mock("./scroll-results", () => ({
  scrollResults: vi.fn(),
}));

vi.mock("./find-target-tweet", () => ({
  findTargetTweet: vi.fn(),
}));

vi.mock("./read-thread", () => ({
  readThread: vi.fn(),
}));

vi.mock("./type-reply", () => ({
  typeReply: vi.fn(),
}));

vi.mock("./submit-reply", () => ({
  submitReply: vi.fn(),
}));

vi.mock("./verify-reply", () => ({
  verifyReply: vi.fn(),
}));

vi.mock("fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fs")>();
  return {
    ...actual,
    readFileSync: vi.fn().mockReturnValue("# Voice Guide\nBe direct."),
    appendFileSync: vi.fn(),
  };
});

// ---------------------------------------------------------------------------
// Imports (after mocks are declared)
// ---------------------------------------------------------------------------

import { chromium } from "playwright";
import { generateReply } from "../llm/claude-client";
import { loginCheck } from "./login-check";
import { searchTopic } from "./search-topic";
import { scrollResults } from "./scroll-results";
import { findTargetTweet } from "./find-target-tweet";
import { readThread } from "./read-thread";
import { typeReply } from "./type-reply";
import { submitReply } from "./submit-reply";
import { verifyReply } from "./verify-reply";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TWEET_1: TweetCard = {
  author: "Alice",
  handle: "@alice",
  content: "AI agents are replacing boring browser automation work entirely",
  tweetUrl: "https://x.com/alice/status/1",
  likes: 500,
  retweets: 80,
  replies: 40,
  timestamp: new Date(Date.now() - 2 * 3_600_000).toISOString(),
};

const TWEET_2: TweetCard = {
  author: "Bob",
  handle: "@bob",
  content: "Building with the Claude API changed how I think about products",
  tweetUrl: "https://x.com/bob/status/2",
  likes: 300,
  retweets: 50,
  replies: 25,
  timestamp: new Date(Date.now() - 4 * 3_600_000).toISOString(),
};

const TEST_CONFIG: Config = {
  CF_ACCOUNT_ID: "test-account",
  CF_GATEWAY_NAME: "test-gateway",
  CF_AIG_TOKEN: "cfut_test-token",
  VOICE_FILE_PATH: "/tmp/voice.md",
  MAX_REPLIES_PER_SESSION: 2,
  REPLY_DELAY_MIN_MS: 0,
  REPLY_DELAY_MAX_MS: 0,
};

// ---------------------------------------------------------------------------
// Mock browser / page factory
// ---------------------------------------------------------------------------

function makeMockPage() {
  return {
    goto: vi.fn().mockResolvedValue(undefined),
    waitForTimeout: vi.fn().mockResolvedValue(undefined),
    url: vi.fn().mockReturnValue("https://x.com/home"),
    evaluate: vi.fn().mockResolvedValue(undefined),
    locator: vi.fn().mockReturnValue({
      first: () => ({
        waitFor: vi.fn().mockResolvedValue(undefined),
        click: vi.fn().mockResolvedValue(undefined),
        innerText: vi.fn().mockResolvedValue(""),
        getAttribute: vi.fn().mockResolvedValue(""),
        isVisible: vi.fn().mockResolvedValue(true),
      }),
      all: vi.fn().mockResolvedValue([]),
      waitFor: vi.fn().mockResolvedValue(undefined),
      isVisible: vi.fn().mockResolvedValue(true),
    }),
  };
}

function makeMockBrowser(page: ReturnType<typeof makeMockPage>) {
  return {
    newPage: vi.fn().mockResolvedValue(page),
    close: vi.fn().mockResolvedValue(undefined),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("runOutboundEngagement", () => {
  let mockPage: ReturnType<typeof makeMockPage>;
  let mockBrowser: ReturnType<typeof makeMockBrowser>;

  beforeEach(() => {
    mockPage = makeMockPage();
    mockBrowser = makeMockBrowser(mockPage);

    vi.mocked(chromium.launch).mockResolvedValue(mockBrowser as never);

    // Default happy-path stubs
    vi.mocked(loginCheck).mockResolvedValue({ success: true, data: true });
    vi.mocked(searchTopic).mockResolvedValue({ success: true });
    vi.mocked(scrollResults).mockResolvedValue({
      success: true,
      data: [TWEET_1, TWEET_2],
    });
    vi.mocked(findTargetTweet).mockReturnValue({
      success: true,
      data: [TWEET_1, TWEET_2],
    });
    vi.mocked(readThread).mockResolvedValue({ success: true, data: [] });
    vi.mocked(generateReply).mockResolvedValue(
      "Really interesting take — what does the latency look like at scale?"
    );
    vi.mocked(typeReply).mockResolvedValue({ success: true });
    vi.mocked(submitReply).mockResolvedValue({ success: true });
    vi.mocked(verifyReply).mockResolvedValue({ success: true, data: true });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ── Happy path ─────────────────────────────────────────────────────────────

  it("runs the full skill chain for each target tweet", async () => {
    const { runOutboundEngagement } = await import("./outbound-engagement");
    const results: EngagementResult[] = await runOutboundEngagement(TEST_CONFIG);

    expect(results).toHaveLength(2);
    expect(loginCheck).toHaveBeenCalledOnce();
    expect(searchTopic).toHaveBeenCalledOnce();
    expect(scrollResults).toHaveBeenCalledOnce();
    expect(findTargetTweet).toHaveBeenCalledOnce();
    expect(readThread).toHaveBeenCalledTimes(2);
    expect(generateReply).toHaveBeenCalledTimes(2);
    expect(typeReply).toHaveBeenCalledTimes(2);
    expect(submitReply).toHaveBeenCalledTimes(2);
    expect(verifyReply).toHaveBeenCalledTimes(2);
  });

  it("returns verified=true for all successful replies", async () => {
    const { runOutboundEngagement } = await import("./outbound-engagement");
    const results = await runOutboundEngagement(TEST_CONFIG);

    expect(results.every((r) => r.verified)).toBe(true);
    expect(results.every((r) => !r.error)).toBe(true);
  });

  it("respects MAX_REPLIES_PER_SESSION cap", async () => {
    const configWithCap: Config = { ...TEST_CONFIG, MAX_REPLIES_PER_SESSION: 1 };
    vi.mocked(findTargetTweet).mockReturnValue({
      success: true,
      data: [TWEET_1, TWEET_2], // 2 available but cap is 1
    });

    const { runOutboundEngagement } = await import("./outbound-engagement");
    const results = await runOutboundEngagement(configWithCap);

    expect(results).toHaveLength(1);
    expect(generateReply).toHaveBeenCalledOnce();
  });

  it("passes voiceGuide string to generateReply", async () => {
    const { runOutboundEngagement } = await import("./outbound-engagement");
    await runOutboundEngagement(TEST_CONFIG);

    const [, , voiceArg] = vi.mocked(generateReply).mock.calls[0]!;
    expect(typeof voiceArg).toBe("string");
    expect(voiceArg.length).toBeGreaterThan(0);
  });

  it("closes the browser on completion", async () => {
    const { runOutboundEngagement } = await import("./outbound-engagement");
    await runOutboundEngagement(TEST_CONFIG);

    expect(mockBrowser.close).toHaveBeenCalledOnce();
  });

  // ── Abort paths ────────────────────────────────────────────────────────────

  it("aborts early and returns [] when not logged in", async () => {
    vi.mocked(loginCheck).mockResolvedValue({ success: true, data: false });

    const { runOutboundEngagement } = await import("./outbound-engagement");
    const results = await runOutboundEngagement(TEST_CONFIG);

    expect(results).toHaveLength(0);
    expect(searchTopic).not.toHaveBeenCalled();
    expect(generateReply).not.toHaveBeenCalled();
    expect(mockBrowser.close).toHaveBeenCalledOnce(); // still closes
  });

  it("aborts when search fails", async () => {
    vi.mocked(searchTopic).mockResolvedValue({
      success: false,
      error: "Navigation timeout",
    });

    const { runOutboundEngagement } = await import("./outbound-engagement");
    const results = await runOutboundEngagement(TEST_CONFIG);

    expect(results).toHaveLength(0);
    expect(scrollResults).not.toHaveBeenCalled();
  });

  it("aborts when no target tweets are found", async () => {
    vi.mocked(findTargetTweet).mockReturnValue({ success: true, data: [] });

    const { runOutboundEngagement } = await import("./outbound-engagement");
    const results = await runOutboundEngagement(TEST_CONFIG);

    expect(results).toHaveLength(0);
    expect(generateReply).not.toHaveBeenCalled();
  });

  // ── Per-tweet error handling ───────────────────────────────────────────────

  it("skips a tweet when typeReply fails and continues to next", async () => {
    vi.mocked(typeReply)
      .mockResolvedValueOnce({ success: false, error: "Reply box not found" })
      .mockResolvedValue({ success: true });

    const { runOutboundEngagement } = await import("./outbound-engagement");
    const results = await runOutboundEngagement(TEST_CONFIG);

    expect(results).toHaveLength(2);
    expect(results[0]?.verified).toBe(false);
    expect(results[0]?.error).toBe("Reply box not found");
    expect(results[1]?.verified).toBe(true);
  });

  it("skips a tweet when submitReply fails and continues to next", async () => {
    vi.mocked(submitReply)
      .mockResolvedValueOnce({ success: false, error: "Button not found" })
      .mockResolvedValue({ success: true });

    const { runOutboundEngagement } = await import("./outbound-engagement");
    const results = await runOutboundEngagement(TEST_CONFIG);

    expect(results).toHaveLength(2);
    expect(results[0]?.verified).toBe(false);
    expect(results[1]?.verified).toBe(true);
  });

  it("records unverified result when verifyReply returns false", async () => {
    vi.mocked(verifyReply).mockResolvedValue({ success: true, data: false });

    const { runOutboundEngagement } = await import("./outbound-engagement");
    const results = await runOutboundEngagement(TEST_CONFIG);

    expect(results.every((r) => r.verified === false)).toBe(true);
    // No error field — the reply posted, just couldn't confirm
    expect(results.every((r) => !r.error)).toBe(true);
  });

  it("catches thrown errors per-tweet and records them without crashing", async () => {
    vi.mocked(generateReply)
      .mockRejectedValueOnce(new Error("API rate limit"))
      .mockResolvedValue("Solid take on the latency issue");

    const { runOutboundEngagement } = await import("./outbound-engagement");
    const results = await runOutboundEngagement(TEST_CONFIG);

    expect(results).toHaveLength(2);
    expect(results[0]?.error).toContain("API rate limit");
    expect(results[1]?.verified).toBe(true);
  });
});
