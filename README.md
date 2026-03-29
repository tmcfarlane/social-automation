# social-automation

Deterministic Playwright micro-skills for LinkedIn and X engagement automation.
Claude API (via Cloudflare AI Gateway) is used **only** for reply-text generation — every browser action is driven by explicit Playwright locators, zero LLM tokens for navigation or clicking.

## Architecture

```
orchestrator → micro-skills (Playwright) → browser
                    ↓
             outbound-engagement → claude-client (Cloudflare AI Gateway → Claude Sonnet)
```

- **Playwright handles ALL browser actions** — login check, search, scroll, type, submit, verify
- **Claude API handles ONLY reply text generation** — ~3K tokens per reply
- **No improvisation** — the orchestrator chains skills deterministically; failures are logged and skipped, never escalated to computer use

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment variables

Create a `.env` file (never committed) or export these in your shell:

```bash
# Cloudflare AI Gateway (token authenticates with gateway AND handles provider auth)
CF_ACCOUNT_ID=a607058a36824ab70af9da48d001a546
CF_GATEWAY_NAME=skillforge
CF_AIG_TOKEN=cfut_...

# Optional overrides
VOICE_FILE_PATH="C:\Users\Trent\rep\COMMAND CENTER\Command Center\Personalization\my-voice.md"
MAX_REPLIES_PER_SESSION=4
REPLY_DELAY_MIN_MS=45000
REPLY_DELAY_MAX_MS=90000

# Optional: connect to an already-open Chrome instance via CDP
# CHROME_CDP_URL=http://localhost:9222
```

### 3. Browser setup

Make sure you are **logged in to X** in the browser that Playwright will control.

- **Reuse existing Chrome** (recommended): launch Chrome with `--remote-debugging-port=9222` and set `CHROME_CDP_URL=http://localhost:9222`
- **Fresh browser**: omit `CHROME_CDP_URL`; Playwright will launch a headed Chromium window

### 4. Voice guide

The file at `VOICE_FILE_PATH` is read at runtime and injected as context into every Claude API call. It should describe your writing style, tone, and any rules for replies. If the file is missing a default voice is used.

## Usage

### Run X outbound engagement

```bash
npm run x-outbound
```

Picks a random AI/tech search query, scrolls results, filters tweets by engagement (≥50 total, ≤24h old), and posts up to `MAX_REPLIES_PER_SESSION` replies with natural 45–90s pacing.

Results are logged to `engagement-log.jsonl` in the project root.

### Run all tests

```bash
npm test
```

### Watch mode

```bash
npm run test:watch
```

## File structure

```
src/
├── config.ts                    # Zod-validated config from env vars
├── types.ts                     # Shared TypeScript interfaces
├── orchestrator.ts              # Generic LinkedIn + X orchestrator
├── llm/
│   └── claude-client.ts         # Claude API via Cloudflare AI Gateway
├── linkedin/                    # LinkedIn micro-skills
│   ├── login-check.ts
│   ├── open-feed.ts
│   ├── scroll-feed.ts
│   ├── find-target-post.ts
│   ├── read-comments.ts
│   ├── check-already-replied.ts
│   ├── type-reply.ts
│   ├── submit-reply.ts
│   └── verify-reply.ts
├── x/                           # X (Twitter) micro-skills
│   ├── login-check.ts
│   ├── search-topic.ts
│   ├── scroll-results.ts
│   ├── find-target-tweet.ts
│   ├── read-thread.ts
│   ├── type-reply.ts
│   ├── submit-reply.ts
│   ├── verify-reply.ts
│   └── outbound-engagement.ts   # Full outbound engagement flow
└── tests/
    ├── linkedin.test.ts
    └── x.test.ts
```

## Token efficiency

| Operation | Handler | Tokens |
|-----------|---------|--------|
| Login check | Playwright | 0 |
| Search + scroll | Playwright | 0 |
| Filter tweets | Pure function | 0 |
| Read thread | Playwright | 0 |
| **Generate reply** | **Claude Sonnet** | **~3K** |
| Type / submit / verify | Playwright | 0 |

Cost per session (4 replies): ~12K tokens ≈ $0.05 at Sonnet pricing.
