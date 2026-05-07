/**
 * `/payment/canceled` — Stripe Checkout's `cancel_url` for M2.
 *
 * Server Component. The user clicked "back" on Stripe's hosted page or
 * abandoned the checkout. We render a minimal "no charge was made" page
 * with a return-to-chat link. The original chat tab still has a live
 * `CheckoutPaymentCard` they can reuse — Stripe's idempotency key
 * returns the same Session URL, so re-clicking Pay works.
 */

import { redirect } from "next/navigation";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { strings, type SupportedLanguage } from "@/lib/i18n";

type SearchParams = { trip?: string; lang?: string };

export default async function PaymentCanceledPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { lang } = await searchParams;
  const language: SupportedLanguage = lang === "fr" ? "fr" : "en";
  const t = strings(language).paymentCanceled;

  return (
    <main className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-md space-y-4">
        <div
          className="rounded-lg border border-amber-200 bg-amber-50 p-4"
          data-testid="payment-canceled-card"
        >
          <div className="flex items-center gap-2">
            <span className="text-amber-700" aria-hidden="true">
              ⚠
            </span>
            <h1 className="text-lg font-semibold text-amber-900">{t.title}</h1>
          </div>
          <p className="mt-1 text-sm text-amber-900/80">{t.subtitle}</p>
        </div>

        <p
          className="rounded-md border border-gray-200 bg-white px-3 py-2 text-xs text-gray-600"
          data-testid="payment-return-note"
        >
          {t.returnToChatNote}
        </p>
      </div>
    </main>
  );
}
