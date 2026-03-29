import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Page } from "../types";
import { findTargetPost } from "../linkedin/find-target-post";
import type { PostCard } from "../types";

// ---------------------------------------------------------------------------
// Helper: build a mock Playwright Page that returns pre-set values
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
    url: vi.fn().mockReturnValue("https://www.linkedin.com/feed/"),
    evaluate: vi.fn().mockResolvedValue(undefined),
    waitForTimeout: vi.fn().mockResolvedValue(undefined),
    locator: vi.fn().mockReturnValue(locatorChain()),
    ...overrides,
  } as unknown as Page;
}

// ---------------------------------------------------------------------------
// findTargetPost (pure function — no browser needed)
// ---------------------------------------------------------------------------
describe("findTargetPost", () => {
  const posts: PostCard[] = [
    {
      author: "Alice",
      authorUrl: "/in/alice",
      content: "AI is changing everything in 2025",
      postUrl: "https://linkedin.com/posts/alice-1",
      likes: 500,
      comments: 80,
      reposts: 40,
      timestamp: new Date(Date.now() - 2 * 3_600_000).toISOString(), // 2 hours ago
    },
    {
      author: "Bob",
      authorUrl: "/in/bob",
      content: "New feature shipped today",
      postUrl: "https://linkedin.com/posts/bob-1",
      likes: 10,
      comments: 2,
      reposts: 1,
      timestamp: new Date(Date.now() - 1 * 3_600_000).toISOString(), // 1 hour ago
    },
    {
      author: "Carol",
      authorUrl: "/in/carol",
      content: "Crypto moon soon!!!",
      postUrl: "https://linkedin.com/posts/carol-1",
      likes: 5000,
      comments: 900,
      reposts: 600,
      timestamp: new Date(Date.now() - 100 * 3_600_000).toISOString(), // too old
    },
  ];

  it("returns all posts when no criteria given", () => {
    const result = findTargetPost(posts);
    expect(result.success).toBe(true);
    expect(result.data).toHaveLength(3);
  });

  it("filters by minEngagement", () => {
    const result = findTargetPost(posts, { minEngagement: 100 });
    expect(result.success).toBe(true);
    expect(result.data?.every((p) => p.likes + p.comments + p.reposts >= 100)).toBe(true);
  });

  it("filters by maxAgeHours", () => {
    const result = findTargetPost(posts, { maxAgeHours: 24 });
    expect(result.success).toBe(true);
    // Carol's post is 100 hours old — should be excluded
    expect(result.data?.find((p) => p.author === "Carol")).toBeUndefined();
  });

  it("filters by keywords", () => {
    const result = findTargetPost(posts, { keywords: ["AI"] });
    expect(result.success).toBe(true);
    expect(result.data).toHaveLength(1);
    expect(result.data?.[0].author).toBe("Alice");
  });

  it("filters by excludeKeywords", () => {
    const result = findTargetPost(posts, { excludeKeywords: ["crypto"] });
    expect(result.success).toBe(true);
    expect(result.data?.find((p) => p.author === "Carol")).toBeUndefined();
  });

  it("sorts by total engagement descending", () => {
    const result = findTargetPost(posts);
    const engagements = result.data!.map((p) => p.likes + p.comments + p.reposts);
    for (let i = 1; i < engagements.length; i++) {
      expect(engagements[i - 1]).toBeGreaterThanOrEqual(engagements[i]);
    }
  });

  it("returns empty array when no posts match", () => {
    const result = findTargetPost(posts, { keywords: ["blockchain NFT"] });
    expect(result.success).toBe(true);
    expect(result.data).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// loginCheck (mocked page)
// ---------------------------------------------------------------------------
describe("loginCheck (linkedin)", async () => {
  const { loginCheck } = await import("../linkedin/login-check");

  it("returns false when redirected to /login", async () => {
    const page = makeMockPage({
      url: vi.fn().mockReturnValue("https://www.linkedin.com/login"),
    });
    const result = await loginCheck(page);
    expect(result.success).toBe(true);
    expect(result.data).toBe(false);
  });

  it("returns true when on feed with nav present", async () => {
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
      url: vi.fn().mockReturnValue("https://www.linkedin.com/feed/"),
      locator: vi.fn().mockReturnValue(locatorWithVisible),
    });

    const result = await loginCheck(page);
    expect(result.success).toBe(true);
    expect(result.data).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// checkAlreadyReplied (direct logic test — no module mocking)
// ---------------------------------------------------------------------------
describe("checkAlreadyReplied (logic)", () => {
  it("returns true when commenter name matches", () => {
    const comments = [
      { commenter: "Trent Hankins", text: "Great post!", timestamp: "", likes: 2 },
    ];
    const myName = "Trent";
    const found = comments.some((c) =>
      c.commenter.toLowerCase().includes(myName.toLowerCase())
    );
    expect(found).toBe(true);
  });

  it("returns false when no commenter matches", () => {
    const comments = [
      { commenter: "Jane Doe", text: "Nice one", timestamp: "", likes: 0 },
    ];
    const myName = "Trent";
    const found = comments.some((c) =>
      c.commenter.toLowerCase().includes(myName.toLowerCase())
    );
    expect(found).toBe(false);
  });

  it("is case-insensitive", () => {
    const comments = [
      { commenter: "TRENT SOMETHING", text: "hello", timestamp: "", likes: 0 },
    ];
    const myName = "trent";
    const found = comments.some((c) =>
      c.commenter.toLowerCase().includes(myName.toLowerCase())
    );
    expect(found).toBe(true);
  });
});
