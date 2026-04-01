/**
 * Centralized path constants for all runtime state and logs.
 * Everything lives under <project-root>/data/ (gitignored).
 */
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const PROJECT_ROOT = path.resolve(__dirname, "..");
export const DATA_DIR = path.join(PROJECT_ROOT, "data");

// ── Scheduler ────────────────────────────────────────────────────────────
export const SCHEDULER_DIR = path.join(DATA_DIR, "scheduler");
export const SCHEDULER_CONTROL_PATH = path.join(SCHEDULER_DIR, "scheduler-control.json");
export const SCHEDULER_STATUS_PATH = path.join(SCHEDULER_DIR, "scheduler-status.json");
export const SCHEDULER_LOG_PATH = path.join(SCHEDULER_DIR, "scheduler.log");
export const DASHBOARD_LOG_PATH = path.join(SCHEDULER_DIR, "dashboard.log");

// Per-task log files (persisted across runs)
export const TASK_LOG_DIR = path.join(SCHEDULER_DIR, "task-logs");

// ── X ────────────────────────────────────────────────────────────────────
export const X_STATE_DIR = path.join(DATA_DIR, "x", "state");
export const X_OUTBOUND_STATE_PATH = path.join(X_STATE_DIR, "x-outbound-state.json");
export const X_INBOUND_STATE_PATH = path.join(X_STATE_DIR, "x-inbound-state.json");
export const X_COSTS_PATH = path.join(X_STATE_DIR, "x-costs.jsonl");
export const X_OUTBOUND_LOG_DIR = path.join(DATA_DIR, "x", "outbound");
export const X_REPLIES_LOG_DIR = path.join(DATA_DIR, "x", "replies");

// ── LinkedIn ─────────────────────────────────────────────────────────────
export const LINKEDIN_STATE_DIR = path.join(DATA_DIR, "linkedin", "state");
export const LINKEDIN_OUTBOUND_STATE_PATH = path.join(LINKEDIN_STATE_DIR, "linkedin-outbound-state.json");
export const LINKEDIN_INBOUND_STATE_PATH = path.join(LINKEDIN_STATE_DIR, "linkedin-inbound-state.json");
export const LINKEDIN_COSTS_PATH = path.join(LINKEDIN_STATE_DIR, "linkedin-costs.jsonl");
export const LINKEDIN_OUTBOUND_LOG_DIR = path.join(DATA_DIR, "linkedin", "outbound");
export const LINKEDIN_REPLIES_LOG_DIR = path.join(DATA_DIR, "linkedin", "replies");
