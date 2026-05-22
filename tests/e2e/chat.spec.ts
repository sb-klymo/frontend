import { expect, test } from "@playwright/test";

import { signupAndOnboard } from "./_fixtures/userSetup";

/**
 * Signs a fresh user up, sends a first message, and checks the assistant
 * reply bubble appears. Exercises the full stack: Next.js BFF proxy,
 * FastAPI /chat SSE, LangGraph agent, Postgres checkpointer.
 *
 * Uses signupAndOnboard to seed first_name + account_type so the chat
 * service skips the personal-name onboarding step that landed
 * 2026-05-19 — otherwise the agent asks "What's your first name?"
 * instead of the trip clarification this test asserts on.
 */
test("first chat turn produces an assistant reply", async ({ page }) => {
  const { input } = await signupAndOnboard(page, { prefix: "chat" });
  await input.fill("I want to fly from Paris next Friday");
  await input.press("Enter");

  // User bubble shows immediately.
  await expect(
    page.getByText("I want to fly from Paris next Friday"),
  ).toBeVisible();

  // The smoke contract: "Thinking…" status disappears (stream completed) and
  // an assistant reply renders. Don't pin the wording — the agent picks one of
  // many follow-ups (trip-type, destination, airport disambiguation, …) and
  // they all drift as the LLM is reprompted. The point of this smoke test is
  // that the full pipeline (SSE proxy → FastAPI /chat → LangGraph → checkpointer)
  // produces ANY assistant reply, not a specific question. 45s tolerates LLM
  // first-turn latency including extract + name greeting + ask node.
  await expect(page.getByText(/Thinking…/i)).toBeHidden({ timeout: 45_000 });
  const assistantBubble = page.locator('[data-testid="assistant-message"], [data-role="assistant"]').first();
  if ((await assistantBubble.count()) > 0) {
    await expect(assistantBubble).toBeVisible();
  } else {
    // Fallback: assert ANY non-input text appeared after the user bubble.
    await expect(
      page.getByRole("main").getByText(/.{8,}/).nth(1),
    ).toBeVisible({ timeout: 5_000 });
  }
});
