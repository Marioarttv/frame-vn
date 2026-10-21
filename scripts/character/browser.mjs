import { chromium } from "@playwright/test";

/** Reuse an installed browser. Authoring never downloads software automatically. */
export async function launchAuthoringBrowser() {
  const requested = process.env.FRAME_BROWSER_CHANNEL;
  const attempts = requested
    ? [
        requested === "chromium" || requested === "bundled"
          ? undefined
          : requested,
      ]
    : process.env.CI
      ? [undefined, "chrome"]
      : ["chrome", undefined];
  for (const channel of attempts) {
    try {
      return await chromium.launch({
        headless: true,
        ...(channel ? { channel } : {}),
      });
    } catch {
      /* Try the other already-installed browser only. */
    }
  }
  throw new Error(
    "No authoring browser is available. Install Google Chrome or run npm run setup:browser. FRAME_BROWSER_CHANNEL can select an installed Playwright browser channel.",
  );
}
