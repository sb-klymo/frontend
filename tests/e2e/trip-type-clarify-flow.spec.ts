/**
 * Trip-type clarification — deterministic keyword-guard coverage.
 *
 * Phase-11 product change (2026-05-25): the old "default one-way +
 * disclaimer" behaviour was replaced by an ask_node clarification
 * ("Aller simple ou aller-retour ?") for ambiguous prompts.
 *
 * What changed vs. the retired one-way-disclaimer-flow.spec.ts:
 *   - The disclaimer phrases ("let me know if you'd like a return",
 *     "si tu veux un retour", "ajouter un retour", "went with one-way",
 *     etc.) are GONE — they must never appear.
 *   - For truly ambiguous prompts the bot now asks a clarifying
 *     question; however that path is LLM-dependent and therefore NOT
 *     tested here (it would be flaky).
 *
 * This file tests only the DETERMINISTIC keyword-guard paths:
 *   - Explicit one-way keyword ("aller simple") → LLM classifies
 *     trip_type=one_way in extract_node; the graph bypasses ask_node
 *     entirely and goes straight to searching → options card.
 *   - No disclaimer, no trip-type question from the bot.
 *
 * The explicit round-trip happy path (keyword "aller-retour") already
 * has full coverage in round-trip-flow.spec.ts; we do not duplicate it
 * here. The one assertion we DO add (assertion 3 below) is a cheap
 * negative: the old disclaimer text is absent on round-trip cards too.
 *
 * LLM-dependent path ("ambiguous prompt → bot asks clarification") is
 * proven deterministically by the backend unit/graph tests:
 *   backend/tests/agent/test_round_trip_clarify_flow.py
 * It is intentionally absent here to avoid e2e flakiness.
 */

import { expect, test } from "@playwright/test";

import { signupAndOnboard } from "./_fixtures/userSetup";

test.describe("Trip-type keyword guard — deterministic contract", () => {
  test.setTimeout(180_000);

  /**
   * 1. Explicit "aller simple" keyword → options card, no bot
   *    trip-type question, no old disclaimer text.
   */
  test('explicit one-way keyword → options card, no clarification question, no disclaimer', async ({
    page,
  }) => {
    const { input } = await signupAndOnboard(page, { prefix: "owaykw" });

    // "aller simple" is the deterministic one-way keyword. The backend
    // extract_node picks it up before the LLM has any ambiguity to
    // resolve — trip_type=one_way is set, ask_node is bypassed.
    await input.fill(
      "Vol Marseille → Toulouse demain, aller simple, 1 passager",
    );
    await input.press("Enter");

    // Options card must arrive (search completed, no stall on ask_node).
    await expect(page.getByText(/Option 1/i).first()).toBeVisible({
      timeout: 60_000,
    });

    // The bot must NOT have asked a clarification question. Scope the
    // negative assertion to the phrase "ou aller-retour" — that
    // substring comes only from the bot's ask_node question, never
    // from the user's own "aller simple" text.
    await expect(
      page.getByText(/ou aller-retour/i),
    ).toHaveCount(0);

    // The old disclaimer phrases (retired in Phase-11) must not appear.
    await expect(
      page.getByText(/went with one-way/i),
    ).toHaveCount(0);
    await expect(
      page.getByText(/let me know if you'd like a return|si tu veux.*retour|ajouter.*retour|add.*return/i),
    ).toHaveCount(0);
  });

  /**
   * 2. Negative: old disclaimer text must not appear on explicit
   *    round-trip searches either.
   *    (Full round-trip selection flow lives in round-trip-flow.spec.ts.)
   */
  test('explicit round-trip keyword → no old disclaimer text on options card', async ({
    page,
  }) => {
    const { input } = await signupAndOnboard(page, { prefix: "rtkwdisc" });

    await input.fill(
      "Vol aller-retour Marseille → Toulouse, départ demain et retour dans 3 jours, 1 passager",
    );
    await input.press("Enter");

    // Wait for options card before making negative assertions so we
    // don't race against the bot still typing.
    await expect(page.getByText(/Option 1/i).first()).toBeVisible({
      timeout: 60_000,
    });

    // No Phase-10 disclaimer text anywhere on the page.
    await expect(
      page.getByText(/went with one-way/i),
    ).toHaveCount(0);
    await expect(
      page.getByText(/let me know if you'd like a return|si tu veux.*retour|ajouter.*retour|add.*return/i),
    ).toHaveCount(0);
  });
});
