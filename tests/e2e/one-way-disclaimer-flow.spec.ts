/**
 * One-way default + disclaimer flow.
 *
 * Pins the 2026-05-22 product decision: when the user's prompt is
 * AMBIGUOUS on trip_type (single date, no return keyword), the backend
 * extract_node deterministically defaults to "one_way" and the
 * search_present_node prefixes the options card with a one-line
 * disclaimer giving the user a clear opt-in to switch to round-trip.
 *
 * The previously-existing "Quick one, is this a one-way trip or a round
 * trip?" question from ask_node was retired in the same change — the
 * bot must NOT block on that question anymore.
 *
 * Both assertions need to pass:
 *   1. The disclaimer phrase (or its FR phrase()-translated variant)
 *      appears in the assistant's options message.
 *   2. The retired explicit trip-type ask is absent — proves the new
 *      "default + disclaimer" routing is live, not the old "block on
 *      ask" routing.
 *
 * See backend/docs/superpowers/specs/2026-05-22-one-way-default-with-disclaimer-design.md.
 */

import { expect, test } from "@playwright/test";

import { signupAndOnboard } from "./_fixtures/userSetup";

test.describe("One-way default — disclaimer surfaces opt-in for return", () => {
  test.setTimeout(180_000);

  test("ambiguous trip prompt → options card with return-opt-in disclaimer", async ({
    page,
  }) => {
    const { input } = await signupAndOnboard(page, { prefix: "onewaydisc" });

    // Ambiguous: single date, no return keyword. The LLM may infer
    // one_way directly, or return null (in which case the post-step
    // coerces). Either way, trip_type_inferred ends up True and the
    // disclaimer fires.
    await input.fill("Vol Marseille → Toulouse demain, 1 passager");
    await input.press("Enter");

    // Wait for the options card.
    await expect(page.getByText(/Option 1/i).first()).toBeVisible({
      timeout: 60_000,
    });

    // Disclaimer present (EN source or any FR rephrasing by phrase()
    // mentioning "retour"/"return" in a return-opt-in context).
    await expect(
      page
        .getByText(
          /let me know if you'd like a return|si tu veux.*retour|ajouter.*retour|add.*return/i,
        )
        .first(),
    ).toBeVisible({ timeout: 60_000 });

    // The retired trip-type ask must NOT appear — proves we no longer
    // block on this question.
    await expect(
      page.getByText(/one-way trip or a round trip/i),
    ).toHaveCount(0);
    await expect(
      page.getByText(/aller simple ou.*aller-retour/i),
    ).toHaveCount(0);
  });

  test("explicit round-trip prompt → no disclaimer (user already chose)", async ({
    page,
  }) => {
    const { input } = await signupAndOnboard(page, { prefix: "rtnodisc" });

    // Explicit "aller-retour" + 2 dates → trip_type_inferred stays False.
    // The disclaimer phrase must NOT appear.
    await input.fill(
      "Vol aller-retour Marseille → Toulouse, départ demain et retour dans 3 jours, 1 passager",
    );
    await input.press("Enter");

    await expect(page.getByText(/Option 1/i).first()).toBeVisible({
      timeout: 60_000,
    });

    // The disclaimer source phrase (EN, before phrase() rewrites) must
    // be absent. The substring "went with one-way" is unique enough to
    // be a safe negative assertion — it would not appear in any other
    // template the bot might emit on a round-trip card.
    await expect(
      page.getByText(/went with one-way/i),
    ).toHaveCount(0);
  });
});
