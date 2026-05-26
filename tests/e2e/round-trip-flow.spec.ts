/**
 * Round-trip flow — bundle model (Phase 11).
 *
 * Phase-11 product change (backend commit 71ec78b): the old two-stage
 * selection model (pick outbound → second list for return) has been
 * retired. A round-trip search now surfaces option cards where EACH
 * card already bundles BOTH legs (outbound + return). Picking "option 1"
 * resolves the entire booking in a single step and advances directly to
 * the extras prompt — there is no intermediate `awaiting_return_selection`
 * stage and no second option list.
 *
 * What this test pins:
 *   1. Option cards arrive after the round-trip search prompt.
 *   2. Each bundle card shows BOTH the outbound ("Aller") and the return
 *      ("Retour") leg — rendered by OptionCard when `return_leg` is
 *      populated.
 *   3. After the user picks "option 1", the bot advances to the EXTRAS
 *      prompt (bags / seats vocabulary), NOT a second option list.
 *      Specifically: `option-list-header` count stays at 1 — only one
 *      option list was ever rendered.
 *   4. After declining extras ("non"), the booking confirmation card
 *      shows EXACTLY 2 legs (`booking-leg-row` count = 2) — one outbound
 *      and one return.
 *
 * Why we don't drive through checkout: same rationale as
 * select-strategies.spec.ts — extras → checkout is already covered by
 * extras-apply.spec.ts and plan-b-checkout.spec.ts. The goal here is to
 * pin that the bundle model routing produces the right number of option
 * lists and the right number of booking legs.
 *
 * Stale-backend caveat: the local :8000 backend on `main` still uses the
 * old two-stage model. Running this spec locally against the un-merged
 * backend will fail. The spec is written for post-deploy (branch
 * `phase-11/round-trip-polish`, backend commit 71ec78b).
 */

import { expect, test } from "@playwright/test";

import { signupAndOnboard } from "./_fixtures/userSetup";

test.describe("Round-trip flow — bundle model (single-pick, both legs)", () => {
  test.setTimeout(180_000);

  test("round-trip pick resolves in one step → extras prompt, no second option list, booking has 2 legs", async ({
    page,
  }) => {
    const { input } = await signupAndOnboard(page, { prefix: "rtbundle" });

    // Round-trip prompt: explicit return date triggers the round-trip
    // search branch. Marseille ↔ Toulouse keeps the cities unambiguous
    // so we don't tangle with disambiguate_node.
    await input.fill(
      "Vol aller-retour Marseille → Toulouse, départ demain et retour dans 3 jours, 1 passager",
    );
    await input.press("Enter");

    // --- 1. Option cards arrive ---
    // The option-list-header is rendered once by OptionList. Wait for it
    // before making count assertions.
    await expect(
      page.getByTestId("option-list-header").first(),
    ).toBeVisible({ timeout: 60_000 });

    // Exactly one option list has been rendered so far (the bundle list).
    await expect(page.getByTestId("option-list-header")).toHaveCount(1);

    // --- 2. Bundle cards show both legs ---
    // OptionCard renders an "Aller · <date>" label row when return_leg is
    // present (i18n key `legLabelOutbound` = "Aller" in FR) and a
    // "Retour · <date>" row for the return slice. Assert at least the
    // outbound label is visible on the first card.
    await expect(
      page.getByText(/^Aller\b/i).first(),
    ).toBeVisible();

    // Assert the return label is also visible (proves both legs rendered).
    await expect(
      page.getByText(/^Retour\b/i).first(),
    ).toBeVisible();

    // --- 3. Pick option 1 → extras prompt, NOT a second option list ---
    await input.fill("option 1");
    await input.press("Enter");

    // The extras prompt must arrive. Match the standard vocabulary used
    // across extras-apply.spec.ts.
    await expect(
      page
        .getByText(
          /bagage|bag|luggage|valise|sac|extra|ajout|sièges|seat|priorité|autre chose|anything else/i,
        )
        .last(),
    ).toBeVisible({ timeout: 60_000 });

    // The option-list-header count must STILL be 1 — no second option list
    // was emitted for a "return selection" stage.
    await expect(page.getByTestId("option-list-header")).toHaveCount(1);

    // --- 4. Decline extras → booking confirmation with 2 legs ---
    await input.fill("non");
    await input.press("Enter");

    // Wait for the booking confirmation card.
    await expect(
      page.getByTestId("booking-confirmation-card"),
    ).toBeVisible({ timeout: 60_000 });

    // A round-trip booking has exactly 2 legs (outbound + return).
    await expect(page.getByTestId("booking-leg-row")).toHaveCount(2);
  });
});
