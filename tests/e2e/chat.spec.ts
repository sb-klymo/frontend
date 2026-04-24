import { expect, test } from "@playwright/test";

/**
 * Signs a fresh user up, sends a first message, and checks the assistant
 * reply bubble appears. Exercises the full stack: Next.js BFF proxy,
 * FastAPI /chat SSE, LangGraph agent, Postgres checkpointer.
 */
test("first chat turn produces an assistant reply", async ({ page }) => {
  // Fresh account to avoid reusing state from other tests.
  const email = `e2e-chat-${Date.now()}@klymo.local`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("password123456");
  await page.getByRole("button", { name: /create account/i }).click();
  await expect(page).toHaveURL(/\/chat$/);

  const input = page.getByPlaceholder(/ask about a trip/i);
  await input.fill("I want to fly from Paris next Friday");
  await input.press("Enter");

  // User bubble shows immediately.
  await expect(
    page.getByText("I want to fly from Paris next Friday"),
  ).toBeVisible();

  // Agent reply arrives within a few seconds (extract LLM call + ask node).
  // The exact template question depends on what the LLM extracted from the
  // first message (trip_type inferred or not), so match any of the 5 templates.
  await expect(
    page.getByText(/one-way|round trip|departing|like to go|like to depart|like to return/i),
  ).toBeVisible({ timeout: 20_000 });
});
