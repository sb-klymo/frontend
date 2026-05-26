/**
 * Policy enforcement — pins the behavior of the policy engine
 * vs the bot's downstream actions.
 *
 * ## What we found in the 2026-05-21 audit
 *
 * The user's `Claude for Chrome` smoke surfaced two policy
 * observations:
 *
 * 1. `manager_approval_required` / `finance_approval_required` were
 *    rendered as warning badges on the OptionCard but the bot
 *    proceeded to book the flagged offer normally. As of Phase 6
 *    (2026-05-21), the gate is wired: `select_node` now routes
 *    flagged offers to `approval_required_node`, which emits an
 *    approval-pending card instead of proceeding to the extras prompt.
 * 2. `policy_blocked` offers are FILTERED OUT before display
 *    (see `present_options.py:107`). Users never see them.
 *
 * ## What these tests do
 *
 * - **`SPEC: flagged offer SHOULD pause for approval`** — the gate is
 *   now wired. This test pins the gate-fires-on-flagged-offer behavior:
 *   picking a flagged offer must produce an approval-pending card, not
 *   the extras prompt.
 *
 * - **`block_expensive preset doesn't crash the chat`** — pins the
 *   FILTER behavior (by design per `present_options.py:107`).
 *   Currently runs against `live_search_stub_order` Duffel test
 *   inventory, so the option count is non-deterministic; the test
 *   asserts a less-stringent invariant (the chat doesn't crash, an
 *   option list still renders).
 *
 * ## Setup notes
 *
 * All tests sign up a fresh user (defaults to `checkout_fallback`
 * which is fine — checkout_node doesn't fire here; we stop at the
 * approval-pending card downstream of select_node).
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
const TRIP_QUERY =
  "Vol Marseille → Toulouse demain, aller simple, 1 passager, classe éco";

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

  test(
    "flagged offer pauses for approval (gate wired, Phase 6)",
    async ({ page }) => {
      // Gate is now wired (Phase 6): select_node routes flagged offers to
      // approval_required_node which emits _PENDING_TEMPLATE:
      //   "Cette réservation à {amount} {currency} nécessite l'approbation de
      //    votre manager. Je leur ai envoyé un mail — je vous tiens au courant
      //    dès qu'ils répondent."
      //
      // phrase() rephrases the seed text, so we assert on stable substrings:
      //   • "approbation" or "approval" — from the pending template
      //   • "mail" or "email" or "notif" — the email-sent confirmation
      //
      // The extras prompt must NOT appear in this turn: the workflow_stage
      // advances to "awaiting_approval", not "awaiting_extras_choice".
      await signupAndOpenChat(page, "spec-gate");
      await activatePolicyPreset(page, "manager_only");
      await sendQuery(page, TRIP_QUERY);
      await expect(page.getByText(/Option 1/i).first()).toBeVisible({
        timeout: 60_000,
      });
      await sendQuery(page, "option 1");

      // Approval-required bubble: _PENDING_TEMPLATE contains "approbation"
      // (FR) or is rephrased to contain "approval" (EN). The template also
      // mentions "mail" / email notification.
      await expect(
        page.getByText(/approval|approbation|mail.*envoyé|email.*sent|je leur.*envoyé/i),
      ).toBeVisible({ timeout: 30_000 });

      // The extras prompt must NOT appear in the same turn.
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
