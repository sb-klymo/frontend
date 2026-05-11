import { expect, test } from "@playwright/test";

/**
 * Plan B (M2-bis) — demo-critical end-to-end happy path.
 *
 * The 2026-05-18 demo runs on Plan B because Duffel hasn't approved
 * live SCP yet. This test exercises everything UP TO the Stripe
 * Checkout button: signup → chat → trip prompt → option list →
 * selection → CheckoutPaymentCard with a valid Stripe Checkout URL.
 *
 * Why we stop at the Pay-now button rather than clicking it:
 *   * Stripe Checkout is a third-party hosted page; navigating off-
 *     domain in CI is flaky and usually filtered.
 *   * The post-payment Realtime morph (status='paid' →
 *     duffel_order_id → BookingConfirmationCard hydration) is
 *     covered by `useChatStream.test.ts` unit tests with sequential
 *     postgres_changes payloads — the contract is pinned there.
 *   * The frontend → backend integration (signup, chat SSE, agent
 *     streaming, option presentation, mode 2/3 routing into
 *     `create_checkout_session_for_booking`) is the bit no other
 *     test layer covers, and is what this E2E protects.
 *
 * A fresh signup defaults to `payment_mode='checkout_fallback'`
 * (no card on file → Plan B routing automatically).
 */
test("Plan B happy path: chat → option pick → CheckoutPaymentCard with Stripe URL", async ({
  page,
}) => {
  // 1. Fresh user — defaults to checkout_fallback so the agent routes
  // to the Stripe Checkout link path rather than auto-charge.
  const email = `e2e-planb-${Date.now()}@klymo.local`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("password123456");
  await page.getByRole("button", { name: /create account/i }).click();
  await expect(page).toHaveURL(/\/chat$/);

  // 2. Send an unambiguous trip request — Marseille and Toulouse are
  // single-airport cities so the agent doesn't need to disambiguate
  // (avoids the "Paris a trois aéroports" branch which would force
  // an extra clarifying turn before reaching the option list).
  const input = page.getByPlaceholder(/ask about a trip/i);
  await input.fill(
    "Vol Marseille → Toulouse demain, juste 1 passager, classe éco",
  );
  await input.press("Enter");

  // 3. Option list arrives. Stub Duffel returns 3 deterministic
  // options — the assistant text is "Here are 3 options for your
  // trip:" (en) or its FR counterpart. Either heading is fine; we
  // wait for the option-card-rendered marker which the OptionList
  // emits inside ChatWindow.
  //
  // The agent runs extract → policy → search → present_options
  // synchronously within one /chat turn (~3-6s including LLM calls)
  // so 30s is a comfortable upper bound.
  await expect(page.getByText(/Option 1/i).first()).toBeVisible({
    timeout: 30_000,
  });

  // 4. User picks the first option — a chat message is the lowest-
  // friction interaction the agent reliably understands. Quick-reply
  // chips in the dev panel could also trigger this but staying on
  // the production-realistic path keeps the test faithful.
  await input.fill("option 1");
  await input.press("Enter");

  // 5. CheckoutPaymentCard renders. The post-Checkout chain
  // (M2-bis virtual card mint + Duffel order + Realtime morph) is
  // out of scope for this E2E — see header docstring.
  const checkoutCard = page.getByTestId("checkout-payment-card");
  await expect(checkoutCard).toBeVisible({ timeout: 30_000 });

  // 6. The Pay-now link points at a real Stripe Checkout session
  // URL. Pre-fix bugs left this empty/broken in dev; pinning the
  // host catches a regression where the backend wires a stub or the
  // frontend strips the URL.
  const payLink = page.getByTestId("checkout-pay-link");
  await expect(payLink).toBeVisible();
  const href = await payLink.getAttribute("href");
  expect(href).toMatch(/^https:\/\/checkout\.stripe\.com\//);

  // 7. The amount line was populated by the agent with the picked
  // offer's total. Just assert non-empty rather than pinning a
  // specific currency — stub fixtures may shift across sessions.
  await expect(checkoutCard.getByTestId("checkout-amount")).not.toHaveText("");
});

test("option-list header is rephrased contextually (no static i18n)", async ({
  page,
}) => {
  /*
   * Pre-2026-05-11, the OptionList header was a hardcoded i18n string —
   * every user on every search saw "Voici 3 options pour votre voyage :".
   * The humanization PR (`phase-3/option-list-llm-header`) routes the
   * header through phrase() so it varies with the user's request.
   *
   * This test gates the regression that would happen if the SSE
   * `event: options` payload stops carrying `header` / `footer`, OR if
   * useChatStream stops threading them through to OptionList, OR if
   * ChatWindow stops passing them down. The header would silently
   * collapse back to the static i18n string.
   *
   * We assert: after the option list renders, the header element does
   * NOT contain the static i18n string verbatim. Real production
   * output is a contextual rephrase like "MRS → TLS demain en éco,
   * voici 3 vols :".
   */
  const email = `e2e-humanize-${Date.now()}@klymo.local`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("password123456");
  await page.getByRole("button", { name: /create account/i }).click();
  await expect(page).toHaveURL(/\/chat$/);

  const input = page.getByPlaceholder(/ask about a trip/i);
  await input.fill("Vol Marseille → Toulouse demain en éco");
  await input.press("Enter");

  // Wait for the option list to render.
  const header = page.getByTestId("option-list-header");
  await expect(header).toBeVisible({ timeout: 30_000 });

  const headerText = (await header.textContent()) ?? "";
  // Static i18n fallback strings — these are what the chat would
  // show if the SSE `header` payload disappeared. Production should
  // NEVER show these exact strings when ANTHROPIC_API_KEY is set.
  const STATIC_FR = "Voici 3 options pour votre voyage :";
  const STATIC_EN = "Here are 3 options for your trip:";
  expect(headerText).not.toBe(STATIC_FR);
  expect(headerText).not.toBe(STATIC_EN);
  // Sanity: a real rephrase still mentions some destination context.
  // The agent has seen "Marseille → Toulouse" in the user message so
  // a meaningful header references the trip somehow. We assert the
  // length is non-trivial as a coarse signal; we don't pin the exact
  // text since the LLM varies it per call.
  expect(headerText.trim().length).toBeGreaterThan(5);
});
