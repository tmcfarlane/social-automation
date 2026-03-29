import { describe, it, expect, vi } from "vitest";
import type { Page } from "../types";
import { findTargetTweet } from "../x/find-target-tweet";
import type { TweetCard } from "../types";

// ---------------------------------------------------------------------------
// Helper: build a mock Playwright Page
// ---------------------------------------------------------------------------
function makeMockPage(overrides: Partial<Record<string, unknown>> = {}): Page {
  const locatorChain = () => ({
    first: () => locatorChain(),
    nth: (_: number) => locatorChain(),
    all: vi.fn().mockResolvedValue([]),
    isVisible: vi.fn().mockResolvedValue(false),
    waitFor: vi.fn().mockResolvedValue(undefined),
    click: vi.fn().mockResolvedValue(undefined),
    fill: vi.fn().mockResolvedValue(undefined),
    type: vi.fn().mockResolvedValue(undefined),
    innerText: vi.fn().mockResolvedValue(""),
    getAttribute: vi.fn().mockResolvedValue(""),
    locator: (_: string) => locatorChain(),
  });

  return {
    goto: vi.fn().mockResolvedValue(undefined),
    url: vi.fn().mockReturnValue("https://x.com/home"),
    evaluate: vi.fn().mockResolvedValue(undefined),
    waitForTimeout: vi.fn().mockResolvedValue(undefined),
    locator: vi.fn().mockReturnValue(locatorChain()),
    ...overrides,
  } as unknown as Page;
}

// ---------------------------------------------------------------------------
// findTargetTweet (pure function — no browser needed)
// ---------------------------------------------------------------------------
describe("findTargetTweet", () => {
  const tweets: TweetCard[] = [
    {
      author: "Alice",
      handle: "@alice",
      content: "AI agents are replacing boring browser automation",
      tweetUrl: "https://x.com/alice/status/1",
      likes: 3000,
      retweets: 500,
      replies: 200,
      timestamp: new Date(Date.now() - 1 * 3_600_000).toISOString(),
    },
    {
      author: "Bob",
      handle: "@bob",
      content: "Just shipped a new feature",
      tweetUrl: "https://x.com/bob/status/2",
      likes: 5,
      retweets: 1,
      replies: 0,
      timestamp: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
    },
    {
      author: "Carol",
      handle: "@carol",
      content: "NFTs are back baby!!!",
      tweetUrl: "https://x.com/carol/status/3",
      likes: 10_000,
      retweets: 2_000,
      replies: 800,
      timestamp: new Date(Date.now() - 72 * 3_600_000).toISOString(), // too old
    },
  ];

  it("returns all tweets when no criteria given", () => {
    const result = findTargetTweet(tweets);
    expect(result.success).toBe(true);
    expect(result.data).toHaveLength(3);
  });

  it("filters by minEngagement", () => {
    const result = findTargetTweet(tweets, { minEngagement: 1000 });
    expect(result.success).toBe(true);
    expect(result.data?.every((t) => t.likes + t.retweets + t.replies >= 1000)).toBe(true);
  });

  it("filters by maxAgeHours", () => {
    const result = findTargetTweet(tweets, { maxAgeHours: 24 });
    expect(result.success).toBe(true);
    // Carol is 72 hours old — excluded
    expect(result.data?.find((t) => t.handle === "@carol")).toBeUndefined();
  });

  it("filters by keywords", () => {
    const result = findTargetTweet(tweets, { keywords: ["AI"] });
    expect(result.success).toBe(true);
    expect(result.data).toHaveLength(1);
    expect(result.data?.[0].handle).toBe("@alice");
  });

  it("filters by excludeKeywords", () => {
    const result = findTargetTweet(tweets, { excludeKeywords: ["NFT"] });
    expect(result.success).toBe(true);
    expect(result.data?.find((t) => t.handle === "@carol")).toBeUndefined();
  });

  it("sorts by total engagement descending", () => {
    const result = findTargetTweet(tweets);
    const engagements = result.data!.map((t) => t.likes + t.retweets + t.replies);
    for (let i = 1; i < engagements.length; i++) {
      expect(engagements[i - 1]).toBeGreaterThanOrEqual(engagements[i]);
    }
  });

  it("returns empty array when nothing matches", () => {
    const result = findTargetTweet(tweets, { keywords: ["web3 metaverse blockchain"] });
    expect(result.success).toBe(true);
    expect(result.data).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// loginCheck (mocked page)
// ---------------------------------------------------------------------------
describe("loginCheck (x)", async () => {
  const { loginCheck } = await import("../x/login-check");

  it("returns false when redirected to /flow/login", async () => {
    const page = makeMockPage({
      url: vi.fn().mockReturnValue("https://x.com/i/flow/login"),
    });
    const result = await loginCheck(page);
    expect(result.success).toBe(true);
    expect(result.data).toBe(false);
  });

  it("returns true when on home with feed present", async () => {
    const locatorWithVisible = {
      first: () => locatorWithVisible,
      nth: () => locatorWithVisible,
      all: vi.fn().mockResolvedValue([]),
      waitFor: vi.fn().mockResolvedValue(undefined),
      click: vi.fn(),
      fill: vi.fn(),
      type: vi.fn(),
      innerText: vi.fn().mockResolvedValue(""),
      getAttribute: vi.fn().mockResolvedValue(""),
      isVisible: vi.fn().mockResolvedValue(true),
      locator: (_: string) => locatorWithVisible,
    };

    const page = makeMockPage({
      url: vi.fn().mockReturnValue("https://x.com/home"),
      locator: vi.fn().mockReturnValue(locatorWithVisible),
    });

    const result = await loginCheck(page);
    expect(result.success).toBe(true);
    expect(result.data).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// searchTopic (mocked page)
// ---------------------------------------------------------------------------
describe("searchTopic", async () => {
  const { searchTopic } = await import("../x/search-topic");

  it("navigates to the correct search URL", async () => {
    const locatorReady = {
      first: () => locatorReady,
      nth: () => locatorReady,
      all: vi.fn().mockResolvedValue([]),
      waitFor: vi.fn().mockResolvedValue(undefined),
      click: vi.fn(),
      fill: vi.fn(),
      type: vi.fn(),
      innerText: vi.fn().mockResolvedValue(""),
      getAttribute: vi.fn().mockResolvedValue(""),
      isVisible: vi.fn().mockResolvedValue(true),
      locator: (_: string) => locatorReady,
    };

    const gotoMock = vi.fn().mockResolvedValue(undefined);
    const page = makeMockPage({
      goto: gotoMock,
      locator: vi.fn().mockReturnValue(locatorReady),
    });

    const result = await searchTopic(page, "AI agents", "latest");
    expect(result.success).toBe(true);
    expect(gotoMock).toHaveBeenCalledWith(
      expect.stringContaining("AI%20agents"),
      expect.any(Object)
    );
  });
});
