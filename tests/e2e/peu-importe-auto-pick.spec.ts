/**
 * Phase 10b R5g — "peu importe" auto-pick on airport disambiguation.
 *
 * Pre-fix bug (2026-05-18 user feedback): typing "peu importe" /
 * "doesn't matter" in reply to "Which Paris airport: CDG, ORY, BVA?"
 * sent the bot into a re-ask loop because extract_trip_data couldn't
 * pull an IATA out of "peu importe". The user got stuck.
 *
 * Phase 10b fix (PR #98): disambiguate_node now matches a
 * no-preference signal regex and auto-picks the primary hub (first
 * entry per city in MULTI_AIRPORT_CITIES) — CDG for Paris, JFK for
 * NYC, LHR for London, MXP for Milan, HND for Tokyo.
 *
 * Phase 10c follow-up (PR pending): the auto-pick now also emits a
 * confirmation AIMessage so the conversation doesn't end silently
 * (the disambiguate node has `graph.add_edge("disambiguate", END)`,
 * so a silent state update would leave the chat hanging).
 *
 * This E2E pins the loop-break: after replying "peu importe", the
 * bot MUST respond (no silent hang) AND MUST NOT re-ask the same
 * airport question. The next user turn would trigger the search;
 * that downstream flow is covered by other E2E specs (plan-b-checkout
 * etc.) so this spec scopes to the disambiguation behaviour only.
 */

import { expect, test } from "@playwright/test";

import { signupAndOnboard } from "./_fixtures/userSetup";

async function waitForBotTurn(
  page: import("@playwright/test").Page,
  options: { hideTimeoutMs?: number } = {},
): Promise<void> {
  const hideTimeoutMs = options.hideTimeoutMs ?? 90_000;
  const status = page.getByText(/Réflexion en cours|Thinking…/i);
  await status.first().waitFor({ state: "visible", timeout: 10_000 }).catch(() => {
    /* fast turn may have already cleared the status */
  });
  await expect(status).toBeHidden({ timeout: hideTimeoutMs });
}

test.describe("Phase 10b 5g — peu importe auto-pick", () => {
  test.setTimeout(180_000);

  test("FR peu importe → bot confirms CDG choice, no re-ask loop", async ({
    page,
  }) => {
    const { input } = await signupAndOnboard(page, { prefix: "p10c-pi-fr" });

    // Paris is multi-airport (CDG/ORY/BVA) → triggers disambiguation.
    await input.fill("Je veux partir de Paris pour Toulouse demain");
    await input.press("Enter");
    await waitForBotTurn(page);

    // Snapshot the chat-message count BEFORE the "peu importe" reply.
    // After the reply we expect EXACTLY one new bot message (the
    // confirmation) — NOT the original airport question repeated.
    const beforeCount = await page
      .getByRole("main")
      .locator('div[class*="rounded-2xl"]')
      .count();

    // Reply "peu importe" — the loop-trigger phrase.
    await input.fill("peu importe");
    await input.press("Enter");
    await waitForBotTurn(page);

    // Loop-break assertion: the bot's confirmation message must
    // mention CDG (the auto-picked primary hub for Paris).
    // The dev panel sidebar has "CDG" buttons that would false-positive
    // a naive page-wide search; scope to `getByRole("main")` PLUS
    // require the surrounding rounded-bubble markup that chat messages
    // use, so we only match the actual conversation bubble.
    const chatBubbles = page
      .getByRole("main")
      .locator('div[class*="rounded-2xl"]');
    await expect(chatBubbles).not.toHaveCount(beforeCount); // new bubble added
    // The newest bubble (last) should contain "CDG" — proves the
    // confirmation message landed.
    await expect(chatBubbles.last()).toContainText(/CDG/i, { timeout: 5_000 });

    // Negative: the bot must NOT have re-asked the SAME question.
    // The original disambiguation question contains all three airports
    // (CDG + ORY + BVA) in one bubble. After "peu importe" the new
    // bubble should mention CDG only (not the full list).
    await expect(chatBubbles.last()).not.toContainText(/ORY.*BVA|BVA.*ORY/i);
  });

  test("EN whichever → bot confirms CDG choice, no re-ask loop", async ({
    page,
  }) => {
    const { input } = await signupAndOnboard(page, { prefix: "p10c-pi-en" });

    await input.fill("I want to fly from Paris to Toulouse tomorrow");
    await input.press("Enter");
    await waitForBotTurn(page);

    const beforeCount = await page
      .getByRole("main")
      .locator('div[class*="rounded-2xl"]')
      .count();

    await input.fill("whichever, doesn't matter");
    await input.press("Enter");
    await waitForBotTurn(page);

    const chatBubbles = page
      .getByRole("main")
      .locator('div[class*="rounded-2xl"]');
    await expect(chatBubbles).not.toHaveCount(beforeCount);
    await expect(chatBubbles.last()).toContainText(/CDG/i, { timeout: 5_000 });
    await expect(chatBubbles.last()).not.toContainText(/ORY.*BVA|BVA.*ORY/i);
  });
});
