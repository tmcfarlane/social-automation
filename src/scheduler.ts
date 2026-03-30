/**
 * Alternating scheduler: runs outbound then inbound in a loop,
 * waiting a random 24–42 minutes between each run.
 */
import { loadConfig } from "./config.js";
import { runOutboundEngagement } from "./x/outbound-engagement.js";
import { runInboundEngagement } from "./x/inbound-engagement.js";

const MIN_DELAY_MS = 24 * 60 * 1_000;
const MAX_DELAY_MS = 42 * 60 * 1_000;

function randomDelay(): number {
  return Math.floor(Math.random() * (MAX_DELAY_MS - MIN_DELAY_MS) + MIN_DELAY_MS);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function log(entry: Record<string, unknown>): void {
  console.log(JSON.stringify({ ts: new Date().toISOString(), ...entry }));
}

async function main(): Promise<void> {
  const config = loadConfig();
  let mode: "outbound" | "inbound" = "outbound";

  log({ event: "scheduler_start" });

  while (true) {
    log({ event: "run_start", mode });

    try {
      if (mode === "outbound") {
        await runOutboundEngagement(config);
      } else {
        await runInboundEngagement(config);
      }
    } catch (err) {
      log({ event: "run_error", mode, error: String(err) });
    }

    mode = mode === "outbound" ? "inbound" : "outbound";

    const delayMs = randomDelay();
    const delayMin = +(delayMs / 60_000).toFixed(1);
    log({ event: "next_run", mode, inMinutes: delayMin });
    await sleep(delayMs);
  }
}

main().catch((err) => {
  console.error("[scheduler] Fatal:", err);
  process.exit(1);
});
