/**
 * LinkedIn Chrome launcher — uses the same Chrome instance as X (port 9222).
 * The user is logged into both X and LinkedIn in the same browser.
 * The scheduler's platform lock prevents concurrent tab conflicts.
 */
import type { Browser } from "playwright";
import { ensureBrowser as ensureBrowserShared } from "../shared/ensure-chrome.js";

const CHROME_PORT = 9222;
const USER_DATA_DIR = "C:\\temp\\chrome-debug";

export async function ensureBrowser(cdpUrl?: string): Promise<Browser> {
  return ensureBrowserShared({
    port: CHROME_PORT,
    userDataDir: USER_DATA_DIR,
    cdpUrl: cdpUrl ?? process.env["CHROME_CDP_URL"],
  });
}
