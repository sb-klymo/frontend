/**
 * Phase 10 R1 + R2 — OptionCard duration + stops + layover rendering.
 *
 * Pins the user-visible output of the Phase 10 work: every option card
 * surfaces flight duration ("8h 21min") + a stops badge ("Direct" /
 * "1 escale" + intermediate airport) end-to-end. The frontend unit
 * tests cover the rendering matrix; this E2E pins the SSE-to-render
 * contract so a future backend serialisation change can't silently
 * drop the new fields.
 *
 * Stub Duffel (DUFFEL_MODE=stub) returns 3 deterministic Marseille→
 * Toulouse offers, all direct (single-segment). The 2-stops/layover
 * variants are covered by frontend Vitest using synthetic fixtures —
 * the stub doesn't ship multi-segment offers in the live-search path
 * by default.
 *
 * Selector scoping: the dev panel sidebar has buttons labelled
 * "option 1" / "option 2" / "option 3" (the "Choix d'option" quick-
 * reply chips) which match a naive `getByText(/Option 1/i)` BEFORE
 * the real chat option list has rendered. The tests below scope via
 * `data-testid="option-list-header"` (only emitted by the actual
 * chat OptionList component) to avoid that false-positive.
 *
 * See:
 *   docs/superpowers/specs/2026-05-22-flight-duration-stops-design.md
 *   tests/unit/OptionCard.test.tsx (Vitest rendering matrix)
 */

import { expect, test } from "@playwright/test";

import { signupAndOnboard } from "./_fixtures/userSetup";

test.describe("Phase 10 R1+R2 — OptionCard duration + stops badge", () => {
  test.setTimeout(180_000);

  test("direct stub offer renders duration line + 'Direct' label", async ({
    page,
  }) => {
    const { input } = await signupAndOnboard(page, { prefix: "p10-direct" });

    await input.fill(
      "Vol Marseille → Toulouse demain, aller simple, 1 passager, classe éco",
    );
    await input.press("Enter");

    // Wait for the chat option list (NOT the sidebar dev-panel buttons).
    // `option-list-header` is only emitted by the chat OptionList component.
    await expect(page.getByTestId("option-list-header")).toBeVisible({
      timeout: 90_000,
    });

    // Each option card must show its info row (duration · stops · layover).
    // The slice-info-row testid is unique to the chat-side OptionCard.
    const sliceRows = page.getByTestId("slice-info-row");
    await expect(sliceRows.first()).toBeVisible({ timeout: 5_000 });
    expect(await sliceRows.count()).toBeGreaterThanOrEqual(3);

    // Duration in "Xh Ymin" format somewhere inside the slice-info-rows.
    // The stub fixtures are Marseille → Toulouse direct (~2h 15min).
    await expect(sliceRows.first()).toContainText(/\d+h\s*\d+min/);

    // Direct flag — every stub fixture is single-segment so every
    // card shows "Direct" in green.
    await expect(sliceRows.first()).toContainText(/Direct/i);
  });

  test("option card does NOT regress to pre-Phase-10 layout (no info row)", async ({
    page,
  }) => {
    /*
     * Regression guard. Pre-Phase-10 cards had NO duration line and NO
     * stops indicator — just airline + time + airports. If a future
     * change silently drops the new info row, this assertion catches
     * it: at least one `data-testid="slice-info-row"` element must
     * exist for every offer in the list.
     */
    const { input } = await signupAndOnboard(page, { prefix: "p10-noregress" });

    await input.fill("Vol Marseille → Toulouse demain, aller simple, 1 passager");
    await input.press("Enter");

    await expect(page.getByTestId("option-list-header")).toBeVisible({
      timeout: 90_000,
    });

    // Stub returns 3 offers — at least 3 slice-info-rows expected.
    const sliceRows = page.getByTestId("slice-info-row");
    await expect(sliceRows).toHaveCount(3, { timeout: 5_000 });

    // The Phase 10 info row uses the · separator between duration and
    // stops. Match either "Direct" or "N escale[s]" after the duration.
    for (let i = 0; i < 3; i++) {
      await expect(sliceRows.nth(i)).toContainText(
        /\d+h\s*\d+min\s*·\s*(Direct|\d+\s+escale)/i,
      );
    }
  });
});
