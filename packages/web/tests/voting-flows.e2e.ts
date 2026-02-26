import { test, expect } from "@playwright/test";

function attachRuntimeGuards(page: import("@playwright/test").Page) {
  const pageErrors: string[] = [];
  const criticalConsoleErrors: string[] = [];

  page.on("pageerror", (error) => {
    pageErrors.push(error.message);
  });

  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    const text = msg.text();
    // Ignore favicon/static noise; keep runtime and integration failures.
    if (text.includes("favicon")) return;
    criticalConsoleErrors.push(text);
  });

  return {
    assertHealthy() {
      expect(
        pageErrors,
        `Unexpected page runtime errors:\n${pageErrors.join("\n")}`
      ).toEqual([]);
      expect(
        criticalConsoleErrors,
        `Unexpected console errors:\n${criticalConsoleErrors.join("\n")}`
      ).toEqual([]);
    }
  };
}

test("ui renders proposal creation flow", async ({ page }) => {
  const guards = attachRuntimeGuards(page);
  await page.goto("/");
  await expect(page.getByText("Tetu Voting v1")).toBeVisible();
  await expect(page.getByText("Create proposal")).toBeVisible();
  await expect(page.getByRole("button", { name: "Connect Wallet" })).toBeVisible();
  guards.assertHealthy();
});

test("ui renders vote and re-vote section", async ({ page }) => {
  const guards = attachRuntimeGuards(page);
  await page.goto("/");
  await expect(page.getByText("Selected proposal")).toBeVisible();
  await expect(page.getByText("Proposals")).toBeVisible();
  guards.assertHealthy();
});

test("ui shows ended-state messaging section", async ({ page }) => {
  const guards = attachRuntimeGuards(page);
  await page.goto("/");
  await expect(page.getByText("Activity")).toBeVisible();
  guards.assertHealthy();
});

test("ui exposes interoperability entrypoint for CLI-created proposals", async ({ page }) => {
  const guards = attachRuntimeGuards(page);
  await page.goto("/");
  await expect(page.getByText("Load from events")).toBeVisible();
  guards.assertHealthy();
});

test("ui does not depend on web3modal remote config in local mode", async ({ page }) => {
  const failedUrls: string[] = [];
  page.on("requestfailed", (req) => {
    failedUrls.push(req.url());
  });

  await page.goto("/");

  const web3modalFailures = failedUrls.filter(
    (url) => url.includes("api.web3modal.org") || url.includes("pulse.walletconnect.org")
  );
  expect(web3modalFailures).toEqual([]);
});
