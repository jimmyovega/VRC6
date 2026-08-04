import { test } from "@playwright/test";

// TEMPORARY diagnostic — not for merge. Dumps every console message and
// failed/blocked network request from a plain page load, to find out exactly
// what CSP is blocking that's causing the CI E2E anomaly.
test("DIAG: dump console + failed requests for /contact", async ({ page }) => {
  page.on("console", (msg) => {
    console.log(`[CONSOLE ${msg.type()}] ${msg.text()}`);
  });
  page.on("pageerror", (err) => {
    console.log(`[PAGEERROR] ${err.message}`);
  });
  page.on("requestfailed", (req) => {
    console.log(`[REQUESTFAILED] ${req.method()} ${req.url()} — ${req.failure()?.errorText}`);
  });
  page.on("response", (res) => {
    if (res.status() >= 400) {
      console.log(`[RESPONSE ${res.status()}] ${res.url()}`);
    }
  });

  await page.goto("/contact", { timeout: 10_000 });
  await page.waitForTimeout(2000);
  console.log("[DIAG] navigation + wait completed without hanging");
});
