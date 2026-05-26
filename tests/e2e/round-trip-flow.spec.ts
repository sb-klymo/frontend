/**
 * Round-trip flow — bundle model (Phase 11).
 *
 * Phase-11 product change (backend PR #105): the old two-stage selection
 * model (pick outbound → second list for return) has been retired. A
 * round-trip search now surfaces option cards where EACH card already
 * bundles BOTH legs (outbound + return). Picking "option 1" resolves the
 * entire selection in a single step and advances directly to the extras
 * prompt — there is no intermediate `awaiting_return_selection` stage and
 * no second option list.
 *
 * What this test pins:
 *   1. Option cards arrive after the round-trip search prompt, and exactly
 *      ONE option list is ever rendered (no second "pick your return" list).
 *   2. Each bundle card shows BOTH the outbound ("Aller") and the return
 *      ("Retour") leg — rendered by OptionCard when `return_leg` is
 *      populated. This is the "two legs" coverage: both slices are on the
 *      single card the user picks.
 *   3. After the user picks "option 1", the bot advances straight to the
 *      EXTRAS prompt (bags / seats vocabulary), NOT a second option list —
 *      `option-list-header` count stays at 1.
 *   4. After declining extras, the single pick resolves to the payment
 *      step (CheckoutPaymentCard) — proving the whole round trip booked
 *      from one selection.
 *
 * Why we stop at the CheckoutPaymentCard rather than a completed
 * BookingConfirmationCard: completing an auto-charge booking requires a
 * real Stripe test PaymentMethod, which this local env does not have (the
 * backend talks to real Stripe test mode). A checkout_fallback user only
 * needs Stripe to MINT a Checkout-session URL — which works deterministically
 * (same path as plan-b-checkout.spec.ts). The bundle model is fully pinned
 * by the single-option-list + both-legs-on-card + single-pick→payment
 * assertions above.
 *
 * Requires the bundle-model backend (merged to main 2026-05-26, PR #105).
 */

import { expect, test } from "@playwright/test";

import { signupAndOnboard } from "./_fixtures/userSetup";

test.describe("Round-trip flow — bundle model (single-pick, both legs)", () => {
  test.setTimeout(180_000);

  test("round-trip pick resolves in one step → extras prompt, no second option list, single pick → payment", async ({
    page,
  }) => {
    // checkout_fallback (no saved card) → declining extras routes to the
    // Stripe Checkout link path, which only needs Stripe to mint a session
    // URL (no real saved PaymentMethod required). See userSetup.ts.
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
    // "Retour · <date>" row for the return slice. Both labels visible
    // proves the single card bundles both legs.
    await expect(page.getByText(/^Aller\b/i).first()).toBeVisible();
    await expect(page.getByText(/^Retour\b/i).first()).toBeVisible();

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
    // was emitted for a "return selection" stage. This is the core
    // bundle-model assertion.
    await expect(page.getByTestId("option-list-header")).toHaveCount(1);

    // --- 4. Decline extras → single pick resolves to the payment step ---
    await input.fill("non");
    await input.press("Enter");

    // The whole round trip resolved from one selection → CheckoutPaymentCard.
    await expect(
      page.getByTestId("checkout-payment-card"),
    ).toBeVisible({ timeout: 60_000 });
  });
});
