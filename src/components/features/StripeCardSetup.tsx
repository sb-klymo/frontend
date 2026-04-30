"use client";

/**
 * `StripeCardSetup` — Stripe Elements iframe for the SetupIntent flow.
 *
 * The iframe collects the card details directly into Stripe's PCI-scoped
 * vault — they never touch our server (SAQ-A). On submit we call
 * `confirmCardSetup`, which produces a PaymentMethod tied to the user's
 * Stripe Customer; the `setup_intent.succeeded` webhook on the backend
 * then persists `stripe_payment_method_id` in our DB.
 *
 * Both the `clientSecret` (per-SetupIntent) and `publishableKey` come
 * from the backend's `POST /payment/setup-intent` response. Carrying the
 * publishable key in the API response (rather than `NEXT_PUBLIC_*`) lets
 * the backend swap test/live without a frontend rebuild.
 */

import { useMemo, useState } from "react";
import {
  CardElement,
  Elements,
  useElements,
  useStripe,
} from "@stripe/react-stripe-js";
import { loadStripe, type Stripe } from "@stripe/stripe-js";

type Props = {
  clientSecret: string;
  publishableKey: string;
  onSuccess: () => void;
  /** Optional override hook for tests — `null` skips the real Stripe.js load. */
  stripePromise?: Promise<Stripe | null> | null;
};

export function StripeCardSetup({
  clientSecret,
  publishableKey,
  onSuccess,
  stripePromise,
}: Props) {
  // Memoise the Stripe.js loader on the publishable key so re-renders
  // don't keep re-fetching the script. Tests can pass `null` to bypass.
  const promise = useMemo(
    () => stripePromise ?? loadStripe(publishableKey),
    [publishableKey, stripePromise],
  );

  return (
    <Elements stripe={promise} options={{ clientSecret }}>
      <CardForm clientSecret={clientSecret} onSuccess={onSuccess} />
    </Elements>
  );
}

function CardForm({
  clientSecret,
  onSuccess,
}: {
  clientSecret: string;
  onSuccess: () => void;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!stripe || !elements) return;

    const card = elements.getElement(CardElement);
    if (!card) return;

    setSubmitting(true);
    setError(null);

    const { error: stripeError } = await stripe.confirmCardSetup(clientSecret, {
      payment_method: { card },
    });

    if (stripeError) {
      // Stripe's messages are user-friendly enough to surface verbatim.
      setError(stripeError.message ?? "Card setup failed.");
      setSubmitting(false);
      return;
    }

    // Note: the backend won't have the PaymentMethod persisted yet —
    // that lands when the `setup_intent.succeeded` webhook fires. The
    // caller decides how to handle that race (wait, redirect, etc.).
    onSuccess();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="rounded-md border border-gray-300 bg-white px-3 py-3 focus-within:border-blue-500">
        <CardElement
          options={{
            hidePostalCode: false,
            style: {
              base: {
                fontSize: "16px",
                color: "#111827",
                fontFamily:
                  'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
                "::placeholder": { color: "#9ca3af" },
              },
              invalid: { color: "#dc2626" },
            },
          }}
        />
      </div>

      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={!stripe || submitting}
        className="w-full rounded-md bg-blue-600 px-4 py-2 font-medium text-white hover:bg-blue-700 disabled:opacity-50"
      >
        {submitting ? "Saving…" : "Save card"}
      </button>
    </form>
  );
}
