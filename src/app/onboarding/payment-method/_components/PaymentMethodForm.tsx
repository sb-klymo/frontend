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
 *      `user_metadata` (the backend reads it from the JWT on next
 *      request) and redirect to `/chat`.
 *
 * The SetupIntent fetch itself is wrapped in TanStack Query so retry,
 * loading, and error semantics get standard treatment. Toggling
 * `auto_charge_enabled` doesn't refetch (it's purely client state until
 * the redirect commits it).
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "@tanstack/react-query";

import { PaymentModeToggle } from "@/components/features/PaymentModeToggle";
import { StripeCardSetup } from "@/components/features/StripeCardSetup";
import { createSetupIntent, PaymentApiError } from "@/lib/api/payment";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

type Props = {
  initialAutoCharge: boolean;
};

export function PaymentMethodForm({ initialAutoCharge }: Props) {
  const router = useRouter();
  const [autoCharge, setAutoCharge] = useState(initialAutoCharge);

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
    mutationFn: async (next: boolean) => {
      const supabase = createSupabaseBrowserClient();
      const { error } = await supabase.auth.updateUser({
        data: { auto_charge_enabled: next },
      });
      if (error) throw error;
    },
  });

  async function handleStripeSuccess() {
    try {
      await persistPreference.mutateAsync(autoCharge);
    } catch {
      // Persistence is best-effort — the card is already saved on Stripe's
      // side. We still proceed to chat; the user can adjust the preference
      // later from settings.
    }
    router.push("/chat");
    router.refresh();
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
