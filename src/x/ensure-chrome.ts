/**
 * Ensures Chrome is running with --remote-debugging-port.
 * If it can't connect, launches Chrome automatically with the debug flag.
 */
import { chromium } from "playwright";
import type { Browser } from "playwright";
import { execSync, spawn } from "child_process";

const CHROME_PATH = "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe";
const USER_DATA_DIR = "C:\\temp\\chrome-debug";
const DEFAULT_CDP_URL = "http://127.0.0.1:9222";

export async function ensureBrowser(cdpUrl?: string): Promise<Browser> {
  const url = cdpUrl ?? process.env["CHROME_CDP_URL"] ?? DEFAULT_CDP_URL;

  // Try connecting first
  try {
    return await chromium.connectOverCDP(url);
  } catch {
    // Not running — launch it
  }

  console.log("[chrome] Debug port not reachable, launching Chrome...");
  spawn(CHROME_PATH, [
    `--remote-debugging-port=9222`,
    `--user-data-dir=${USER_DATA_DIR}`,
  ], { detached: true, stdio: "ignore" }).unref();

  // Wait up to 15s for it to be ready
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 500));
    try {
      return await chromium.connectOverCDP(url);
    } catch {
      // Not ready yet
    }
  }

  throw new Error(`Chrome failed to start on ${url} after 15s`);
}
