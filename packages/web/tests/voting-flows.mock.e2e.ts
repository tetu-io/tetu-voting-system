import { expect, test } from "@playwright/test";

function toDateTimeLocalInput(unixTs: number): string {
  const date = new Date(unixTs * 1000);
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 16);
}

test("frontend pages flow in mock mode", async ({ page }) => {
  await page.goto("/");
  if (!(await page.getByTestId("mock-mode-banner").isVisible().catch(() => false))) {
    test.skip(true, "Mock e2e runs only when app is in mock mode.");
  }
  await expect(page.getByTestId("mock-mode-banner")).toBeVisible();

  await page.getByTestId("connect-mock-wallet").click();
  await expect(page.getByTestId("wallet-status")).toContainText("Wallet:");

  await page.getByTestId("open-create-space-modal").click();
  await page.getByTestId("space-token-input").fill("0x0000000000000000000000000000000000000001");
  await page.getByTestId("space-name-input").fill("Mock Page Space");
  await page.getByTestId("space-description-input").fill("Created in mock mode");
  await page.getByTestId("create-space-btn").click();
  await expect(page).toHaveURL(/\/spaces\/\d+$/);

  const createdSpaceId = page.url().split("/").at(-1) ?? "1";
  const spaceBreadcrumbs = page.getByRole("navigation", { name: "Breadcrumbs" });
  await expect(spaceBreadcrumbs.getByRole("link", { name: "Spaces" })).toBeVisible();
  await expect(spaceBreadcrumbs).toContainText(`Space #${createdSpaceId}`);
  await page.getByRole("button", { name: "Back" }).click();
  await expect(page).toHaveURL("/");

  await page.goto(`/spaces/${createdSpaceId}`);
  await expect(page).toHaveURL(new RegExp(`/spaces/${createdSpaceId}$`));
  await page.getByRole("button", { name: "Create Proposal" }).click();
  await expect(page).toHaveURL(new RegExp(`/spaces/${createdSpaceId}/proposals/new$`));
  const createBreadcrumbs = page.getByRole("navigation", { name: "Breadcrumbs" });
  await expect(createBreadcrumbs).toContainText(`Space #${createdSpaceId}`);
  await expect(createBreadcrumbs).toContainText("Create proposal");
  await page.getByRole("button", { name: "Back" }).click();
  await expect(page).toHaveURL(new RegExp(`/spaces/${createdSpaceId}$`));
  await page.getByRole("button", { name: "Create Proposal" }).click();
  await expect(page).toHaveURL(new RegExp(`/spaces/${createdSpaceId}/proposals/new$`));

  const nowTs = Math.floor(Date.now() / 1000);
  await page.getByTestId("proposal-title-input").fill("Mock Multi Proposal");
  await page.getByTestId("proposal-description-input").fill("Mock weighted vote");
  await page.getByTestId("proposal-multiselect-input").check();
  await page.getByTestId("proposal-start-input").fill(toDateTimeLocalInput(nowTs - 60));
  await page.getByTestId("proposal-end-input").fill(toDateTimeLocalInput(nowTs + 3600));
  await page.getByTestId("create-proposal-btn").click();
  await expect(page).toHaveURL(/\/proposals\/\d+$/);

  await page.getByTestId("vote-option-check-0").check();
  await page.getByTestId("vote-option-weight-0").fill("1");
  await page.getByTestId("vote-option-check-1").check();
  await page.getByTestId("vote-option-weight-1").fill("3");
  await page.getByTestId("vote-multi-submit").click();
  await expect(page.getByTestId("status-message")).toContainText("Tx confirmed: vote");

  const proposalBreadcrumbs = page.getByRole("navigation", { name: "Breadcrumbs" });
  await expect(proposalBreadcrumbs).toContainText("Proposal #");
  await proposalBreadcrumbs.getByRole("link", { name: new RegExp(`Space #${createdSpaceId}`) }).click();
  await expect(page).toHaveURL(new RegExp(`/spaces/${createdSpaceId}$`));
});
