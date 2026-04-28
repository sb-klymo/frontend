/**
 * OptionCard — renders a single flight option from Tool 5's `displayed_offers`.
 *
 * Pure presentational. Server-Component-friendly (no hooks, no browser APIs)
 * even though it's only used inside ChatWindow (client component) today.
 */

import { strings, type SupportedLanguage } from "@/lib/i18n";
import type { DisplayedOffer, FlightSlice, PolicyStatus } from "@/types/chat";

const STATUS_PILL_CLASS: Record<PolicyStatus, string> = {
  auto_approved: "bg-green-100 text-green-800",
  manager_approval_required: "bg-amber-100 text-amber-800",
  finance_approval_required: "bg-amber-100 text-amber-800",
  // Tool 5 filters blocked offers before this component sees them, but we
  // keep the mapping defensive in case an upstream change leaks one.
  policy_blocked: "bg-red-100 text-red-800",
};

function statusLabel(
  status: PolicyStatus,
  language: SupportedLanguage,
): string {
  const t = strings(language).optionCard;
  switch (status) {
    case "auto_approved":
      return t.badgeApproved;
    case "manager_approval_required":
      return t.badgeManagerApproval;
    case "finance_approval_required":
      return t.badgeFinanceApproval;
    case "policy_blocked":
      return t.badgeBlocked;
  }
}

const CURRENCY_SYMBOL: Record<string, string> = {
  EUR: "€",
  USD: "$",
  GBP: "£",
};

function formatPrice(cents: number, currency: string): string {
  const symbol = CURRENCY_SYMBOL[currency] ?? `${currency} `;
  const units = Math.floor(cents / 100);
  const fractional = cents % 100;
  return fractional === 0
    ? `${symbol}${units}`
    : `${symbol}${units}.${String(fractional).padStart(2, "0")}`;
}

function formatTime(iso: string): string {
  // Parse HH:MM directly from the ISO string instead of going through
  // `new Date(...)`. JS interprets a tz-less timestamp as LOCAL time and
  // would shift "2026-06-01T08:00:00" by the user's local offset (e.g.
  // Europe/Paris UTC+2 → 06:00) — but the bot's text confirmation prints
  // 08:00 directly via Python strftime, so the rendered card was 2h off.
  // Reading the substring keeps the displayed hour exactly as encoded.
  // Phase 3 follow-up: switch to proper airport-TZ rendering when live
  // Duffel data carries real timezone-stamped flight times.
  const match = iso.match(/T(\d{2}:\d{2})/);
  return match ? match[1]! : iso;
}

function SliceLine({ slice }: { slice: FlightSlice }) {
  return (
    <div className="text-sm text-gray-700">
      <span className="font-mono text-xs text-gray-500">
        {slice.origin_iata}
      </span>{" "}
      {formatTime(slice.departure_datetime)}{" "}
      <span aria-hidden="true">→</span>{" "}
      <span className="font-mono text-xs text-gray-500">
        {slice.destination_iata}
      </span>{" "}
      {formatTime(slice.arrival_datetime)}
    </div>
  );
}

export type OptionCardProps = {
  offer: DisplayedOffer;
  language?: SupportedLanguage;
};

export function OptionCard({ offer, language = "en" }: OptionCardProps) {
  const t = strings(language).optionCard;
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-gray-500">
              {t.optionLabel} {offer.rank}
            </span>
            <span className="truncate font-medium text-gray-900">
              {offer.airline_name}
            </span>
            <span className="font-mono text-xs text-gray-400">
              {offer.airline_iata}
            </span>
          </div>
          <div className="mt-1 space-y-0.5">
            <SliceLine slice={offer.outbound} />
            {offer.return_leg && <SliceLine slice={offer.return_leg} />}
          </div>
        </div>
        <div className="text-lg font-semibold tabular-nums text-gray-900">
          {formatPrice(offer.total_amount_cents, offer.total_currency)}
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1">
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_PILL_CLASS[offer.policy_status]}`}
        >
          {statusLabel(offer.policy_status, language)}
        </span>
        {offer.policy_status !== "auto_approved" && (
          <span className="text-xs text-gray-500">{offer.policy_reason}</span>
        )}
      </div>
    </div>
  );
}
