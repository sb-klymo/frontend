/**
 * CancellationCard — rendered after the user successfully cancels a
 * confirmed booking. Sourced from the `event: cancellation` SSE frame
 * the backend emits when a turn lands `workflow_stage='canceled'`
 * (see `src/chat/service.py::_project_cancellation_event`).
 *
 * Replaces the plain rephrased text bubble ("Your booking STUBXXX is
 * cancelled, refund will land in 5-10 days") with a structured card
 * showing the booking reference, refund amount, refund ID, and the
 * receipt-timing note.
 *
 * Visual cue: gray + neutral (vs BookingConfirmationCard's green
 * success palette) so the user immediately reads it as "this booking
 * is over" rather than "this booking is happening".
 *
 * Pure presentational — Server-Component-friendly even though it
 * only renders inside ChatWindow today.
 */

import type { CancellationDetails } from "@/hooks/useChatStream";
import { strings, type SupportedLanguage } from "@/lib/i18n";

export type CancellationCardProps = {
  cancellation: CancellationDetails;
  language?: SupportedLanguage;
};

const STRIPE_REFUND_DEEPLINK = "https://dashboard.stripe.com/test/refunds";

export function CancellationCard({
  cancellation,
  language = "en",
}: CancellationCardProps) {
  const t = strings(language).cancellationCard;
  // Phase 18 - fee breakdown (client issue 10): only meaningful when a
  // penalty was actually withheld. Null/undefined (legacy payloads,
  // pre-Phase-12 audit rows) and 0 (free cancellation) hide the rows.
  const penaltyCents = cancellation.penalty_amount_cents;
  const showFeeBreakdown = typeof penaltyCents === "number" && penaltyCents > 0;

  return (
    <div
      className="rounded-lg border border-gray-300 bg-gray-50 p-4 shadow-sm"
      data-testid="cancellation-card"
    >
      <div className="flex items-center gap-2">
        <span className="text-gray-500" aria-hidden="true">
          ✗
        </span>
        <h3 className="text-sm font-semibold text-gray-900">{t.title}</h3>
      </div>

      <dl className="mt-3 space-y-2 text-xs text-gray-800">
        <div className="flex items-baseline justify-between gap-3">
          <dt className="shrink-0 text-gray-500">{t.bookingReferenceLabel}</dt>
          <dd
            className="truncate font-mono font-semibold"
            data-testid="cancellation-booking-reference"
            title={cancellation.booking_reference}
          >
            {cancellation.booking_reference}
          </dd>
        </div>
        {showFeeBreakdown && typeof cancellation.original_amount_cents === "number" ? (
          <div className="flex items-baseline justify-between gap-3">
            <dt className="shrink-0 text-gray-500">{t.originalAmountLabel}</dt>
            <dd
              className="truncate text-gray-700"
              data-testid="cancellation-original-amount"
            >
              {formatAmount(
                cancellation.original_amount_cents,
                cancellation.currency,
                language,
              )}
            </dd>
          </div>
        ) : null}
        {showFeeBreakdown ? (
          <div className="flex items-baseline justify-between gap-3">
            <dt className="shrink-0 text-gray-500">{t.penaltyLabel}</dt>
            <dd
              className="truncate text-gray-700"
              data-testid="cancellation-penalty-amount"
            >
              {formatAmount(penaltyCents ?? 0, cancellation.currency, language)}
            </dd>
          </div>
        ) : null}
        <div className="flex items-baseline justify-between gap-3">
          <dt className="shrink-0 text-gray-500">{t.refundLabel}</dt>
          <dd
            className="truncate font-semibold text-gray-900"
            data-testid="cancellation-refund-amount"
          >
            {formatAmount(cancellation.amount_cents, cancellation.currency, language)}
          </dd>
        </div>
        {cancellation.refund_id ? (
          <div className="flex items-baseline justify-between gap-3 border-t border-gray-200 pt-2">
            <dt className="shrink-0 text-gray-500">{t.refundIdLabel}</dt>
            <dd className="truncate text-right">
              <a
                href={STRIPE_REFUND_DEEPLINK}
                target="_blank"
                rel="noopener noreferrer"
                className="font-mono text-[10px] text-blue-600 hover:underline"
                title={cancellation.refund_id}
                data-testid="cancellation-refund-id"
              >
                {cancellation.refund_id}
              </a>
            </dd>
          </div>
        ) : null}
      </dl>

      <p className="mt-3 border-t border-gray-200 pt-2 text-[11px] text-gray-500">
        {t.receiptNote}
      </p>
    </div>
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
    // Unknown ISO currency code — fall back to a plain string.
    return `${amount.toFixed(2)} ${currency}`;
  }
}
