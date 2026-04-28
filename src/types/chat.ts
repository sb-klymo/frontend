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

export type FlightSlice = {
  origin_iata: string;
  destination_iata: string;
  departure_datetime: string; // ISO-8601 UTC string
  arrival_datetime: string;
  duration_iso: string; // e.g. "PT2H15M"
};

export type PolicyStatus =
  | "auto_approved"
  | "manager_approval_required"
  | "finance_approval_required"
  | "policy_blocked";

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
};
