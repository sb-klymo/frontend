"use client";

/**
 * Client wrapper for the onboarding card-save flow.
 *
 * Sequence on mount:
 *   1. Fetch a fresh SetupIntent via `/api/payment/setup-intent` (BFF).
 *   2. Mount `<StripeCardSetup>` with the returned client_secret +
 *      publishable_key from the API response (not from
 *      `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, so test/live can switch
 *      server-side).
 *   3. On Stripe success: persist the auto-charge toggle to Supabase
 *      `user_metadata` and render an inline success state telling the
 *      user to close this tab and return to the original chat tab.
 *
 * The original chat tab (opened separately by the OnboardingCard's
 * `target="_blank"` link) keeps its SSE stream alive — a companion
 * frontend change subscribes to Supabase Realtime on the user's
 * payment-method update so the chat auto-advances out of
 * `onboarding_payment_redirect` without the user typing.
 *
 * The previous `router.push("/chat")` behavior is replaced because:
 *   - The chat tab is still open elsewhere; navigating here would
 *     create a second chat tab and confuse the user about which one
 *     holds their conversation.
 *   - Closing this tab is the natural "I'm done with card setup"
 *     gesture; reinforce it instead of fighting it.
 *
 * The SetupIntent fetch itself is wrapped in TanStack Query so retry,
 * loading, and error semantics get standard treatment. Toggling
 * `auto_charge_enabled` doesn't refetch (it's purely client state until
 * the redirect commits it).
 */

import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";

import { PaymentModeToggle } from "@/components/features/PaymentModeToggle";
import { StripeCardSetup } from "@/components/features/StripeCardSetup";
import { strings, type SupportedLanguage } from "@/lib/i18n";
import {
  createSetupIntent,
  PaymentApiError,
  setPaymentPreference,
} from "@/lib/api/payment";

type Props = {
  initialAutoCharge: boolean;
  /**
   * Resolved at module load via `navigator.language`. Defaults to
   * "en" until hydration. Tests pass a fixed value to skip
   * `navigator` polyfilling.
   */
  language?: SupportedLanguage;
};

/**
 * Detect the user's browser language. Returns "fr" if the primary
 * language tag starts with "fr-"/"fr" (case-insensitive), else "en".
 * Runs on the client only; SSR returns "en" (the page is a Server
 * Component but THIS component is "use client", so this is fine).
 */
function detectBrowserLanguage(): SupportedLanguage {
  if (typeof navigator === "undefined") return "en";
  const primary = navigator.language?.split("-")[0]?.toLowerCase();
  return primary === "fr" ? "fr" : "en";
}

export function PaymentMethodForm({
  initialAutoCharge,
  language,
}: Props) {
  const lang = language ?? detectBrowserLanguage();
  const t = strings(lang).cardSetupSuccess;
  const [autoCharge, setAutoCharge] = useState(initialAutoCharge);
  // Drives the post-save inline success state. Replaces the previous
  // `router.push("/chat")` redirect — the chat lives in another tab.
  const [setupComplete, setSetupComplete] = useState(false);

  const setupIntentQuery = useQuery({
    queryKey: ["payment", "setup-intent"],
    queryFn: createSetupIntent,
    // SetupIntents are short-lived; don't background-refresh.
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    retry: (failureCount, error) => {
      // No point retrying a 401 — user needs to log in again.
      if (error instanceof PaymentApiError && error.status === 401) {
        return false;
      }
      return failureCount < 1;
    },
  });

  const persistPreference = useMutation({
    mutationFn: (next: boolean) => setPaymentPreference(next),
  });

  async function handleStripeSuccess() {
    try {
      await persistPreference.mutateAsync(autoCharge);
    } catch {
      // Persistence is best-effort — the card is already saved on
      // Stripe's side. We still show success; the user can adjust
      // the preference later from settings.
    }
    // Flip the inline success state. The user's chat tab (opened
    // earlier from the OnboardingCard CTA) listens for the
    // `setup_intent.succeeded` webhook signal via Supabase Realtime
    // and advances on its own; this tab just tells the user to
    // close it and head back.
    setSetupComplete(true);
  }

  // Success state takes precedence over loading/error — once the user
  // saved their card, the SetupIntent query is stale (no longer
  // needed) and any flicker back to "Preparing form…" would be
  // confusing. Pin the success view until the user navigates away.
  if (setupComplete) {
    return (
      <div
        role="status"
        data-testid="card-setup-success"
        className="space-y-3 rounded-lg border border-green-200 bg-green-50 p-5 text-center"
      >
        <div className="flex items-center justify-center gap-2 text-green-800">
          <span aria-hidden="true" className="text-lg">
            ✓
          </span>
          <h2 className="text-base font-semibold">{t.title}</h2>
        </div>
        <p className="text-sm text-green-900">{t.subtitle}</p>
        <p className="text-xs text-green-700">{t.closeTabHint}</p>
        {/*
          Fallback for users who reached this page directly without a
          chat tab open (e.g. landed via a stale bookmark). Plain `<a>`
          with no `target` so it navigates this tab — the only sensible
          destination when there isn't another tab to switch back to.
        */}
        <a
          href="/chat"
          className="inline-block text-xs font-medium text-green-700 underline hover:text-green-900"
          data-testid="card-setup-success-chat-fallback"
        >
          {t.fallbackLinkLabel}
        </a>
      </div>
    );
  }

  if (setupIntentQuery.isPending) {
    return (
      <p className="text-center text-sm text-gray-500">Preparing secure form…</p>
    );
  }

  if (setupIntentQuery.isError) {
    const message =
      setupIntentQuery.error instanceof PaymentApiError &&
      setupIntentQuery.error.status === 401
        ? "Your session expired. Please sign in again."
        : "We couldn't start the secure card form. Try again in a moment.";
    return (
      <div className="space-y-3">
        <p role="alert" className="text-sm text-red-600">
          {message}
        </p>
        <button
          type="button"
          onClick={() => setupIntentQuery.refetch()}
          className="w-full rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          Retry
        </button>
      </div>
    );
  }

  const { client_secret, publishable_key } = setupIntentQuery.data;

  return (
    <div className="space-y-6">
      <PaymentModeToggle value={autoCharge} onChange={setAutoCharge} />
      <StripeCardSetup
        clientSecret={client_secret}
        publishableKey={publishable_key}
        onSuccess={handleStripeSuccess}
      />
    </div>
  );
}
