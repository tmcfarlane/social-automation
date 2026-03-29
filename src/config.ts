import { z } from "zod";

const ConfigSchema = z.object({
  CF_ACCOUNT_ID: z.string().min(1, "CF_ACCOUNT_ID is required"),
  CF_GATEWAY_NAME: z.string().min(1, "CF_GATEWAY_NAME is required"),
  CF_AIG_TOKEN: z.string().min(1, "CF_AIG_TOKEN is required"),
  VOICE_FILE_PATH: z
    .string()
    .default(
      "C:\\Users\\Trent\\rep\\COMMAND CENTER\\Command Center\\Personalization\\my-voice.md"
    ),
  MAX_REPLIES_PER_SESSION: z.coerce.number().int().positive().default(4),
  REPLY_DELAY_MIN_MS: z.coerce.number().int().nonnegative().default(45_000),
  REPLY_DELAY_MAX_MS: z.coerce.number().int().nonnegative().default(90_000),
});

export type Config = z.infer<typeof ConfigSchema>;

export const SEARCH_QUERIES: string[] = [
  "AI agents replacing manual workflows",
  "building LLM applications 2025",
  "agentic AI automation founders",
  "Playwright browser automation developer",
  "Claude API Anthropic use cases",
  "AI startup founders shipping",
  "generative AI productivity tools",
  "OpenAI Anthropic developer experience",
  "LLM agents orchestration",
  "AI SaaS indiehacker",
  "prompt engineering production",
  "autonomous AI systems",
];

export function loadConfig(): Config {
  return ConfigSchema.parse({
    CF_ACCOUNT_ID: process.env["CF_ACCOUNT_ID"],
    CF_GATEWAY_NAME: process.env["CF_GATEWAY_NAME"],
    CF_AIG_TOKEN: process.env["CF_AIG_TOKEN"],
    VOICE_FILE_PATH: process.env["VOICE_FILE_PATH"],
    MAX_REPLIES_PER_SESSION: process.env["MAX_REPLIES_PER_SESSION"],
    REPLY_DELAY_MIN_MS: process.env["REPLY_DELAY_MIN_MS"],
    REPLY_DELAY_MAX_MS: process.env["REPLY_DELAY_MAX_MS"],
  });
}
