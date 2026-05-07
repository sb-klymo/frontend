/**
 * `/payment/success` — Stripe Checkout's `success_url` for M2 (modes 2 & 3).
 *
 * Server Component. Reads the `?trip=` query string, fetches the
 * transaction status from the backend with the user's session JWT,
 * and renders a self-contained receipt. The user's original chat tab
 * stays untouched — the demo flow is "click Pay → land here → close
 * tab → return to chat tab".
 *
 * `booking_reference` is null until the post-payment Issuing → Duffel
 * chain (M2-bis) ships; the page shows a "we're finalizing" note when
 * absent and surfaces the PNR when present.
 */

import { redirect } from "next/navigation";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { strings, type SupportedLanguage } from "@/lib/i18n";

type SearchParams = { trip?: string; lang?: string };

type TransactionStatus = {
  trip_id: string;
  status: "pending" | "requires_action" | "paid" | "failed" | "canceled";
  amount_cents: number | null;
  currency: string | null;
  booking_reference: string | null;
};

export default async function PaymentSuccessPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { trip, lang } = await searchParams;
  const language: SupportedLanguage = lang === "fr" ? "fr" : "en";
  const t = strings(language).paymentSuccess;

  let txn: TransactionStatus | null = null;
  if (trip) {
    txn = await fetchTransactionStatus(trip);
  }

  if (!txn) {
    return (
      <Shell>
        <h1 className="text-xl font-semibold text-gray-900">{t.notFoundTitle}</h1>
        <p className="mt-2 text-sm text-gray-600">{t.notFoundSubtitle}</p>
        <ReturnToChatNote text={t.returnToChatNote} />
      </Shell>
    );
  }

  return (
    <Shell>
      <div
        className="rounded-lg border border-emerald-200 bg-emerald-50 p-4"
        data-testid="payment-success-card"
      >
        <div className="flex items-center gap-2">
          <span className="text-emerald-700" aria-hidden="true">
            ✓
          </span>
          <h1 className="text-lg font-semibold text-emerald-900">{t.title}</h1>
        </div>
        <p className="mt-1 text-sm text-emerald-900/80">{t.subtitle}</p>

        <dl className="mt-4 space-y-2 text-sm text-gray-800">
          {txn.amount_cents !== null && txn.currency && (
            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-gray-500">{t.amountLabel}</dt>
              <dd className="font-semibold" data-testid="payment-success-amount">
                {formatAmount(txn.amount_cents, txn.currency, language)}
              </dd>
            </div>
          )}
          <div className="flex items-baseline justify-between gap-3">
            <dt className="text-gray-500">{t.statusLabel}</dt>
            <dd className="font-mono text-xs uppercase" data-testid="payment-success-status">
              {txn.status}
            </dd>
          </div>
          {txn.booking_reference ? (
            <div className="flex items-baseline justify-between gap-3 border-t border-emerald-200 pt-2">
              <dt className="text-gray-500">{t.bookingReferenceLabel}</dt>
              <dd
                className="truncate font-mono font-semibold"
                data-testid="payment-success-booking-ref"
              >
                {txn.booking_reference}
              </dd>
            </div>
          ) : (
            <p
              className="border-t border-emerald-200 pt-2 text-xs text-gray-600"
              data-testid="payment-success-pending-note"
            >
              {t.bookingPendingNote}
            </p>
          )}
        </dl>
      </div>

      <ReturnToChatNote text={t.returnToChatNote} />
    </Shell>
  );
}

async function fetchTransactionStatus(
  tripId: string,
): Promise<TransactionStatus | null> {
  // Same-origin BFF call — the route handler attaches the JWT
  // server-side. Using the absolute URL via headers().host is
  // fragile in Next 16 RSC; same-origin relative is fine inside
  // the BFF since this Server Component runs on the Next server.
  const supabase = await createSupabaseServerClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return null;

  const backendUrl = process.env.NEXT_PUBLIC_API_URL;
  if (!backendUrl) return null;

  try {
    const response = await fetch(
      `${backendUrl}/transactions/by-trip/${encodeURIComponent(tripId)}`,
      {
        headers: { Authorization: `Bearer ${session.access_token}` },
        cache: "no-store",
      },
    );
    if (!response.ok) return null;
    return (await response.json()) as TransactionStatus;
  } catch {
    return null;
  }
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-md space-y-4">{children}</div>
    </main>
  );
}

function ReturnToChatNote({ text }: { text: string }) {
  // Plain instructional text rather than a link to /chat: a fresh /chat
  // mount in this tab has no conversation state (chatStore is in-memory,
  // no message-history endpoint yet — see Option F in the M2 plan). The
  // user's live conversation is in the original tab they came from.
  return (
    <p
      className="rounded-md border border-gray-200 bg-white px-3 py-2 text-xs text-gray-600"
      data-testid="payment-return-note"
    >
      {text}
    </p>
  );
}

function formatAmount(
  cents: number,
  currency: string,
  language: SupportedLanguage,
): string {
  const amount = cents / 100;
  const locale = language === "fr" ? "fr-FR" : "en-US";
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency: currency || "USD",
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
}
