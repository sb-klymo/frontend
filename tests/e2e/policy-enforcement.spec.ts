/**
 * Policy enforcement — pins the CURRENT behavior of the policy engine
 * vs the bot's downstream actions, plus documents the spec
 * expectation that's NOT YET WIRED.
 *
 * ## What we found in the 2026-05-21 audit
 *
 * The user's `Claude for Chrome` smoke surfaced two policy
 * observations:
 *
 * 1. `manager_approval_required` / `finance_approval_required` are
 *    rendered as warning badges on the OptionCard but the bot
 *    proceeds to book the flagged offer normally. No approval gate
 *    fires in `select_node` or `checkout_node`.
 * 2. `policy_blocked` offers are FILTERED OUT before display
 *    (see `present_options.py:107`). Users never see them.
 *
 * Per `PRODUCT_SPEC.md` (lines 231 + 329 + 399), the spec model is
 * `compliant | needs_approval | blocked` with an `approvalMode`
 * config, implying that `needs_approval` should pause/gate the
 * booking. The current implementation labels but doesn't gate —
 * a real product gap vs the spec.
 *
 * ## What these tests do
 *
 * - **`flagged offer is selectable + booking proceeds`** — pins the
 *   CURRENT (warn-only) behavior. Passes today; turns red if a future
 *   change silently breaks the current path (e.g. a regression where
 *   the bot refuses to book a flagged offer).
 *
 * - **`flagged offer should pause for approval` (`test.fixme`)** —
 *   documents the spec expectation. Skipped today; should be enabled
 *   when the approval gate lands in `select_node` or
 *   `checkout_node`. The assertion shape (waiting for an
 *   "approval-required" message instead of the extras prompt) is the
 *   contract the gate must meet.
 *
 * - **`block_expensive cap filters expensive offers out of the list`**
 *   — pins the FILTER behavior (by design per `present_options.py:107`).
 *   Currently runs against `live_search_stub_order` Duffel test
 *   inventory, so the option count is non-deterministic; the test
 *   asserts a less-stringent invariant (the chat doesn't crash, an
 *   option list still renders).
 *
 * ## Setup notes
 *
 * All tests sign up a fresh user (defaults to `checkout_fallback`
 * which is fine — checkout_node doesn't fire here; we stop at the
 * extras prompt downstream of select_node).
 *
 * Dev panel policy presets ship a `dev_policy_override` per chat
 * request (honored in dev mode for any user). Active preset is read
 * via the `dev-policy-preset-${id}` test ids in `DevPanel.tsx`.
 */

import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

// Marseille → Toulouse: short-haul, single-airport cities (no
// disambiguate). Under DUFFEL_MODE=stub returns 450/540/620 EUR.
// Under live_search_stub_order returns Duffel test inventory with
// variable prices — that's why we use the `manager_only` preset
// (300 EUR threshold), which catches almost anything > 300.
const TRIP_QUERY = "Vol Marseille → Toulouse demain, 1 passager, classe éco";

async function signupAndOpenChat(page: Page, slug: string): Promise<void> {
  const email = `e2e-policy-${slug}-${Date.now()}@klymo.local`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("password123456");
  await page.getByRole("button", { name: /create account/i }).click();
  await expect(page).toHaveURL(/\/chat$/);
}

async function activatePolicyPreset(
  page: Page,
  presetId: "mixed_verdict" | "block_expensive" | "manager_only" | "train_preferred" | "none",
): Promise<void> {
  // Dev panel `POLITIQUE` section is open by default (per
  // `DevPanel.tsx` comment: collapsed sections are persisted, the
  // empty default == all open). Click the preset button.
  const presetButton = page.getByTestId(`dev-policy-preset-${presetId}`);
  await expect(presetButton).toBeVisible({ timeout: 5_000 });
  await presetButton.click();
  // The active preset gets `data-active="true"` — wait for the flip
  // so subsequent chat requests carry the override.
  await expect(presetButton).toHaveAttribute("data-active", "true");
}

async function sendQuery(page: Page, query: string): Promise<void> {
  const input = page.getByPlaceholder(/ask about a trip/i);
  await input.fill(query);
  await input.press("Enter");
}

test.describe("Policy enforcement (current behavior pinned)", () => {
  // Search + policy + present_options takes one chat turn; selection
  // takes another. Each LLM call adds 3-10s. 120s is the comfortable
  // upper bound under `live_search_stub_order`.
  test.setTimeout(120_000);

  test("flagged offer is selectable and booking proceeds (warn-only)", async ({
    page,
  }) => {
    // `manager_only` preset: 300 EUR threshold. Any offer > 300 EUR
    // flags as `manager_approval_required`. Under DUFFEL_MODE=stub
    // (450/540/620 EUR) all three flag; under live_search_stub_order
    // most short-haul flights still exceed 300 EUR so at least one
    // option should carry the badge.
    await signupAndOpenChat(page, "warn-only");
    await activatePolicyPreset(page, "manager_only");
    await sendQuery(page, TRIP_QUERY);

    // Wait for option list.
    await expect(page.getByText(/Option 1/i).first()).toBeVisible({
      timeout: 60_000,
    });

    // At least one option carries an approval badge — the badge text
    // is "approbation manager requise" (FR) / "requires manager
    // approval" (EN), wired via `optionCard.badgeManagerApproval` in
    // `i18n.ts`. We use a permissive regex to handle either locale.
    await expect(
      page
        .getByText(/approbation manager|approbation finance|requires.*approval/i)
        .first(),
    ).toBeVisible({ timeout: 5_000 });

    // Pick option 1 — under `manager_only` it's flagged but should
    // still be selectable today (the spec says it should gate; the
    // current implementation lets it through).
    await sendQuery(page, "option 1");

    // CURRENT BEHAVIOR: booking proceeds through select → extras gate.
    // The extras prompt arrives as the next bot bubble. If a future
    // change adds an approval gate, this assertion will fail (and the
    // `test.fixme` below should be enabled in its place).
    await expect(
      page
        .getByText(
          /autre chose|anything else|bagage|bag|luggage|valise|sac|extra|ajout|sièges|seat|priorité/i,
        )
        .last(),
    ).toBeVisible({ timeout: 60_000 });
  });

  test.fixme(
    "SPEC: flagged offer SHOULD pause for approval (gate not yet wired)",
    async ({ page }) => {
      // Documents the desired behavior per PRODUCT_SPEC.md §6 +
      // approvalMode field. ENABLE THIS TEST (drop the .fixme) the
      // day `select_node` or `checkout_node` learns to gate on
      // `policy_status in ("manager_approval_required",
      // "finance_approval_required")` and emit an approval-required
      // message instead of routing to the extras gate.
      //
      // Expected bot output (rough sketch — actual wording TBD):
      //   "This flight requires manager approval before booking.
      //    I've routed the request — they'll get an email shortly."
      //
      // Or a HITL interrupt that waits for the manager's response.
      // The exact UX is a product decision; this test pins the
      // assertion that the bot does NOT proceed to the extras gate
      // when the picked offer carries an approval-required flag.
      await signupAndOpenChat(page, "spec-gate");
      await activatePolicyPreset(page, "manager_only");
      await sendQuery(page, TRIP_QUERY);
      await expect(page.getByText(/Option 1/i).first()).toBeVisible({
        timeout: 60_000,
      });
      await sendQuery(page, "option 1");

      // Desired: an approval-required bubble appears INSTEAD of the
      // extras prompt. Pattern guesses (refine when gate ships):
      await expect(
        page.getByText(/approval|approbation|manager.*notif|email.*sent/i),
      ).toBeVisible({ timeout: 30_000 });

      // And: the extras prompt should NOT appear in the same turn.
      await expect(
        page.getByText(
          /autre chose|anything else|bagage|bag|luggage|valise|sac/i,
        ),
      ).not.toBeVisible();
    },
  );

  test("block_expensive preset doesn't crash the chat", async ({ page }) => {
    // `block_expensive` preset = spend_cap 500 EUR. Offers above 500
    // EUR (post-FX conversion) are FILTERED OUT before display
    // (`present_options.py:107`). Under DUFFEL_MODE=stub the 540 +
    // 620 offers disappear, leaving only the 450; under
    // live_search_stub_order the visible count depends on Duffel
    // test inventory prices.
    //
    // We don't pin an exact option count because the live data
    // varies. The load-bearing assertion: even with a restrictive
    // preset, the chat still produces a usable response — either an
    // option list (at least one offer passed the filter) or a
    // graceful "no compliant options" message.
    await signupAndOpenChat(page, "block-expensive");
    await activatePolicyPreset(page, "block_expensive");
    await sendQuery(page, TRIP_QUERY);

    // Either an option list renders OR the bot emits the
    // "no compliant options found" template — both are valid
    // outcomes under a restrictive policy. The regex below covers
    // both branches.
    await expect(
      page
        .getByText(
          /Option 1|aucune option|no.*options|n'a pas trouvé|sorry|hmm/i,
        )
        .first(),
    ).toBeVisible({ timeout: 60_000 });
  });
});
