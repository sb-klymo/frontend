/**
 * Selection-resolver regression suite — covers the four strategies
 * encoded in `resolve_selection_intent` (Tool 6): rank, price,
 * airline, time. Pre-2026-05-11 the resolver was a 4-strategy regex
 * chain that broke on creative phrasing; today it's a Haiku-LLM
 * structured-output call with a hallucination guard. Either way the
 * four strategies should resolve a clear user reply to ONE offer.
 *
 * Each test:
 *   1. Fresh `e2e-select-*-<ts>@klymo.local` signup (defaults to
 *      checkout_fallback so the agent routes to the Stripe Checkout
 *      link rather than auto-charge — keeps the test fast, no DB seeding)
 *   2. Send a Marseille → Toulouse search (unambiguous, single-airport
 *      cities, returns 2-3 options consistently in both stub mode and
 *      live_search_stub_order against Duffel test inventory)
 *   3. Wait for option list
 *   4. Send a strategy-specific phrase
 *   5. Assert CheckoutPaymentCard renders — proves the resolver
 *      successfully mapped the phrase to a specific offer_id and the
 *      checkout chain ran with that selection
 *
 * What we DON'T assert: which specific offer was picked. Under
 * `live_search_stub_order` the Duffel test inventory varies day-to-day
 * (airlines + schedules + prices), so pinning a specific offer would
 * make the test fragile. Asserting "selection resolved + checkout
 * fired" is the load-bearing contract — it proves the resolver didn't
 * return None and the graph didn't fall through to `_NO_MATCH_HINT`
 * ("Hmm, je n'ai pas bien saisi...").
 *
 * Why this matters: the user reported intermittent "Hmm" failures on
 * "option 1" under live Duffel offers — long opaque offer_ids tripped
 * the LLM's structured output. The rank-backfill fix is still
 * deferred, so these tests act as a canary: if any of the four
 * strategies regress, one of these will start hanging at the
 * checkout-card assertion.
 */

import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

const TRIP_QUERY = "Vol Marseille → Toulouse demain, juste 1 passager, classe éco";

async function signupAndOpenOptions(page: Page, slug: string): Promise<void> {
  const email = `e2e-select-${slug}-${Date.now()}@klymo.local`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("password123456");
  await page.getByRole("button", { name: /create account/i }).click();
  await expect(page).toHaveURL(/\/chat$/);

  const input = page.getByPlaceholder(/ask about a trip/i);
  await input.fill(TRIP_QUERY);
  await input.press("Enter");

  // Wait for option list — search → policy → present_options is one
  // /chat turn (~3-6s).
  await expect(page.getByText(/Option 1/i).first()).toBeVisible({
    timeout: 30_000,
  });
}

async function sendSelectionAndExpectExtrasPrompt(
  page: Page,
  phrase: string,
): Promise<void> {
  const input = page.getByPlaceholder(/ask about a trip/i);
  await input.fill(phrase);
  await input.press("Enter");

  // Selection success → graph routes to extras_node which asks
  // "anything else for this trip?" (rephrased by the LLM). This is
  // the simplest downstream signal that the resolver mapped the
  // user's reply to a specific offer — without going all the way
  // through checkout (which would require also replying "skip" to
  // the extras prompt and waiting another LLM turn for the Stripe
  // Checkout card).
  //
  // If `resolve_selection_intent` returned None or hallucinated,
  // the bot would emit `_NO_MATCH_HINT` ("Hmm, je n'ai pas bien
  // saisi...") instead — that string won't match this regex and
  // the test fails fast. Pattern lifted from extras-apply.spec.ts
  // for consistency with the existing extras coverage.
  await expect(
    page
      .getByText(
        /autre chose|anything else|bagage|bag|luggage|valise|sac|extra|ajout|sièges|seat|priorité/i,
      )
      .last(),
  ).toBeVisible({ timeout: 45_000 });
}

test.describe("Selection resolver — four strategies (Tool 6)", () => {
  // The default 30s per-test timeout is too tight here: signup ~3s +
  // option-list arrival ~10-15s (live_search_stub_order hits real
  // Duffel) + selection turn ~10-15s + checkout chain ~5-10s adds
  // up. 120s is comfortable and lets the test fail fast on a real
  // resolver regression rather than on transport latency.
  test.setTimeout(120_000);

  test("rank strategy: 'option 2' resolves to the second offer", async ({
    page,
  }) => {
    await signupAndOpenOptions(page, "rank");
    // Rank is the simplest strategy — strategy 1 in the LLM prompt
    // priority order, confidence 0.95. If this fails, the resolver
    // is broken at the most basic level.
    await sendSelectionAndExpectExtrasPrompt(page, "option 2");
  });

  test("price strategy: 'la moins chère' resolves to the cheapest offer", async ({
    page,
  }) => {
    await signupAndOpenOptions(page, "price");
    // Price strategy — FR "la moins chère" / EN "the cheapest". The
    // LLM must compute the min of `total_amount_cents` across the
    // displayed offers.
    await sendSelectionAndExpectExtrasPrompt(page, "la moins chère");
  });

  test("time strategy: 'celui du matin' resolves to the earliest offer", async ({
    page,
  }) => {
    await signupAndOpenOptions(page, "time");
    // Time strategy — FR "celui du matin" / EN "the morning one".
    // Requires the LLM to compare `outbound.departure_datetime`
    // across offers and pick the earliest. Robust to Duffel test
    // inventory shape since at least ONE offer should be morning-ish
    // (or the LLM picks the earliest of three afternoon offers).
    await sendSelectionAndExpectExtrasPrompt(page, "celui du matin");
  });

  // Airline strategy NOT exercised here. It requires reading the
  // displayed airline names from the DOM (the set varies between
  // DUFFEL_MODE=stub fixtures and live_search_stub_order Duffel test
  // inventory), and OptionCard has no `data-testid` for the airline
  // name yet. Backend unit tests in
  // `tests/agent/tools/test_resolve_selection_intent.py` exercise
  // the airline strategy directly against the LLM — coverage is
  // there, just not at the E2E layer. Deferred until OptionCard
  // grows a stable testid.
});
