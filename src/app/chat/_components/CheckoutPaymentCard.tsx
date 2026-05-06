/**
 * CheckoutPaymentCard — renders the Stripe Checkout call-to-action
 * inline in chat for payment modes 2 (`checkout_opt_in`) and 3
 * (`checkout_fallback`). Sourced from the `event: checkout_link` SSE
 * frame the backend emits when a turn lands `workflow_stage='payment_pending'`.
 *
 * Visually distinct from BookingConfirmationCard (amber/blue vs green)
 * so the user reads it as "action required" rather than "done".
 *
 * Pure presentational. No hooks, no browser APIs.
 */

import type { CheckoutLinkDetails } from "@/hooks/useChatStream";
import { strings, type SupportedLanguage } from "@/lib/i18n";

export type CheckoutPaymentCardProps = {
  checkoutLink: CheckoutLinkDetails;
  language?: SupportedLanguage;
};

export function CheckoutPaymentCard({
  checkoutLink,
  language = "en",
}: CheckoutPaymentCardProps) {
  const t = strings(language).checkoutCard;

  // Paid branch — fired by the Realtime subscription in useChatStream
  // once the Stripe webhook flips `transactions.status` to 'paid'.
  // Green palette mirrors BookingConfirmationCard so the visual
  // language stays consistent: green = done, amber = action required.
  if (checkoutLink.paid) {
    return (
      <div
        className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 shadow-sm"
        data-testid="checkout-payment-card"
        data-paid="true"
      >
        <div className="flex items-center gap-2">
          <span className="text-emerald-700" aria-hidden="true">
            ✓
          </span>
          <h3 className="text-sm font-semibold text-emerald-900">{t.paidTitle}</h3>
        </div>

        <dl className="mt-3 space-y-2 text-xs text-gray-800">
          <div className="flex items-baseline justify-between gap-3">
            <dt className="text-gray-600">{t.amountLabel}</dt>
            <dd
              className="font-semibold text-gray-900"
              data-testid="checkout-amount"
            >
              {formatAmount(checkoutLink.amount_cents, checkoutLink.currency, language)}
            </dd>
          </div>
          <div className="flex items-baseline justify-between gap-3 border-t border-emerald-200 pt-2">
            <dt className="text-gray-600">{t.paidStatusLabel}</dt>
            <dd
              className="font-mono text-[11px] uppercase text-emerald-800"
              data-testid="checkout-paid-status"
            >
              {t.paidStatusValue}
            </dd>
          </div>
        </dl>

        <p className="mt-3 text-[11px] text-gray-500">{t.paidNote}</p>
      </div>
    );
  }

  return (
    <div
      className="rounded-lg border border-amber-300 bg-amber-50 p-4 shadow-sm"
      data-testid="checkout-payment-card"
      data-paid="false"
    >
      <div className="flex items-center gap-2">
        <span className="text-amber-700" aria-hidden="true">
          ⚡
        </span>
        <h3 className="text-sm font-semibold text-amber-900">{t.title}</h3>
      </div>

      <dl className="mt-3 text-xs text-gray-800">
        <div className="flex items-baseline justify-between gap-3 border-b border-amber-200 pb-2">
          <dt className="text-gray-600">{t.amountLabel}</dt>
          <dd
            className="font-semibold text-gray-900"
            data-testid="checkout-amount"
          >
            {formatAmount(checkoutLink.amount_cents, checkoutLink.currency, language)}
          </dd>
        </div>
      </dl>

      <a
        href={checkoutLink.checkout_url}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-3 inline-flex items-center gap-1 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
        data-testid="checkout-pay-link"
      >
        {t.payNowLabel}
      </a>

      <p className="mt-2 text-[11px] text-gray-500">{t.payNoteLabel}</p>
    </div>
  );
}

function formatAmount(cents: number, currency: string, language: SupportedLanguage): string {
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
