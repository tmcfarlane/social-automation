/**
 * Alternating scheduler: runs outbound then inbound in a loop,
 * waiting a random 24–42 minutes between each run.
 *
 * Controllable via scheduler-control.json (written by dashboard):
 *   paused: boolean       — pause/resume the scheduler
 *   triggerNow: string    — "outbound" | "inbound" | null — run immediately
 *   skipWait: boolean     — skip current delay, start next run now
 */
import * as fs from "fs";
import * as path from "path";
import { loadConfig } from "./config.js";
import { runOutboundEngagement } from "./x/outbound-engagement.js";
import { runInboundEngagement } from "./x/inbound-engagement.js";

const MIN_DELAY_MS = 24 * 60 * 1_000;
const MAX_DELAY_MS = 42 * 60 * 1_000;
const CONTROL_PATH = "C:\\Users\\Trent\\rep\\COMMAND CENTER\\Command Center\\SocialMediaEngine\\X\\state\\scheduler-control.json";
const STATUS_PATH = "C:\\Users\\Trent\\rep\\COMMAND CENTER\\Command Center\\SocialMediaEngine\\X\\state\\scheduler-status.json";

interface Control {
  paused: boolean;
  triggerNow: "outbound" | "inbound" | null;
  skipWait: boolean;
}

function readControl(): Control {
  try {
    return { paused: false, triggerNow: null, skipWait: false, ...JSON.parse(fs.readFileSync(CONTROL_PATH, "utf-8")) };
  } catch {
    return { paused: false, triggerNow: null, skipWait: false };
  }
}

function writeControl(ctrl: Control): void {
  try {
    fs.mkdirSync(path.dirname(CONTROL_PATH), { recursive: true });
    fs.writeFileSync(CONTROL_PATH, JSON.stringify(ctrl, null, 2));
  } catch {}
}

function writeStatus(status: Record<string, unknown>): void {
  try {
    fs.mkdirSync(path.dirname(STATUS_PATH), { recursive: true });
    fs.writeFileSync(STATUS_PATH, JSON.stringify({ ts: new Date().toISOString(), ...status }, null, 2));
  } catch {}
}

function randomDelay(): number {
  return Math.floor(Math.random() * (MAX_DELAY_MS - MIN_DELAY_MS) + MIN_DELAY_MS);
}

function log(entry: Record<string, unknown>): void {
  console.log(JSON.stringify({ ts: new Date().toISOString(), ...entry }));
}

/** Interruptible sleep — checks control file every 5s for skipWait or triggerNow */
async function interruptibleSleep(ms: number): Promise<"completed" | "skipped" | "triggered"> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const wait = Math.min(5_000, end - Date.now());
    await new Promise((r) => setTimeout(r, wait));

    const ctrl = readControl();
    if (ctrl.skipWait) {
      writeControl({ ...ctrl, skipWait: false });
      return "skipped";
    }
    if (ctrl.triggerNow) {
      return "triggered";
    }
    if (ctrl.paused) {
      // Extend the wait — stay paused
      writeStatus({ state: "paused" });
      while (readControl().paused) {
        await new Promise((r) => setTimeout(r, 5_000));
      }
      return "skipped";
    }
  }
  return "completed";
}

async function main(): Promise<void> {
  const config = loadConfig();
  let mode: "outbound" | "inbound" = "outbound";

  // Initialize control file
  writeControl({ paused: false, triggerNow: null, skipWait: false });
  writeStatus({ state: "starting" });
  log({ event: "scheduler_start" });

  while (true) {
    // Check for trigger override
    const ctrl = readControl();
    if (ctrl.triggerNow) {
      mode = ctrl.triggerNow;
      writeControl({ ...ctrl, triggerNow: null });
      log({ event: "trigger_override", mode });
    }

    // Check if paused
    if (ctrl.paused) {
      writeStatus({ state: "paused" });
      log({ event: "paused" });
      while (readControl().paused) {
        await new Promise((r) => setTimeout(r, 5_000));
      }
      log({ event: "resumed" });
    }

    writeStatus({ state: "running", mode });
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

    const nextMode = mode === "outbound" ? "inbound" : "outbound";
    mode = nextMode;

    const delayMs = randomDelay();
    const delayMin = +(delayMs / 60_000).toFixed(1);
    const nextRunAt = new Date(Date.now() + delayMs).toISOString();
    log({ event: "next_run", mode: nextMode, inMinutes: delayMin });
    writeStatus({ state: "waiting", nextMode, nextRunAt, delayMin });

    const result = await interruptibleSleep(delayMs);
    if (result === "triggered") {
      // triggerNow is set — loop will pick it up
    }
  }
}

main().catch((err) => {
  writeStatus({ state: "crashed", error: String(err) });
  console.error("[scheduler] Fatal:", err);
  process.exit(1);
});
