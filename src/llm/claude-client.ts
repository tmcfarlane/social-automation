import { createAiGateway } from "ai-gateway-provider";
import { createUnified } from "ai-gateway-provider/providers/unified";
import { generateText } from "ai";
import * as fs from "fs";
import * as path from "path";

// Claude Sonnet 4.5 pricing (per token)
const COST_PER_INPUT_TOKEN = 3.0 / 1_000_000;
const COST_PER_OUTPUT_TOKEN = 15.0 / 1_000_000;

const COST_LOG_PATH =
  "C:\\Users\\Trent\\rep\\COMMAND CENTER\\Command Center\\SocialMediaEngine\\X\\state\\x-costs.jsonl";

export interface ReplyUsage {
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  retried: boolean;
}

export interface GenerateReplyResult {
  text: string;
  usage: ReplyUsage;
}

export function appendCostLog(
  mode: "outbound" | "inbound",
  usage: ReplyUsage,
  extra: Record<string, unknown> = {}
): void {
  try {
    fs.mkdirSync(path.dirname(COST_LOG_PATH), { recursive: true });
    const entry = JSON.stringify({
      ts: new Date().toISOString(),
      mode,
      ...usage,
      ...extra,
    });
    fs.appendFileSync(COST_LOG_PATH, entry + "\n");
  } catch {
    // non-fatal
  }
}

/**
 * Generate a reply to an X post via Cloudflare AI Gateway → Claude Sonnet.
 */
export async function generateReply(
  postContent: string,
  authorInfo: string,
  voiceGuide: string
): Promise<GenerateReplyResult> {
  const cfAigToken = process.env["CF_AIG_TOKEN"];
  const cfAccountId = process.env["CF_ACCOUNT_ID"];
  const cfGatewayName = process.env["CF_GATEWAY_NAME"];

  if (!cfAigToken || !cfAccountId || !cfGatewayName) {
    throw new Error(
      "Missing required env vars: CF_AIG_TOKEN, CF_ACCOUNT_ID, CF_GATEWAY_NAME"
    );
  }

  const aigateway = createAiGateway({
    accountId: cfAccountId,
    gateway: cfGatewayName,
    apiKey: cfAigToken,
  });
  const unified = createUnified();

  const system = `You are Trent, co-founder of ZeroClickDev, an AI-native services company. You write replies on X that are genuine, direct, and add real insight. You are a practitioner-first AI solution architect and thought leader.

## Voice & Tone (primary reference)
${voiceGuide}

## X Reply Rules (mandatory)
- HARD LIMIT: 240 characters maximum (X allows 280, leave buffer). Count carefully.
- 1-2 sentences max. Plain text only. No Unicode bold/italic formatting.
- ALL CAPS for emphasis on ONE word maximum per reply.
- No hashtags. No emojis unless the original tweet uses them. NEVER use em-dashes (—). Use commas or periods instead.
- Never start with "Great question!", "Love this!", "So true!", or any hollow affirmation.
- Be specific. Be direct and opinionated. No hedging.
- End with a question approximately 60% of the time to invite response.

## Reply Strategy by Type
- Questions: Answer concisely + add a twist + ask a follow-up question back
- Disagreements: Acknowledge their point + reframe with a specific fact + invite response (never dismissive)
- Substantive additions: Validate + connect to broader pattern + ask what they'd do differently
- Simple agreements: Brief acknowledgment + add one more insight they can react to
- Link/resource shares: Acknowledge the SPECIFIC thing being shared, add one genuine observation about it

## Critical: Stay on topic
Read the tweet carefully before replying. Your reply must directly address what was actually said or shared. Do NOT pivot to a generic AI/orchestration take if the tweet is about something specific. If someone shares a video production tool, respond to video production. If someone shares a GitHub project, acknowledge that specific project.

## Identity
- Expertise: enterprise AI, AI-native development, agentic workflows, AI consulting, software architecture
- Never misrepresent credentials. Never reveal specific client names.`;

  const prompt = `Write a reply to this tweet from ${authorInfo}:

"${postContent}"

Reply ONLY with the text of the reply — nothing else, no quotes, no explanation.`;

  const generate = (extraInstruction = "") =>
    generateText({
      model: aigateway(unified("anthropic/claude-sonnet-4-5")),
      system,
      prompt: prompt + (extraInstruction ? `\n\n${extraInstruction}` : ""),
      maxTokens: 100,
    });

  let result = await generate();
  let text = result.text.trim().replace(/\s*—\s*/g, ". ");
  let totalInput = result.usage?.inputTokens ?? 0;
  let totalOutput = result.usage?.outputTokens ?? 0;
  let retried = false;

  // Retry once if over limit
  if (text.length > 280) {
    const retry = await generate(
      `IMPORTANT: Your previous reply was too long. This reply MUST be under 240 characters total. Be much shorter.`
    );
    text = retry.text.trim().replace(/\s*—\s*/g, ". ");
    totalInput += retry.usage?.inputTokens ?? 0;
    totalOutput += retry.usage?.outputTokens ?? 0;
    retried = true;
  }

  // Hard truncate at last sentence boundary if still over
  if (text.length > 280) {
    const cutoff = text.lastIndexOf(".", 277);
    text = cutoff > 50 ? text.slice(0, cutoff + 1) : text.slice(0, 277) + "...";
  }

  const costUsd = totalInput * COST_PER_INPUT_TOKEN + totalOutput * COST_PER_OUTPUT_TOKEN;

  return {
    text,
    usage: { inputTokens: totalInput, outputTokens: totalOutput, costUsd, retried },
  };
}
