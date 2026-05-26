/**
 * OptionCard — renders a single flight option from Tool 5's `displayed_offers`.
 *
 * Pure presentational. Server-Component-friendly (no hooks, no browser APIs)
 * even though it's only used inside ChatWindow (client component) today.
 */

import { formatDuration } from "@/lib/duration";
import { strings, type SupportedLanguage } from "@/lib/i18n";
import { classifyLayover, layoverClassName } from "@/lib/layover";
import type {
  ConditionBadge,
  ConditionBadgeState,
  DisplayedOffer,
  FlightSlice,
  PolicyStatus,
} from "@/types/chat";

const STATUS_PILL_CLASS: Record<PolicyStatus, string> = {
  auto_approved: "bg-green-100 text-green-800",
  manager_approval_required: "bg-amber-100 text-amber-800",
  finance_approval_required: "bg-amber-100 text-amber-800",
  // Tool 5 filters blocked offers before this component sees them, but we
  // keep the mapping defensive in case an upstream change leaks one.
  policy_blocked: "bg-red-100 text-red-800",
};

// Phase 12 — refund-condition badge colours (parallel to STATUS_PILL_CLASS).
const CONDITION_PILL_CLASS: Record<ConditionBadgeState, string> = {
  free: "bg-green-100 text-green-800",
  fee: "bg-amber-100 text-amber-800",
  not_allowed: "bg-gray-100 text-gray-700",
  unknown: "bg-gray-100 text-gray-500",
};

// An absent refund_policy (e.g. a frontend deploy briefly ahead of the
// backend) is treated as "unknown".
const UNKNOWN_BADGE: ConditionBadge = {
  state: "unknown",
  penalty_amount_cents: null,
  penalty_currency: null,
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

// Normalize a badge from the (unvalidated) SSE payload into a safe one:
// the `ConditionBadge` type is a compile-time-only contract, so guard
// against an absent field, an unrecognized `state`, or a contradictory
// "fee" with no positive penalty — all collapse to "unknown".
function safeRefundBadge(badge: ConditionBadge | undefined): ConditionBadge {
  if (!badge) return UNKNOWN_BADGE;
  switch (badge.state) {
    case "free":
    case "not_allowed":
    case "unknown":
      return badge;
    case "fee":
      return (badge.penalty_amount_cents ?? 0) > 0 ? badge : UNKNOWN_BADGE;
    default:
      return UNKNOWN_BADGE;
  }
}

function refundBadgeLabel(
  badge: ConditionBadge,
  language: SupportedLanguage,
): string {
  const t = strings(language).optionCard;
  switch (badge.state) {
    case "free":
      return t.refundFree;
    case "not_allowed":
      return t.refundNonRefundable;
    case "fee":
      return t.refundFee(
        formatPrice(badge.penalty_amount_cents ?? 0, badge.penalty_currency ?? "EUR"),
      );
    case "unknown":
      return t.conditionUnknown;
    default:
      return t.conditionUnknown;
  }
}

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

function formatDate(iso: string, language: SupportedLanguage): string {
  // Same regex-extraction approach as `formatTime` — avoid `new Date(...)`
  // so we don't shift across the user's local timezone. Renders the
  // localised short form: FR "21 mai", EN "May 21".
  const match = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return iso;
  const day = parseInt(match[3]!, 10);
  const monthIndex = parseInt(match[2]!, 10) - 1;
  const monthNames = strings(language).optionCard.monthNamesShort;
  const month = monthNames[monthIndex] ?? match[2]!;
  return language === "fr" ? `${day} ${month}` : `${month} ${day}`;
}

/**
 * Compute the "+N" day-difference suffix when arrival date differs from
 * departure. Returns "" for same-day, " +1" / " +2" / etc otherwise.
 *
 * Uses UTC components so the displayed suffix matches what the user reads
 * on the row (departure/arrival times are rendered from the ISO string
 * substring — see `formatTime`).
 */
function dayDiffSuffix(departure: string, arrival: string): string {
  const dep = new Date(departure);
  const arr = new Date(arrival);
  if (isNaN(dep.getTime()) || isNaN(arr.getTime())) return "";
  const dayMs = 24 * 60 * 60 * 1000;
  const depUTC = Date.UTC(
    dep.getUTCFullYear(),
    dep.getUTCMonth(),
    dep.getUTCDate(),
  );
  const arrUTC = Date.UTC(
    arr.getUTCFullYear(),
    arr.getUTCMonth(),
    arr.getUTCDate(),
  );
  if (depUTC === arrUTC) return "";
  const days = Math.round((arrUTC - depUTC) / dayMs);
  return days > 0 ? ` +${days}` : "";
}

type SliceInfoRowProps = {
  slice: FlightSlice;
  language: SupportedLanguage;
};

/**
 * Renders the Phase 10 duration + stops + layover row beneath the time row:
 *   "8h 21min · Direct"                    (green Direct, no stops)
 *   "11h 15min · 1 stop · 2h 15min in MAD" (gray, normal layover)
 *   "11h 30min · 1 stop · 45min in AMS ⚠"  (orange, tight layover)
 *   "19h 40min · 2 stops · IST, FRA"       (2+ stops, no per-gap detail)
 */
function SliceInfoRow({ slice, language }: SliceInfoRowProps) {
  const t = strings(language).optionCard;
  const durationText = formatDuration(slice.duration_iso, language);
  const isDirect = slice.stops_count === 0;
  const stopsText = isDirect ? t.directLabel : t.stopsLabel(slice.stops_count);

  let layoverNode: React.ReactNode = null;
  if (slice.stops_count === 1 && slice.layover_durations_iso.length === 1) {
    const layoverIso = slice.layover_durations_iso[0];
    if (layoverIso) {
      const layoverMins = formatDuration(layoverIso, language);
      const level = classifyLayover(layoverIso);
      const cls = layoverClassName(level);
      const warning = level !== "normal" ? " ⚠" : "";
      const airport = slice.intermediate_airports[0] ?? "";
      // Skip the layover span entirely when the airport IATA is missing —
      // avoids " · 2h 15min in  ⚠" (double space + dangling preposition).
      if (airport) {
        layoverNode = (
          <span className={cls} data-testid="layover-detail">
            {`${t.layoverIn(layoverMins, airport)}${warning}`}
          </span>
        );
      }
    }
  } else if (slice.stops_count >= 2) {
    const shown = slice.intermediate_airports.slice(0, 2).join(", ");
    const ellipsis =
      slice.intermediate_airports.length > 2 ? "…" : "";
    layoverNode = (
      <span className="text-gray-500">
        {` · ${shown}${ellipsis}`}
      </span>
    );
  }

  return (
    <div
      className="mt-1 text-xs text-gray-600"
      data-testid="slice-info-row"
    >
      {durationText && <span>{durationText}</span>}
      {durationText && <span> · </span>}
      <span className={isDirect ? "text-green-600" : "text-gray-500"}>
        {stopsText}
      </span>
      {layoverNode}
    </div>
  );
}

function SliceLine({
  slice,
  language,
  label,
}: {
  slice: FlightSlice;
  language: SupportedLanguage;
  label?: string;
}) {
  return (
    <div>
      <div className="text-xs text-gray-500">
        {label ? `${label} · ` : ""}
        {formatDate(slice.departure_datetime, language)}
      </div>
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
        {dayDiffSuffix(slice.departure_datetime, slice.arrival_datetime)}
      </div>
      <SliceInfoRow slice={slice} language={language} />
    </div>
  );
}

export type OptionCardProps = {
  offer: DisplayedOffer;
  language?: SupportedLanguage;
};

export function OptionCard({ offer, language = "en" }: OptionCardProps) {
  const t = strings(language).optionCard;
  const refundBadge = safeRefundBadge(offer.refund_policy);
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
          <div className="mt-1 space-y-1">
            <SliceLine
              slice={offer.outbound}
              language={language}
              label={offer.return_leg ? t.legLabelOutbound : undefined}
            />
            {offer.return_leg && (
              <SliceLine
                slice={offer.return_leg}
                language={language}
                label={t.legLabelReturn}
              />
            )}
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
          <span className="text-xs text-gray-500">
            {offer.policy_status === "policy_blocked"
              ? t.blockedReason
              : offer.policy_status === "manager_approval_required"
                ? t.managerApprovalReason
                : t.financeApprovalReason}
          </span>
        )}
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-medium ${
            CONDITION_PILL_CLASS[refundBadge.state]
          }`}
          data-testid="refund-badge"
        >
          {refundBadgeLabel(refundBadge, language)}
        </span>
      </div>
    </div>
  );
}
