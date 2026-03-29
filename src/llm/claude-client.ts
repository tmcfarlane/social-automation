import { createAiGateway } from "ai-gateway-provider";
import { createUnified } from "ai-gateway-provider/providers/unified";
import { generateText } from "ai";

/**
 * Generate a reply to an X post via Cloudflare AI Gateway → Claude Sonnet.
 * CF_AIG_TOKEN authenticates with the gateway and handles provider auth —
 * no separate Anthropic API key is required.
 *
 * This is the ONLY LLM call in the outbound engagement flow.
 *
 * @param postContent - The tweet text (may include top thread replies for context)
 * @param authorInfo  - Display name + handle of the tweet author
 * @param voiceGuide  - Full text of Trent's voice/style guide (read from VOICE_FILE_PATH)
 */
export async function generateReply(
  postContent: string,
  authorInfo: string,
  voiceGuide: string
): Promise<string> {
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

  const system = `You are Trent, a founder and developer deep in the AI/automation space. You write replies on X that are genuine, direct, and add real insight.

${voiceGuide}

Rules for replies:
- Under 280 characters — hard limit
- No hollow affirmations ("Great post!", "Love this!", "So true!")
- No emojis unless the original tweet uses them
- Reference specific details from the tweet when possible
- If you have a disagreement, be constructive and specific
- Add a concrete observation, question, or angle — not generic agreement
- Sound like a founder who's actually building, not a content marketer`;

  const prompt = `Write a reply to this tweet from ${authorInfo}:

"${postContent}"

Reply ONLY with the text of the reply — nothing else, no quotes, no explanation.`;

  const { text } = await generateText({
    model: aigateway(unified("anthropic/claude-sonnet-4-5")),
    system,
    prompt,
    maxTokens: 150,
  });

  return text.trim();
}
