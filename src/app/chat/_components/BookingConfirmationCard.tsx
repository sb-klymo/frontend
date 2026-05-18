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

      {/* 5h — total flight time across all booked legs. Hidden when the
          backend didn't send the field (older payload) or sent 0 — the
          line would just read "Total flight time: 0min" which is
          confusing. Especially useful on round-trip and multi-leg
          bookings where summing the legs in your head is the gap the
          2026-05-18 user feedback called out. */}
      {booking.total_duration_minutes && booking.total_duration_minutes > 0 ? (
        <div
          className="mt-3 flex items-baseline justify-between gap-3 text-xs"
          data-testid="booking-total-duration-row"
        >
          <dt className="text-gray-500">{t.totalFlightTimeLabel}</dt>
          <dd
            className="font-medium text-gray-700"
            data-testid="booking-total-duration"
          >
            {formatDuration(booking.total_duration_minutes, language)}
          </dd>
        </div>
      ) : null}

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
      {/* "A copy is on its way to your inbox" + "Ready for the next
          trip? Just ask." used to live here as static text. As of the
          2026-05-12 voice rework, both lines are emitted by checkout_node
          as a chat message (via the booking-confirmed seed pool) so
          they read in the user's language with Klymo's voice and vary
          across bookings. The card stays focused on the structured
          data: ref, amount, legs, download. */}
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

/**
 * Render a whole number of minutes as "Xh Ymin" (or "Xh" / "Ymin" when
 * one side is zero). FR/EN use the same compact form — "4h 30min"
 * reads natively in both languages, and the unit suffix avoids the
 * ambiguity of "4:30" (which could mean a time-of-day).
 */
function formatDuration(totalMinutes: number, language: SupportedLanguage): string {
  if (totalMinutes <= 0) return "";
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return language === "fr" ? `${minutes} min` : `${minutes}min`;
  if (minutes === 0) return `${hours}h`;
  return language === "fr" ? `${hours}h ${minutes}min` : `${hours}h ${minutes}min`;
}
