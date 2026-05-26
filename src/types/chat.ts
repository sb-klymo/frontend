/**
 * Frontend mirror of the chat-related Pydantic types from the backend.
 *
 * These shapes flow through the SSE stream (event: options) — they are NOT
 * generated from the OpenAPI schema because the chat endpoint streams
 * server-sent events rather than typed JSON, and openapi-ts can't model
 * SSE frames.
 *
 * Keep these types in sync with:
 *   backend/src/agent/tools/present_options.py  → DisplayedOffer
 *   backend/src/agent/tools/search_flights_duffel.py → FlightSlice
 *   backend/src/policy/types.py → PolicyResult (here named PolicyStatus)
 */

export type FlightSegment = {
  origin_iata: string;
  destination_iata: string;
  departing_at: string; // ISO-8601 UTC string
  arriving_at: string;
  duration_iso: string;
  marketing_carrier_iata: string;
  operating_carrier_iata: string | null;
};

export type FlightSlice = {
  origin_iata: string;
  destination_iata: string;
  departure_datetime: string; // ISO-8601 UTC string
  arrival_datetime: string;
  duration_iso: string; // e.g. "PT2H15M"
  // Phase 10 — per-segment data + derived stops/layover info.
  segments: FlightSegment[];
  stops_count: number;
  intermediate_airports: string[];
  layover_durations_iso: string[];
};

export type PolicyStatus =
  | "auto_approved"
  | "manager_approval_required"
  | "finance_approval_required"
  | "policy_blocked";

// Phase 12 — mirror of backend ConditionBadge (cancellation_badge.py).
// `state` covers both refund and change conditions; `not_allowed` renders
// as "non-refundable" / "non-changeable" per context.
export type ConditionBadgeState = "free" | "fee" | "not_allowed" | "unknown";

export type ConditionBadge = {
  state: ConditionBadgeState;
  penalty_amount_cents: number | null;
  penalty_currency: string | null;
};

export type DisplayedOffer = {
  offer_id: string;
  rank: number; // 1-indexed (1, 2, or 3)
  airline_name: string;
  airline_iata: string;
  total_amount_cents: number;
  total_currency: string;
  outbound: FlightSlice;
  return_leg: FlightSlice | null;
  policy_status: PolicyStatus;
  policy_reason: string;
  // Phase 12 — cancellation/change badges. Optional: a frontend deploy may
  // briefly precede the backend, so an absent field is treated as "unknown".
  refund_policy?: ConditionBadge;
  change_policy?: ConditionBadge;
};
