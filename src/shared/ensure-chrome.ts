/**
 * Shared Chrome launcher — ensures Chrome is running with --remote-debugging-port.
 * If it can't connect, launches Chrome automatically with the debug flag.
 *
 * Each platform (X, LinkedIn) uses a separate port + user-data-dir to allow
 * cross-platform concurrency.
 */
import { chromium } from "playwright";
import type { Browser } from "playwright";
import { spawn } from "child_process";

const CHROME_PATH = "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe";

export interface ChromeOptions {
  port: number;
  userDataDir: string;
  cdpUrl?: string; // override full URL (e.g., from env var)
}

export async function ensureBrowser(opts: ChromeOptions): Promise<Browser> {
  const url = opts.cdpUrl ?? `http://127.0.0.1:${opts.port}`;

  // Try connecting first
  try {
    return await chromium.connectOverCDP(url);
  } catch {
    // Not running — launch it
  }

  console.log(`[chrome] Debug port ${opts.port} not reachable, launching Chrome...`);
  spawn(CHROME_PATH, [
    `--remote-debugging-port=${opts.port}`,
    `--user-data-dir=${opts.userDataDir}`,
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
