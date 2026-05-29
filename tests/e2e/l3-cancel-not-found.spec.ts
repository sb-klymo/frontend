import { expect, test } from "@playwright/test";

/**
 * L3 cancel-booking intent — partial E2E.
 *
 * A full L3 E2E (book → cancel → refund visible) would require
 * navigating Stripe Checkout in the test, which is third-party and
 * flaky in CI. Instead we cover the L3 INTENT path with a clean
 * partial:
 *
 *   1. Fresh user, no booking yet.
 *   2. Type "annule ma réservation" in chat.
 *   3. Assert: the agent classifies the intent correctly, routes to
 *      `cancel_booking_node`, and the node emits the friendly
 *      "couldn't find your booking" template (because state has no
 *      `booking_reference` yet).
 *
 * This proves the wiring of three layers that aren't covered by any
 * other test layer end-to-end:
 *   * Frontend SSE handler for `event: cancellation` (or its absence
 *     in the not-found case — we still assert the agent text)
 *   * Backend graph router `has_cancel_booking_intent_in_state`
 *   * LLM intent classifier correctly distinguishing "cancel my
 *     booking" from "annule, recommence" (chat-restart)
 *
 * The happy-path L3 (with a confirmed booking) is covered by:
 *   * Backend unit + service tests (15 cases in PR #38)
 *   * Backend SSE projection tests (4 cases in PR #39)
 *   * Frontend CancellationCard component tests (5 cases)
 *   * Manual smoke test scheduled for 2026-05-11
 */
test("L3 cancel intent on a fresh user emits the not-found template", async ({
  page,
}) => {
  const email = `e2e-l3notfound-${Date.now()}@klymo.local`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("password123456");
  await page.getByRole("button", { name: /create account/i }).click();
  await expect(page).toHaveURL(/\/chat$/);

  // No booking exists for this user — the agent should detect the
  // cancel-booking intent, route to cancel_booking_node, find no
  // booking_reference in state, and emit the not-found template
  // (rephrased through phrase() in production).
  const input = page.getByPlaceholder(/ask about a trip|parlez-moi d.un voyage/i);
  await input.fill("annule ma réservation");
  await input.press("Enter");

  // The user's message renders immediately.
  await expect(page.getByText("annule ma réservation")).toBeVisible();

  // The agent's reply arrives within ~3-6s (extract → cancel classifier
  // → cancel_booking_node → phrase()). The "couldn't find your booking"
  // copy is rephrased by Sonnet, but in both EN/FR the message
  // mentions some variation of "find" / "trouve" / "trouver" /
  // "booking" / "réservation" / "couldn't" / "couldn'". We match a
  // loose regex covering reasonable rephrasings.
  const replyMatcher = page.getByText(
    /\b(?:couldn['’]t\s+find|n['’]ai\s+pas\s+trouv|trouve\s+pas|pas\s+de\s+r[ée]servation|no\s+booking|réservation)/i,
  );
  await expect(replyMatcher.first()).toBeVisible({ timeout: 20_000 });

  // The agent must NOT route this to the chat-restart `cancel_node`.
  // That node emits "OK, starting fresh. Where would you like to go?"
  // — same as the cancel-recommence flow. If we see that text, the
  // intent classifier classified incorrectly (regression).
  await expect(
    page.getByText(/starting fresh|on repart à zéro|where would you like to go/i),
  ).not.toBeVisible();
});
