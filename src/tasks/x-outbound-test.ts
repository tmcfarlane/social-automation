import fs from "fs";
import { chromium } from "playwright";
import OpenAI from "openai";

import { loginCheck } from "../x/login-check";
import { searchTopic } from "../x/search-topic";
import { scrollResults } from "../x/scroll-results";
import { findTargetTweet } from "../x/find-target-tweet";
import { readThread } from "../x/read-thread";
import { typeReply } from "../x/type-reply";
import { submitReply } from "../x/submit-reply";
import { verifyReply } from "../x/verify-reply";

const TOPICS = ["Claude Code", "agentic AI", "AI native", "MCP server", "vibe coding"];
const MAX_REPLIES = 4;
const MIN_DELAY_MS = 45_000;
const MAX_DELAY_MS = 90_000;
const VOICE_FILE = "C:\\Users\\Trent\\rep\\COMMAND CENTER\\Command Center\\Personalization\\my-voice.md";

function randomDelay(): number {
  return MIN_DELAY_MS + Math.floor(Math.random() * (MAX_DELAY_MS - MIN_DELAY_MS));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  // 1. Read Trent's voice file
  let voiceContent: string;
  try {
    voiceContent = fs.readFileSync(VOICE_FILE, "utf-8");
    console.log(`Loaded voice file: ${VOICE_FILE}`);
  } catch (err) {
    console.error("Failed to read voice file:", err);
    process.exit(1);
  }

  // 2. Set up Cloudflare AI Gateway → OpenAI SDK client
  const cfAccountId = process.env.CF_ACCOUNT_ID;
  const cfGatewayName = process.env.CF_GATEWAY_NAME;
  const cfApiToken = process.env.CF_API_TOKEN;

  if (!cfAccountId || !cfGatewayName || !cfApiToken) {
    console.error("Missing required env vars: CF_ACCOUNT_ID, CF_GATEWAY_NAME, CF_API_TOKEN");
    process.exit(1);
  }

  const ai = new OpenAI({
    apiKey: cfApiToken,
    baseURL: `https://gateway.ai.cloudflare.com/v1/${cfAccountId}/${cfGatewayName}/openai`,
  });

  // 3. Connect to the user's existing Chrome instance (remote debugging on port 9222)
  console.log("Connecting to Chrome on port 9222 via CDP...");
  const browser = await chromium.connectOverCDP("http://localhost:9222");
  const contexts = browser.contexts();
  const context = contexts[0] ?? (await browser.newContext());
  const page = await context.newPage();

  try {
    // 4. Login check
    console.log("Checking X login status...");
    const loginResult = await loginCheck(page);
    if (!loginResult.success || !loginResult.data) {
      console.error("Not logged into X. Please log in to x.com first and re-run.");
      return;
    }
    console.log("Logged into X ✓");

    let repliesPosted = 0;

    // 5. Rotate through topics until we hit the reply cap
    for (const topic of TOPICS) {
      if (repliesPosted >= MAX_REPLIES) break;

      console.log(`\n[topic] "${topic}"`);

      const searchResult = await searchTopic(page, topic, "latest");
      if (!searchResult.success) {
        console.error(`  Search failed: ${searchResult.error}`);
        continue;
      }

      const scrollResult = await scrollResults(page, 5);
      if (!scrollResult.success || !scrollResult.data?.length) {
        console.error(`  No tweets found.`);
        continue;
      }
      console.log(`  Extracted ${scrollResult.data.length} tweets`);

      // High-signal targets: >50 total engagement, posted within last 24 hours
      const targetResult = findTargetTweet(scrollResult.data, {
        minEngagement: 50,
        maxAgeHours: 24,
      });

      if (!targetResult.success || !targetResult.data?.length) {
        console.log(`  No high-signal tweets found, skipping topic.`);
        continue;
      }

      const targets = targetResult.data.slice(0, 2);

      for (const tweet of targets) {
        if (repliesPosted >= MAX_REPLIES) break;

        console.log(`\n  → @${tweet.handle}: "${tweet.content.slice(0, 100)}..."`);
        console.log(`    engagement: ${tweet.likes + tweet.retweets + tweet.replies} | url: ${tweet.tweetUrl}`);

        // Read thread for context
        const threadResult = await readThread(page, tweet.tweetUrl);
        const threadContext =
          threadResult.success && threadResult.data?.length
            ? threadResult.data
                .slice(0, 3)
                .map((r) => `${r.commenter}: ${r.text}`)
                .join("\n")
            : "";

        // Generate reply via Claude through Cloudflare AI Gateway
        const systemPrompt = voiceContent;
        const userPrompt = [
          `Reply to this tweet by @${tweet.handle}:`,
          `"${tweet.content}"`,
          threadContext ? `\nThread context (top replies):\n${threadContext}` : "",
          "\nWrite a concise, insightful reply (1-3 sentences). Add genuine value. Be direct and authentic. No hashtags. Don't start with filler like \"Great post\". Output only the reply text.",
        ]
          .filter(Boolean)
          .join("\n");

        console.log("  Generating reply...");
        let replyText: string;
        try {
          const completion = await ai.chat.completions.create({
            model: "claude-sonnet-4-6",
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: userPrompt },
            ],
            max_tokens: 200,
          });
          replyText = completion.choices[0]?.message?.content?.trim() ?? "";
        } catch (err) {
          console.error("  Claude API error:", err);
          continue;
        }

        if (!replyText) {
          console.error("  Empty reply generated, skipping.");
          continue;
        }

        console.log(`  Reply: "${replyText}"`);

        // Type, submit, verify
        const typeResult = await typeReply(page, replyText);
        if (!typeResult.success) {
          console.error(`  typeReply failed: ${typeResult.error}`);
          continue;
        }

        const submitResult = await submitReply(page);
        if (!submitResult.success) {
          console.error(`  submitReply failed: ${submitResult.error}`);
          continue;
        }

        const verifyResult = await verifyReply(page, tweet.tweetUrl, replyText);

        console.log("\n  ┌─ Reply posted ─────────────────────────────────");
        console.log(`  │ To:      @${tweet.handle}`);
        console.log(`  │ Their:   ${tweet.content.slice(0, 100)}`);
        console.log(`  │ Ours:    ${replyText}`);
        console.log(`  │ Verified: ${verifyResult.data ? "✓ confirmed" : "✗ unconfirmed (may still have posted)"}`);
        console.log("  └────────────────────────────────────────────────");

        repliesPosted++;

        if (repliesPosted < MAX_REPLIES) {
          const delay = randomDelay();
          console.log(`\n  Waiting ${Math.round(delay / 1_000)}s before next reply...`);
          await sleep(delay);
        }
      }
    }

    console.log(`\nFinished. Posted ${repliesPosted}/${MAX_REPLIES} replies.`);
  } finally {
    await page.close();
    await browser.close();
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
