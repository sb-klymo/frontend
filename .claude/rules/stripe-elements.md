# Stripe Elements — Card Setup and Payment UI

Klymo collects card details via Stripe Elements (iframe hosted by Stripe) — card data **never** touches our server. This keeps us at PCI SAQ-A.

## When to use Stripe Elements

- **Onboarding**: user/admin saves a card via SetupIntent → stored as PaymentMethod on Stripe's vault.
- **Future**: in-chat card save without a full onboarding flow (Phase 2).

**Never** write a plain `<input>` for a card number. Always use `<CardElement>` or `<PaymentElement>`.

## Card setup flow (SetupIntent)

```tsx
// src/app/(app)/onboarding/_components/StripeCardSetup.tsx
"use client";

import { useState } from "react";
import { loadStripe } from "@stripe/stripe-js";
import {
  Elements,
  CardElement,
  useStripe,
  useElements,
} from "@stripe/react-stripe-js";

const stripePromise = loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!);

function CardForm({ clientSecret, onSuccess }: { clientSecret: string; onSuccess: () => void }) {
  const stripe = useStripe();
  const elements = useElements();
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!stripe || !elements) return;

    setSubmitting(true);
    setError(null);

    const card = elements.getElement(CardElement);
    if (!card) return;

    const { error: stripeError } = await stripe.confirmCardSetup(clientSecret, {
      payment_method: { card },
    });

    if (stripeError) {
      setError(stripeError.message ?? "Card setup failed");
      setSubmitting(false);
      return;
    }

    onSuccess();
  };

  return (
    <form onSubmit={onSubmit}>
      <CardElement options={{ hidePostalCode: false }} />
      {error && <p className="text-red-600">{error}</p>}
      <button type="submit" disabled={!stripe || submitting}>
        {submitting ? "Saving..." : "Save card"}
      </button>
    </form>
  );
}

export function StripeCardSetup({ clientSecret, onSuccess }: { clientSecret: string; onSuccess: () => void }) {
  return (
    <Elements stripe={stripePromise} options={{ clientSecret }}>
      <CardForm clientSecret={clientSecret} onSuccess={onSuccess} />
    </Elements>
  );
}
```

## How to get `clientSecret`

1. Frontend calls backend: `POST /payment/setup-intent` (authenticated). In Klymo, the browser hits the Next.js BFF route `POST /api/payment/setup-intent`, which forwards the request server-side with the Supabase JWT — same pattern as `/api/chat`.
2. Backend creates `SetupIntent` with `usage: "off_session"` and returns `{ client_secret, publishable_key, setup_intent_id }`
3. Frontend passes `client_secret` to `<Elements options={{ clientSecret }}>`
4. User submits → Stripe iframe validates + creates the PaymentMethod
5. On success, backend is notified via `setup_intent.succeeded` webhook

Never skip step 3 — passing `clientSecret` in `Elements` is what routes the event to the correct SetupIntent.

## PCI rules

- Card number inputs are ALWAYS the `<CardElement>` — never plain `<input>`
- Never log or store card number fragments in the frontend (except last 4, returned by Stripe)
- Never post card data to our backend — only the PaymentMethod ID (`pm_xxx`)
- `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` is the only Stripe key in the frontend — use `pk_test_` in dev

## Error handling

- Card declined → show the Stripe error message verbatim (already user-friendly)
- Network error → retry button, not auto-retry
- 3DS challenge → Stripe handles the modal; our code just awaits `confirmCardSetup`

## What NOT to do

- Never write custom card UI (`<input>` for number, expiry, CVC) — PCI violation
- Never log or send raw card data
- Never hardcode Stripe keys in source — always `process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`
- Never use Stripe's secret keys (`sk_...`) in frontend code — CI hook blocks this anyway
- Never use the legacy `Card` widget — use `CardElement` or `PaymentElement`

## Reference

- Stripe React: https://docs.stripe.com/stripe-js/react
- SetupIntent guide: https://docs.stripe.com/payments/save-and-reuse
- Stripe Elements appearance API: https://docs.stripe.com/elements/appearance-api
