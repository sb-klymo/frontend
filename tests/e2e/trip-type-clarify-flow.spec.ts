/**
 * Trip-type clarification — deterministic keyword-guard + ambiguous-ask
 * coverage.
 *
 * Phase-11 product change (backend commit 415aa07): the old "default
 * one-way + disclaimer" behaviour has been replaced by two deterministic
 * paths:
 *
 *   A. Ambiguous prompt (no trip-type keyword, no return date) →
 *      ask_node is entered and the bot ALWAYS asks "Aller simple ou
 *      aller-retour ?" before searching. No option cards appear yet.
 *      This path is now deterministic (not LLM-routing-dependent) and
 *      is therefore safe to pin in an e2e test.
 *
 *   B. Explicit keyword ("aller simple" / "aller-retour") →
 *      extract_node classifies trip_type in the regex guard before the
 *      LLM; ask_node is bypassed; search proceeds immediately.
 *
 * What changed vs. the retired one-way-disclaimer-flow.spec.ts:
 *   - The disclaimer phrases ("let me know if you'd like a return",
 *     "si tu veux un retour", "ajouter un retour", "went with one-way",
 *     etc.) are GONE — they must never appear.
 *   - Path A is now e2e-testable because the ask is deterministic.
 *
 * The explicit round-trip happy path (keyword "aller-retour") already
 * has full coverage in round-trip-flow.spec.ts; we do not duplicate the
 * full flow here — only the no-disclaimer negative assertion.
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
   * 2. Ambiguous prompt (no keyword, no return date) → bot asks the
   *    trip-type question; no option cards appear yet.
   *
   *    This path is deterministic as of backend commit 415aa07: the
   *    regex guard in ask_node fires on any prompt that lacks both a
   *    trip-type keyword and a return date, so the ask is guaranteed
   *    regardless of LLM output.
   *
   *    Marseille → Toulouse on a fixed date keeps the cities
   *    unambiguous (no disambiguate_node noise) and the date clear
   *    (no missing-date ask), isolating the trip-type ask cleanly.
   */
  test('ambiguous prompt (no keyword, no return date) → bot asks trip-type question, no option cards', async ({
    page,
  }) => {
    const { input } = await signupAndOnboard(page, { prefix: "ambiguous" });

    // No "aller simple" / "aller-retour" keyword. No return date.
    // ask_node must fire and ask the trip-type clarification question.
    await input.fill("Marseille Toulouse le 10 juin");
    await input.press("Enter");

    // Bot must ask the trip-type clarification question.
    // The ask_node question always contains "aller simple ou" and
    // "aller-retour" (or a close variant).
    await expect(
      page.getByText(/aller[\s-]?simple\s+ou[\s\S]*aller[\s-]?retour|aller[\s-]?retour\s+ou[\s\S]*aller[\s-]?simple/i).last(),
    ).toBeVisible({ timeout: 60_000 });

    // No option list must have been rendered yet — search hasn't run.
    await expect(page.getByTestId("option-list-header")).toHaveCount(0);
  });

  /**
   * 3. Negative: old disclaimer text must not appear on explicit
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
