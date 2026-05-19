import { expect, test } from "@playwright/test";

/**
 * Happy-path signup: land on homepage, go to signup, create a fresh account,
 * get redirected to /chat and see the empty-state seed prompt.
 */
test("signup creates an account and lands on /chat", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Klymo" })).toBeVisible();

  await page.getByRole("link", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/signup$/);

  // Unique email so the test can run repeatedly without collisions.
  const email = `e2e-${Date.now()}@klymo.local`;
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("password123456");
  await page.getByRole("button", { name: /create account/i }).click();

  await expect(page).toHaveURL(/\/chat$/);
  await expect(page.getByRole("heading", { name: "Klymo" })).toBeVisible();
  await expect(page.getByText(email)).toBeVisible();
});

test("chat page redirects unauthed users to /login", async ({ page }) => {
  // Fresh context, no cookies set.
  await page.context().clearCookies();
  await page.goto("/chat");
  await expect(page).toHaveURL(/\/login$/);
});

/**
 * Company-path signup: same flow as the default happy-path, but the user
 * picks the Company radio before submitting. Verifies the radio selection
 * is preserved through submit and the user lands on /chat.
 *
 * The full /me round-trip (verifying public.users.account_type='company')
 * requires backend PR #68 (users.account_type migration + trigger update)
 * deployed; that end-to-end check happens at PR-C manual walkthrough time.
 */
test("Company-path signup lands on /chat", async ({ page }) => {
  await page.goto("/signup");

  await page.getByRole("radio", { name: /company/i }).check();
  await expect(page.getByRole("radio", { name: /company/i })).toBeChecked();

  const email = `e2e-company-${Date.now()}@klymo.local`;
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("password123456");
  await page.getByRole("button", { name: /create account/i }).click();

  await expect(page).toHaveURL(/\/chat$/);
});
