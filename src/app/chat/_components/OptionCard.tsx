/**
 * OptionCard — renders a single flight option from Tool 5's `displayed_offers`.
 *
 * Pure presentational. Server-Component-friendly (no hooks, no browser APIs)
 * even though it's only used inside ChatWindow (client component) today.
 */

import type { DisplayedOffer, FlightSlice, PolicyStatus } from "@/types/chat";

const STATUS_META: Record<
  PolicyStatus,
  { label: string; pillClass: string }
> = {
  auto_approved: {
    label: "✓ approved",
    pillClass: "bg-green-100 text-green-800",
  },
  manager_approval_required: {
    label: "⚠ requires manager approval",
    pillClass: "bg-amber-100 text-amber-800",
  },
  finance_approval_required: {
    label: "⚠ requires finance approval",
    pillClass: "bg-amber-100 text-amber-800",
  },
  // Tool 5 filters blocked offers before this component sees them, but we
  // keep the visual mapping defensive in case an upstream change leaks one.
  policy_blocked: {
    label: "✗ blocked",
    pillClass: "bg-red-100 text-red-800",
  },
};

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
  return new Date(iso).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC", // stub data is UTC; live data should respect airport TZ later
  });
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
};

export function OptionCard({ offer }: OptionCardProps) {
  const status = STATUS_META[offer.policy_status];
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-gray-500">
              Option {offer.rank}
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
          className={`rounded-full px-2 py-0.5 text-xs font-medium ${status.pillClass}`}
        >
          {status.label}
        </span>
        {offer.policy_status !== "auto_approved" && (
          <span className="text-xs text-gray-500">{offer.policy_reason}</span>
        )}
      </div>
    </div>
  );
}
