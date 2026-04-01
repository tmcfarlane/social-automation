import { z } from "zod";
import { config as loadDotenv } from "dotenv";
import { resolve } from "path";
import { fileURLToPath } from "url";

// Load .env from project root
const __dirname2 = resolve(fileURLToPath(import.meta.url), "..");
loadDotenv({ path: resolve(__dirname2, "..", ".env") });

const ConfigSchema = z.object({
  CF_ACCOUNT_ID: z.string().min(1, "CF_ACCOUNT_ID is required"),
  CF_GATEWAY_NAME: z.string().min(1, "CF_GATEWAY_NAME is required"),
  CF_AIG_TOKEN: z.string().min(1, "CF_AIG_TOKEN is required"),
  VOICE_FILE_PATH: z
    .string()
    .default(
      "C:\\Users\\Trent\\rep\\COMMAND CENTER\\Command Center\\Personalization\\my-voice.md"
    ),
  MAX_REPLIES_PER_SESSION: z.coerce.number().int().positive().default(8),
  REPLY_DELAY_MIN_MS: z.coerce.number().int().nonnegative().default(45_000),
  REPLY_DELAY_MAX_MS: z.coerce.number().int().nonnegative().default(90_000),
  // LinkedIn-specific
  LINKEDIN_MAX_REPLIES_PER_SESSION: z.coerce.number().int().positive().default(6),
  LINKEDIN_REPLY_DELAY_MIN_MS: z.coerce.number().int().nonnegative().default(60_000),
  LINKEDIN_REPLY_DELAY_MAX_MS: z.coerce.number().int().nonnegative().default(120_000),
  LINKEDIN_PROFILE_URL: z.string().default("https://www.linkedin.com/in/trent-mcfarlane-46ab204a"),
});

export type Config = z.infer<typeof ConfigSchema>;

// ── X search queries ─────────────────────────────────────────────────────

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

// ── LinkedIn search queries ──────────────────────────────────────────────

export const LINKEDIN_SEARCH_QUERIES: string[] = [
  "AI agents enterprise workflows",
  "agentic AI production deployment",
  "Claude API Anthropic enterprise",
  "AI native development teams",
  "LLM orchestration architecture",
  "AI consulting transformation",
  "browser automation Playwright",
  "AI SaaS founders building",
  "autonomous AI systems production",
  "generative AI productivity enterprise",
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
    LINKEDIN_MAX_REPLIES_PER_SESSION: process.env["LINKEDIN_MAX_REPLIES_PER_SESSION"],
    LINKEDIN_REPLY_DELAY_MIN_MS: process.env["LINKEDIN_REPLY_DELAY_MIN_MS"],
    LINKEDIN_REPLY_DELAY_MAX_MS: process.env["LINKEDIN_REPLY_DELAY_MAX_MS"],
    LINKEDIN_PROFILE_URL: process.env["LINKEDIN_PROFILE_URL"],
  });
}
