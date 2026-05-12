/**
 * BookingConfirmationCard — renders the rich post-booking confirmation
 * inline in chat after a successful K1 chain. Sourced from the
 * `event: booking` SSE frame the backend emits when a turn lands
 * `workflow_stage='completed'` (see `src/chat/service.py`).
 *
 * Replaces the plain "Booked. Reference STUBXXX." text bubble with
 * a card showing the booking reference, passenger, each flight leg,
 * total charged, and a download link to `/api/trips/{trip_id}/ticket.pdf`.
 *
 * Pure presentational. No hooks, no browser APIs — Server-Component-
 * friendly even though it only renders inside ChatWindow today.
 */

import type { BookingDetails, BookingLeg } from "@/hooks/useChatStream";
import { strings, type SupportedLanguage } from "@/lib/i18n";

export type BookingConfirmationCardProps = {
  booking: BookingDetails;
  language?: SupportedLanguage;
};

export function BookingConfirmationCard({
  booking,
  language = "en",
}: BookingConfirmationCardProps) {
  const t = strings(language).bookingCard;
  const downloadHref = `/api/trips/${encodeURIComponent(booking.trip_id)}/ticket.pdf`;

  return (
    <div
      className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 shadow-sm"
      data-testid="booking-confirmation-card"
    >
      <div className="flex items-center gap-2">
        <span className="text-emerald-700" aria-hidden="true">
          ✓
        </span>
        <h3 className="text-sm font-semibold text-emerald-900">{t.title}</h3>
      </div>

      <dl className="mt-3 space-y-2 text-xs text-gray-800">
        <div className="flex items-baseline justify-between gap-3">
          <dt className="shrink-0 text-gray-500">{t.bookingReferenceLabel}</dt>
          <dd
            className="truncate font-mono font-semibold"
            data-testid="booking-reference"
            title={booking.booking_reference}
          >
            {booking.booking_reference}
          </dd>
        </div>
        <div className="flex items-baseline justify-between gap-3">
          <dt className="shrink-0 text-gray-500">{t.passengerLabel}</dt>
          <dd className="truncate" data-testid="booking-passenger">
            {booking.passenger_name}
          </dd>
        </div>
      </dl>

      <ul className="mt-3 space-y-1.5" data-testid="booking-legs">
        {booking.legs.map((leg, idx) => (
          <FlightLegRow
            key={`${leg.origin_iata}-${leg.destination_iata}-${idx}`}
            leg={leg}
            language={language}
            label={t.flightLabel}
          />
        ))}
      </ul>

      <div className="mt-3 flex items-baseline justify-between gap-3 border-t border-emerald-200 pt-2 text-sm">
        <dt className="text-gray-600">{t.totalLabel}</dt>
        <dd className="font-semibold text-gray-900" data-testid="booking-total">
          {formatAmount(booking.amount_cents, booking.currency, language)}
        </dd>
      </div>

      <a
        href={downloadHref}
        // `download` triggers a save dialog rather than open-in-new-tab;
        // the backend response uses `Content-Disposition: inline` so a
        // user who removes the attribute (or Cmd-clicks) gets a preview
        // tab instead.
        download={`klymo-ticket-${booking.booking_reference}.pdf`}
        className="mt-3 inline-flex items-center gap-1 rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2"
        data-testid="booking-download-link"
      >
        {t.downloadLabel}
      </a>

      <p className="mt-2 text-[11px] text-gray-500">{t.emailNote}</p>

      <p
        className="mt-3 border-t border-emerald-200 pt-3 text-xs text-gray-700"
        data-testid="booking-follow-up"
      >
        {t.followUp}
      </p>
    </div>
  );
}

function FlightLegRow({
  leg,
  language,
  label,
}: {
  leg: BookingLeg;
  language: SupportedLanguage;
  label: string;
}) {
  const dep = formatDateTime(leg.departure_iso, language);
  const arr = formatDateTime(leg.arrival_iso, language);
  return (
    <li
      className="rounded border border-emerald-100 bg-white px-2 py-1.5 text-[11px]"
      data-testid="booking-leg-row"
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-medium text-gray-800">
          {leg.origin_iata} → {leg.destination_iata}
        </span>
        <span className="text-gray-500">{leg.airline_name}</span>
      </div>
      <div className="mt-0.5 flex items-baseline justify-between gap-2 font-mono text-gray-600">
        <span>
          <span className="sr-only">{label}: </span>
          {dep}
        </span>
        <span>→ {arr}</span>
      </div>
    </li>
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
    // Unknown ISO currency code — fall back to a plain string.
    return `${amount.toFixed(2)} ${currency}`;
  }
}

function formatDateTime(iso: string, language: SupportedLanguage): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const locale = language === "fr" ? "fr-FR" : "en-US";
  return new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}
