"use client";

/**
 * `useChatStream` — consumes the backend `/chat` SSE stream.
 *
 * Native `EventSource` can't send Authorization headers, so we read the raw
 * response body via `fetch` + `ReadableStream` + `TextDecoder` and parse the
 * `event:` / `data:` frames by hand. Matches the protocol emitted by
 * src/chat/service.py on the backend.
 *
 * Aborting mid-stream is supported via the returned `stop` callback.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { OrgPolicySettings } from "@/lib/api/generated/types.gen";
import { useChatStore } from "@/stores/chatStore";
import { detectLanguage, type SupportedLanguage } from "@/lib/i18n";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import type { DisplayedOffer } from "@/types/chat";
import type { Vibe } from "@/lib/voice-presets";

export type ChatRole = "user" | "assistant" | "system";

/**
 * One leg of a confirmed booking, as projected by the backend's
 * `booking` SSE event. Mirrors `src/notifications/pdf.py::TicketLeg`
 * so the in-chat card and the email PDF show the same flight info.
 */
export type BookingLeg = {
  origin_iata: string;
  destination_iata: string;
  departure_iso: string;
  arrival_iso: string;
  airline_name: string;
};

/**
 * Structured booking confirmation attached via the `event: booking`
 * SSE frame. Backend emits one of these per turn that lands
 * `workflow_stage='completed'`. M3 frontend consumes it to render
 * a rich BookingConfirmationCard with flight details + a download
 * link for `/api/trips/{trip_id}/ticket.pdf`.
 */
export type BookingDetails = {
  trip_id: string;
  booking_reference: string;
  passenger_name: string;
  amount_cents: number;
  currency: string;
  legs: BookingLeg[];
  /**
   * Sum of (arrival - departure) over all booked legs, in whole
   * minutes. Drives the "Total flight time: 4h 30m" line on
   * `BookingConfirmationCard`. 2026-05-18 user feedback flagged not
   * knowing "combien de temps ça prend au total" on round-trip and
   * multi-destination bookings as a card UX gap.
   *
   * Optional on the type so older SSE/REST payloads without the field
   * still deserialize — the card hides the row when the value is
   * 0 / undefined.
   */
  total_duration_minutes?: number;
};

/**
 * L3 cancellation surfaced via `event: cancellation`. Emitted when the
 * user cancelled a confirmed booking and the Stripe refund + DB
 * updates completed (see backend `_project_cancellation_event`). The
 * frontend renders a `CancellationCard` with the refund amount, PNR,
 * and a deep-link to the Stripe refund record.
 */
export type CancellationDetails = {
  trip_id: string;
  booking_reference: string;
  refund_id: string;
  amount_cents: number;
  currency: string;
};

/**
 * Approval status for an approval request row. Mirrors the
 * `approval_requests.status` enum on the backend.
 */
export type ApprovalStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "expired"
  | "canceled";

/**
 * Approval request details surfaced via `event: approval_required` (Phase
 * 6). Backend emits one when the policy engine flags a selected offer as
 * requiring manager/finance approval. The frontend renders an
 * `ApprovalPendingCard` that morphs in-place via Realtime when the manager
 * decides (approved/rejected/expired/canceled).
 *
 * The `decided_by_first_name` field is optional because it is only
 * populated on terminal approved/rejected states; pending rows carry
 * `null`.
 */
export type ApprovalRequestDetails = {
  id: string;
  total: number;
  currency: string;
  /** ISO 8601 expiry timestamp — drives the countdown on the card. */
  expires_at: string;
  approver_emails: string[];
  policy_reason: string | null;
  status: ApprovalStatus;
  decision_reason?: string | null;
  decided_at?: string | null;
  /** First name of the manager who made the decision. Used for the
   * "Approved by {name}" / "Rejected by {name}" line on the morphed card. */
  decided_by_first_name?: string | null;
};

/**
 * Onboarding redirect surfaced via `event: onboarding_redirect` (PR-4
 * phase-4). Backend emits one when this turn lands
 * `workflow_stage='onboarding_payment_redirect'` — the third stage of
 * the conversational signup, parked until the user completes the
 * Stripe SetupIntent on the existing /onboarding/payment-method page.
 *
 * The frontend renders an `OnboardingCard` with a CTA button pointing
 * at `url`. After the user finishes Stripe, the existing
 * `PaymentMethodForm` redirects back to `/chat?onboarded=1`; the
 * chat-side `onboard_node` stage-3 handler reads
 * `organizations.onboarding_completed_at` on the user's next turn and
 * transitions the conversation out of the onboarding flow.
 */
export type OnboardingDetails = {
  /** Absolute URL of the Stripe SetupIntent page (sourced from backend
   * so a future relocation doesn't require a frontend bump). */
  url: string;
  /** Echoed back from the user's onboarding draft for the card title.
   * Optional because the backend defensively passes `None` when the
   * draft state is missing (shouldn't happen, but safe). */
  company_name?: string | null;
  /** True once the Stripe SetupIntent webhook flipped
   * `users.stripe_payment_method_id` and Realtime delivered the
   * UPDATE to the chat tab. Flipped by `markOnboardingComplete`
   * inside the Realtime subscription effect — the card morphs in
   * place to a green "Payment method saved" state without a refresh.
   * Mirrors the M2-H3 booking-card morph pattern. */
  completed?: boolean;
};

/**
 * Stripe Checkout link surfaced via `event: checkout_link` (M2). Fired
 * for users on payment modes 2 (`checkout_opt_in`) and 3
 * (`checkout_fallback`) when the agent reaches a billable offer — the
 * frontend renders a CheckoutPaymentCard with a "Pay now" button rather
 * than running the K1 auto-charge chain.
 */
export type CheckoutLinkDetails = {
  trip_id: string;
  checkout_url: string;
  amount_cents: number;
  currency: string;
  /**
   * Set to true once the Realtime subscription on `public.transactions`
   * observes `status='paid'` for this trip (triggered by the Stripe
   * webhook). Drives the `CheckoutPaymentCard` morph from pending /
   * Pay-now to "Payment received ✓".
   */
  paid?: boolean;
  /**
   * Set to true when the Realtime subscription observes a terminal
   * non-success status (`refunded` / `failed` / `canceled`) for this
   * trip. Used purely as a teardown signal for the Realtime channel —
   * `pendingTripId` keeps the channel alive past the `paid` morph
   * waiting for `duffel_order_id` (the M2-bis Plan B booking signal),
   * and `failed` releases that hold so the channel doesn't leak when
   * PR 6's refund safety net fires instead. The chat-side failure UX
   * itself surfaces via the differentiated SSE error frame from PR
   * #25, not this field.
   */
  failed?: boolean;
};

export type ChatMessage = {
  id: string;
  role: ChatRole;
  content: string;
  /**
   * Structured flight offers attached via the `event: options` SSE frame.
   * When present, the renderer should show <OptionList> instead of a plain
   * text bubble for this message — the cards convey the same information
   * the text content also carries.
   */
  offers?: DisplayedOffer[];
  /**
   * Optional rephrased header / footer for the option list, populated by
   * the backend `phrase()` helper with the user's conversation context
   * (so it varies across turns and references what the user asked for).
   * Frontend renders these when present, falls back to the static i18n
   * strings otherwise — fallback covers no-API-key dev / LLM error.
   */
  optionsHeader?: string;
  optionsFooter?: string;
  /**
   * When `false`, all offers in this message are policy-blocked and the list
   * is read-only (no interactive booking footer). Populated from the backend
   * `selectable` field on the `event: options` SSE frame. Defaults to `true`
   * (happy path, backward compatible when the backend omits the field).
   */
  optionsSelectable?: boolean;
  /**
   * Structured booking confirmation attached via the `event: booking`
   * SSE frame. When present, the renderer shows the
   * BookingConfirmationCard instead of the plain text bubble.
   */
  booking?: BookingDetails;
  /**
   * Stripe Checkout link attached via the `event: checkout_link` SSE
   * frame (M2). When present, the renderer shows the
   * CheckoutPaymentCard instead of the plain text bubble.
   */
  checkoutLink?: CheckoutLinkDetails;
  /**
   * Cancellation receipt attached via the `event: cancellation` SSE
   * frame (L3). When present, the renderer shows the
   * `CancellationCard` (gray, with refund + PNR). Takes precedence
   * over `booking` / `checkoutLink` in ChatWindow — a cancelled
   * booking should never display as a confirmed-and-payable card.
   */
  cancellation?: CancellationDetails;
  /**
   * Onboarding-redirect payload attached via the
   * `event: onboarding_redirect` SSE frame (PR-4 phase-4). When
   * present, the renderer shows an `OnboardingCard` with a CTA
   * button pointing at the Stripe SetupIntent page. Mutually
   * exclusive with the booking-flow cards in practice — onboarding
   * only fires before any trip has been planned.
   */
  onboarding?: OnboardingDetails;
  /**
   * Approval request payload attached via the `event: approval_required`
   * SSE frame (Phase 6). When present, the renderer shows an
   * `ApprovalPendingCard` that subscribes to Supabase Realtime and morphs
   * in-place when the manager decides. Takes precedence over `booking` and
   * `checkoutLink` in the ChatWindow renderer — an offer awaiting approval
   * must never display as a payable or confirmed booking.
   *
   * NOTE: the SSE consumer for this field is wired in Task 14.
   * This field is present on the type now so Task 14 can populate it
   * without a type-layer PR.
   */
  approvalRequest?: ApprovalRequestDetails;
  /**
   * Backend-assigned bubble identity from the SSE `event: message`
   * payload (`message_id`). For token-streaming chunks from a single
   * LLM call, all deltas share the same id → we APPEND to this
   * bubble. For multi-message returns (e.g. the L3-suivi 2
   * cancel-continuation success emits 3 separate AIMessages), each
   * AIMessage has a distinct id → each renders as its OWN bubble.
   * Absent for bubbles created locally (user messages, card-only
   * messages from `attachBooking`/`attachCancellation`).
   */
  messageId?: string;
};

type ServerEvent =
  | { type: "start"; conversation_id: string }
  | { type: "message"; content: string; node?: string; message_id?: string }
  | { type: "typing"; node?: string }
  | {
      type: "options";
      offers: DisplayedOffer[];
      header?: string;
      footer?: string;
      /** When false, all offers are blocked and the list is read-only. Defaults to true when absent. */
      selectable?: boolean;
      node?: string;
    }
  | { type: "booking"; trip_id: string; booking_reference: string; passenger_name: string; amount_cents: number; currency: string; legs: BookingLeg[]; total_duration_minutes?: number }
  | { type: "checkout_link"; trip_id: string; checkout_url: string; amount_cents: number; currency: string }
  | { type: "onboarding_redirect"; url: string; company_name?: string | null }
  | {
      type: "cancellation";
      trip_id: string;
      booking_reference: string;
      refund_id: string;
      amount_cents: number;
      currency: string;
    }
  | {
      type: "approval_required";
      id: string;
      total: number;
      currency: string;
      expires_at: string;
      approver_emails: string[];
      policy_reason: string | null;
      status: ApprovalStatus;
      decision_reason?: string | null;
      decided_at?: string | null;
      decided_by_first_name?: string | null;
    }
  | {
      type: "done";
      workflow_stage: string | null;
      conversation_id: string;
      // Sticky language from the backend's `state.detected_language`
      // (set by `resolve_sticky_language` in klymo_personality.py).
      // null on turns before the first FR signal lands; the frontend
      // falls back to its own regex detection in that case.
      detected_language?: "fr" | "en" | null;
    }
  | { type: "error"; code: string; message: string };

function randomId(): string {
  return (
    globalThis.crypto?.randomUUID?.() ??
    Math.random().toString(36).slice(2) + Date.now().toString(36)
  );
}

/**
 * Fetch the BookingConfirmationCard payload after Plan B (M2-bis)
 * finalises a booking server-side. The chat tab has no open SSE stream
 * at webhook time, so the Realtime morph on `transactions.duffel_order_id`
 * triggers this REST hop.
 *
 * Defensive: a non-200 response is logged-and-swallowed (e.g. 409
 * "ticket_not_ready" can fire if the morph delivers ahead of the
 * persistence write — the next morph will retry). Never throws into
 * the postgres_changes handler, which would tear down the channel.
 */
async function fetchAndAttachBooking(
  tripId: string,
  attach: (booking: BookingDetails) => void,
): Promise<void> {
  try {
    const response = await fetch(
      `/api/trips/${encodeURIComponent(tripId)}/booking-details`,
      { method: "GET", cache: "no-store" },
    );
    if (!response.ok) return;
    const booking = (await response.json()) as BookingDetails;
    attach(booking);
  } catch {
    // Network blips during Realtime are common; the next morph retries.
  }
}

export type UseChatStreamOptions = {
  endpoint?: string;
  /**
   * Dev-only: forward an OrgPolicySettings shape with each request.
   * The backend honors it only when not running in production; in
   * production it's silently dropped. Stored in a ref so changes
   * don't recreate `send` and tear down its in-flight reader.
   */
  devPolicyOverride?: OrgPolicySettings | null;
  /**
   * Dev-only: forward a `Vibe` (neutral | playful) to override the
   * rephraser's voice register for the duration of one chat turn.
   * Honoured outside production OR for team-allowlisted users in
   * production. Same ref pattern as `devPolicyOverride` so swapping
   * the preset mid-conversation kicks in on the next message without
   * tearing down any active stream.
   */
  devVibeOverride?: Vibe | null;
};

export function useChatStream(options: UseChatStreamOptions = {}) {
  const {
    endpoint = "/api/chat",
    devPolicyOverride = null,
    devVibeOverride = null,
  } = options;
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [workflowStage, setWorkflowStage] = useState<string | null>(null);
  // Backend-authoritative sticky language, captured from `event: done`.
  // null until the backend reports a value (first turn before any FR
  // signal, or a turn that didn't go through the language resolver).
  // When set, takes precedence over the frontend's regex fallback —
  // single source of truth aligned with the bot's `phrase()` rephraser.
  const [backendLanguage, setBackendLanguage] = useState<SupportedLanguage | null>(null);
  // Browser/OS language, used as the DEFAULT before the backend or a FR
  // message decides (e.g. the static onboarding welcome, shown before any
  // turn). `useSyncExternalStore` returns the "en" server snapshot during
  // SSR and the real `navigator` value on the client — no hydration
  // mismatch, no setState-in-effect. The value is static at runtime, so
  // `subscribe` is a no-op. The backend's `detected_language` still wins
  // once the user starts chatting.
  const browserLanguage = useSyncExternalStore<SupportedLanguage>(
    () => () => {},
    () => {
      const langs = navigator.languages ?? [navigator.language];
      return langs.some((l) => l.toLowerCase().startsWith("fr")) ? "fr" : "en";
    },
    () => "en",
  );
  // L3-suivi 2 (UI polish) — flips true on `event: typing` and back
  // to false on the next `event: message`. Used by ChatWindow to
  // render a typing indicator BETWEEN consecutive assistant bubbles
  // (the connection-level `isStreaming` flag covers the wait before
  // the FIRST bubble; this is purely intra-turn pacing). Distinct
  // from the streaming flag so it doesn't fight with token-streaming
  // bubble rendering.
  const [isBubblePending, setIsBubblePending] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  // Latest override is read from a ref at send-time so swapping
  // presets mid-conversation kicks in on the next message without
  // restarting any active stream. Synced via useEffect to satisfy the
  // react-hooks/refs rule (mutating refs during render is flagged in
  // React 19's stricter compiler-aware ruleset).
  const devPolicyOverrideRef = useRef<OrgPolicySettings | null>(devPolicyOverride);
  useEffect(() => {
    devPolicyOverrideRef.current = devPolicyOverride;
  }, [devPolicyOverride]);
  // Same ref pattern as devPolicyOverrideRef — swapping the DevPanel
  // voice toggle mid-conversation must kick in on the next message
  // without recreating `send` (which would tear down the in-flight
  // AbortController and reader).
  const devVibeOverrideRef = useRef<Vibe | null>(devVibeOverride);
  useEffect(() => {
    devVibeOverrideRef.current = devVibeOverride;
  }, [devVibeOverride]);

  // Buffer streamed text during selection turns that may end with a
  // booking. Without this, the user sees `select_node` + `checkout_node`
  // tokens stream into a bubble for ~2s and then watches the bubble
  // get nuked when the `event: booking` arrives and the rich card
  // replaces it — a jarring "type then delete" flicker.
  //
  // Strategy (post-2026-05-12 voice rework):
  //   * On send, if the previous turn ended at `awaiting_*_selection`,
  //     we know this turn is the user picking — likely heading to
  //     `checkout_ready` → `completed`. Mark the turn as buffering.
  //   * While buffering, message chunks accumulate in PER-NODE buffers
  //     (`select` vs `checkout`) so the flush logic can treat them
  //     differently. Nothing renders yet — typing-dots fallback in
  //     <ChatWindow> covers the gap.
  //   * When `event: booking` (or `event: checkout_link`) arrives, the
  //     card lands as the assistant message. The select_node text
  //     ("Got it, option 2 at 12:00, locking that in...") is DISCARDED
  //     because it duplicates the card. The checkout_node text (the
  //     warm seed-pool output: "Copy on its way to your inbox. Ready
  //     for next trip?") is flushed as a SEPARATE assistant message
  //     RIGHT AFTER the card. Sequential render = no flicker, and the
  //     conversational close lands where the user can read it.
  //   * When `event: done` arrives WITHOUT a card attached
  //     (round-trip stage 1, blocked option, K1 failure path), the
  //     buffered text is flushed into the existing bubble. Checkout
  //     buffer takes precedence over select (failure messages from
  //     checkout_node matter more than the redundant select ack);
  //     select buffer is used in the round-trip stage-1 case where
  //     only select_node emitted ("Departure locked, pick a return").
  //
  // Refs (not state) so updates inside the streaming loop don't trigger
  // re-renders or fight the React 18+ batched updater.
  const bufferingTurnRef = useRef(false);
  const bufferedSelectTextRef = useRef("");
  const bufferedCheckoutTextRef = useRef("");
  // Fallback bucket for buffered chunks whose node tag isn't in the
  // `select` / `checkout` set. Shouldn't fire under current backend
  // routing (only those two nodes stream during a selection turn), but
  // a future graph that adds, say, a `confirm_email` token stream
  // mid-selection-turn would land here and the flush logic still
  // surfaces the text rather than silently dropping it.
  const bufferedOtherTextRef = useRef("");
  // Mirror of `workflowStage` — read at send-time without putting
  // workflowStage on `send`'s useCallback deps (which would recreate
  // `send` every turn and tear down a fresh AbortController each time).
  const workflowStageRef = useRef<string | null>(null);

  const conversationId = useChatStore((s) => s.conversationId);
  const setConversationId = useChatStore((s) => s.setConversationId);
  const isStreaming = useChatStore((s) => s.isStreaming);
  const setStreaming = useChatStore((s) => s.setStreaming);
  // Mirror of conversationId in a ref so the Realtime handler (and
  // resumeExtras) can read the current value without re-closing over
  // stale state (same ref pattern as workflowStageRef above).
  const conversationIdRef = useRef<string | null>(null);

  // Dedup guard for the pending-approval auto-resume listener (Task 14).
  // Tracks which approval_request IDs have already triggered a
  // resumeApproval call so that React StrictMode double-invocation and
  // HMR effect re-runs don't fire the backend resume twice.
  // MUST be a ref (not state) — using useState here would cause a
  // re-render each time an id is added, which would tear down and
  // re-mount the effect and re-trigger the very fetch we're deduping.
  const firedApprovalResumesRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    workflowStageRef.current = workflowStage;
  }, [workflowStage]);

  useEffect(() => {
    conversationIdRef.current = conversationId;
  }, [conversationId]);

  const appendAssistantChunk = useCallback(
    (content: string, node?: string, messageId?: string) => {
      // Selection-turn tokens go to PER-NODE invisible buffers instead of
      // an on-screen bubble. The booking event (or `done` fallback)
      // decides what becomes visible. Splitting by node lets the flush
      // logic discard the redundant select_node ack ("Got it, option 2")
      // while surfacing the warm checkout_node close ("Copy on its way,
      // ready for next trip?") as a separate bubble after the card.
      // See bufferingTurnRef block above for the full strategy.
      if (bufferingTurnRef.current) {
        if (node === "checkout") {
          bufferedCheckoutTextRef.current += content;
        } else if (node === "select") {
          bufferedSelectTextRef.current += content;
        } else {
          bufferedOtherTextRef.current += content;
        }
        return;
      }
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        // Bubble identity rule (L3-suivi 2):
        //   - If this chunk carries a `messageId` AND the last
        //     assistant message carries the SAME `messageId` → APPEND
        //     (token streaming: each delta extends the bubble).
        //   - If this chunk carries a `messageId` AND it DIFFERS from
        //     the last bubble's `messageId` → PUSH a new bubble. This
        //     is the multi-AIMessage case (e.g. the cancel-continuation
        //     success emits 3 distinct AIMessages, each with its own
        //     id; we want 3 distinct bubbles, not one merged blob).
        //   - If this chunk has NO `messageId` (legacy backend, or
        //     buffered/non-streaming paths) → fall back to the
        //     "same-role → append" rule, preserving existing
        //     behaviour for paths that don't yet send the id.
        if (last?.role === "assistant") {
          const sameBubble =
            messageId !== undefined
              ? last.messageId === messageId
              : last.messageId === undefined;
          if (sameBubble) {
            return [
              ...prev.slice(0, -1),
              {
                ...last,
                content: last.content + content,
                // Latch the id if this is the first chunk that carries
                // one (e.g. legacy bubble created before message_id
                // arrived).
                messageId: last.messageId ?? messageId,
              },
            ];
          }
          // Different id → new bubble.
        }
        return [
          ...prev,
          { id: randomId(), role: "assistant", content, messageId },
        ];
      });
    },
    [],
  );

  const attachOffers = useCallback(
    (
      offers: DisplayedOffer[],
      optionsHeader?: string,
      optionsFooter?: string,
      optionsSelectable?: boolean,
    ) => {
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        if (last?.role === "assistant") {
          // Same turn — augment the assistant message with the structured
          // offers so the renderer can show OptionCards for it. Header /
          // footer come from the backend `phrase()` rephraser when an
          // API key is configured; absent when the rephraser fell back
          // (i18n defaults take over in OptionList).
          return [
            ...prev.slice(0, -1),
            {
              ...last,
              offers,
              optionsHeader,
              optionsFooter,
              optionsSelectable,
            },
          ];
        }
        // Defensive: options arrived without a preceding message
        // (shouldn't happen with the current backend, but if the order
        // ever flips we stash them on a fresh assistant turn so the
        // UI renders cleanly).
        return [
          ...prev,
          {
            id: randomId(),
            role: "assistant",
            content: "",
            offers,
            optionsHeader,
            optionsFooter,
            optionsSelectable,
          },
        ];
      });
    },
    [],
  );

  const markCheckoutPaid = useCallback((tripId: string) => {
    // Patch `paid: true` on the message whose checkoutLink matches.
    // Idempotent — calling repeatedly is a no-op once flagged.
    //
    // Pre-M2-bis (M2 only) this also triggered the Realtime channel
    // teardown by flipping `paid=true` so `pendingTripId` excluded
    // the message. With M2-bis shipped, the channel must stay alive
    // past the paid morph to receive the second UPDATE that carries
    // `duffel_order_id` — `pendingTripId`'s predicate now keys on
    // `!m.booking && !m.checkoutLink.failed` instead.
    setMessages((prev) =>
      prev.map((m) =>
        m.checkoutLink && m.checkoutLink.trip_id === tripId && !m.checkoutLink.paid
          ? { ...m, checkoutLink: { ...m.checkoutLink, paid: true } }
          : m,
      ),
    );
  }, []);

  const markBookingFailed = useCallback((tripId: string) => {
    // Set `failed: true` on the matching checkoutLink. Sole purpose
    // is to release the Realtime channel hold — without this, a
    // post-paid Plan B failure (PR 6 refund safety net flips the
    // transactions row to `refunded`, or the chain returns `failed` /
    // `canceled`) would leave `pendingTripId` non-null forever
    // because no `booking` ever attaches. The chat-side failure UX
    // itself is delivered separately via the SSE error frame from
    // PR #25 — this flag is invisible to the user.
    setMessages((prev) =>
      prev.map((m) =>
        m.checkoutLink && m.checkoutLink.trip_id === tripId && !m.checkoutLink.failed
          ? { ...m, checkoutLink: { ...m.checkoutLink, failed: true } }
          : m,
      ),
    );
  }, []);

  const attachCheckoutLink = useCallback((checkoutLink: CheckoutLinkDetails) => {
    setMessages((prev) => {
      const last = prev[prev.length - 1];
      if (last?.role === "assistant") {
        // Same turn — augment the assistant message so the renderer
        // shows the CheckoutPaymentCard instead of the plain
        // "Click the link..." text bubble.
        return [...prev.slice(0, -1), { ...last, checkoutLink }];
      }
      return [
        ...prev,
        { id: randomId(), role: "assistant", content: "", checkoutLink },
      ];
    });
  }, []);

  const attachBooking = useCallback((booking: BookingDetails) => {
    setMessages((prev) => {
      const last = prev[prev.length - 1];
      if (last?.role === "assistant") {
        // Same turn — augment the assistant message so the renderer
        // shows the BookingConfirmationCard instead of the plain
        // "Booked. Reference STUBXXX" text bubble.
        return [...prev.slice(0, -1), { ...last, booking }];
      }
      // Defensive: booking arrived without a preceding assistant
      // message (shouldn't happen, but a stub or future graph could
      // emit booking before any message).
      return [
        ...prev,
        { id: randomId(), role: "assistant", content: "", booking },
      ];
    });
  }, []);

  const attachCancellation = useCallback((cancellation: CancellationDetails) => {
    setMessages((prev) => {
      const last = prev[prev.length - 1];
      if (last?.role === "assistant") {
        // Same turn as the cancel ack text — augment the assistant
        // message so the renderer shows the CancellationCard instead
        // of (or in addition to) the rephrased text bubble.
        return [...prev.slice(0, -1), { ...last, cancellation }];
      }
      return [
        ...prev,
        { id: randomId(), role: "assistant", content: "", cancellation },
      ];
    });
  }, []);

  const attachOnboarding = useCallback((onboarding: OnboardingDetails) => {
    setMessages((prev) => {
      const last = prev[prev.length - 1];
      if (last?.role === "assistant") {
        // Same turn as the rephrased "add a payment method" text —
        // augment the assistant message so the renderer shows the
        // OnboardingCard with the CTA button. Same shape as the
        // attach* siblings; the card visually replaces the link-in-
        // text bubble.
        return [...prev.slice(0, -1), { ...last, onboarding }];
      }
      return [
        ...prev,
        { id: randomId(), role: "assistant", content: "", onboarding },
      ];
    });
  }, []);

  // Phase 6 — attach the ApprovalPendingCard to the last assistant
  // message when `event: approval_required` arrives. Mirrors the
  // `attachBooking` / `attachCancellation` / `attachOnboarding`
  // siblings: same-turn text bubble is augmented in place; if no
  // prior assistant message exists a card-only message is created.
  const attachApprovalRequest = useCallback(
    (approvalRequest: ApprovalRequestDetails) => {
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        if (last?.role === "assistant") {
          // Same turn as the "Your manager has been notified…" text —
          // augment so the renderer shows ApprovalPendingCard in addition
          // to (or instead of) the plain text bubble.
          return [...prev.slice(0, -1), { ...last, approvalRequest }];
        }
        return [
          ...prev,
          { id: randomId(), role: "assistant", content: "", approvalRequest },
        ];
      });
    },
    [],
  );

  // Realtime morph for the OnboardingCard — pairs with `markCheckoutPaid`
  // (M2-H3) but on the onboarding flow. Walks `messages` backwards to
  // find the most recent message carrying an `OnboardingDetails`
  // attachment and flips `completed=true` on it. The card's render
  // path then switches to the green "Payment method saved" state.
  //
  // No-op if no onboarding message is found (e.g. the chat state was
  // reset between subscription and event). The Realtime subscription
  // already guards against double-fires via the once-per-user ref;
  // this is a defensive shape, not a correctness gate.
  const markOnboardingComplete = useCallback(() => {
    setMessages((prev) => {
      for (let i = prev.length - 1; i >= 0; i--) {
        const m = prev[i];
        // `prev[i]` is typed as `ChatMessage | undefined` under
        // noUncheckedIndexedAccess; the loop bounds guarantee it's
        // defined but TypeScript can't narrow that.
        if (!m || !m.onboarding || m.onboarding.completed) continue;
        const morphed: ChatMessage = {
          ...m,
          onboarding: { ...m.onboarding, completed: true },
        };
        return [...prev.slice(0, i), morphed, ...prev.slice(i + 1)];
      }
      return prev;
    });
  }, []);

  /**
   * Fire-and-forget resume after any booking confirmation (K1 auto-charge
   * and Plan B Realtime path). Calls `POST /api/chat/resume-extras` which
   * proxies to the backend `POST /chat/resume-extras`.
   *
   * Responses:
   *   204 — nothing to fire (no pending extras intent, or already applied).
   *         Silent no-op. Booking is the primary success event; extras are
   *         an optional follow-up.
   *   200 — backend fired the extras turn; stream the SSE response into the
   *         message buffer using the same parseSseFrame + state-update logic
   *         as send().
   *   Other — silent failure (warn only). The booking is already confirmed;
   *            degraded extras UX is acceptable.
   *
   * Called with a 300 ms delay so the BookingConfirmationCard renders first
   * and the extras catalogue bubble follows naturally.
   */
  const resumeExtras = useCallback(
    async (convId: string) => {
      const controller = new AbortController();

      try {
        const response = await fetch("/api/chat/resume-extras", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ conversation_id: convId }),
          signal: controller.signal,
        });

        // 204: no extras intent pending — silent no-op.
        if (response.status === 204) {
          return;
        }

        // Non-success: degrade silently (booking is confirmed).
        if (!response.ok || !response.body) {
          console.warn(`[resumeExtras] backend returned ${response.status}`);
          return;
        }

        // 200 OK: pipe the SSE stream into the message buffer.
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const parts = buffer.split("\n\n");
          buffer = parts.pop() ?? "";
          for (const part of parts) {
            const event = parseSseFrame(part);
            if (!event) continue;
            switch (event.type) {
              case "start":
                // A resume turn may mint a new conversation_id; update
                // the store so subsequent sends use the same thread.
                setConversationId(event.conversation_id);
                break;
              case "message":
                setIsBubblePending(false);
                appendAssistantChunk(event.content, event.node, event.message_id);
                break;
              case "typing":
                setIsBubblePending(true);
                break;
              case "done":
                setConversationId(event.conversation_id);
                if (event.workflow_stage) {
                  setWorkflowStage(event.workflow_stage);
                }
                if (event.detected_language === "fr" || event.detected_language === "en") {
                  setBackendLanguage(event.detected_language);
                }
                setIsBubblePending(false);
                break;
              case "error":
                // Degrade silently — extras failure doesn't affect the
                // confirmed booking.
                console.warn("[resumeExtras] SSE error frame:", event.message);
                setIsBubblePending(false);
                break;
              default:
                // Booking / checkout_link / cancellation / options are
                // not expected from resume-extras, but ignore safely.
                break;
            }
          }
        }
      } catch (error) {
        // Network errors / aborts: silent (booking is confirmed).
        console.warn("[resumeExtras] error:", error);
      }
    },
    [appendAssistantChunk, setConversationId],
  );

  /**
   * Task 14 — re-enter the approval_required graph node for a conversation
   * where the manager has already decided (approved / rejected / expired).
   *
   * Called automatically on chat mount when /me/pending-approvals returns
   * a row with status !== "pending". Mirrors resumeExtras exactly: same
   * SSE consumption, same appendAssistantChunk callbacks. No booking /
   * extras-specific side effects — the approval_required node emits a
   * text bubble (extras prompt for approved, polite-cancel for rejected).
   *
   * Dedup: the caller guards with firedApprovalResumesRef so this function
   * is only invoked once per approval_request_id per page lifetime.
   */
  const resumeApproval = useCallback(
    async (convId: string) => {
      const controller = new AbortController();

      try {
        const response = await fetch("/api/chat/resume-approval", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ conversation_id: convId }),
          signal: controller.signal,
        });

        // 204: nothing to resume (graph not parked at awaiting_approval,
        // or decision already consumed) — silent no-op.
        if (response.status === 204) {
          return;
        }

        // Non-success: degrade silently (manager already decided; the
        // Realtime hook from Task 13 has already morphed the card).
        if (!response.ok || !response.body) {
          console.warn(`[resumeApproval] backend returned ${response.status}`);
          return;
        }

        // 200 OK: pipe the SSE stream into the message buffer.
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const parts = buffer.split("\n\n");
          buffer = parts.pop() ?? "";
          for (const part of parts) {
            const event = parseSseFrame(part);
            if (!event) continue;
            switch (event.type) {
              case "start":
                // A resume turn may update the conversation_id; keep
                // the store in sync so subsequent sends use the right thread.
                setConversationId(event.conversation_id);
                break;
              case "message":
                setIsBubblePending(false);
                appendAssistantChunk(event.content, event.node, event.message_id);
                break;
              case "typing":
                setIsBubblePending(true);
                break;
              case "done":
                setConversationId(event.conversation_id);
                if (event.workflow_stage) {
                  setWorkflowStage(event.workflow_stage);
                }
                if (event.detected_language === "fr" || event.detected_language === "en") {
                  setBackendLanguage(event.detected_language);
                }
                setIsBubblePending(false);
                break;
              case "error":
                // Degrade silently — the Realtime card morph (Task 13)
                // already surfaced the decision visually.
                console.warn("[resumeApproval] SSE error frame:", event.message);
                setIsBubblePending(false);
                break;
              default:
                // booking / checkout_link / options are not expected from
                // resume-approval — ignore safely.
                break;
            }
          }
        }
      } catch (error) {
        // Network errors / aborts: silent (the Realtime morph already
        // surfaced the decision; the resume bubble is best-effort).
        console.warn("[resumeApproval] error:", error);
      }
    },
    [appendAssistantChunk, setConversationId],
  );

  /**
   * Task 7 — cancel a parked checkout (payment_pending) and consume the
   * resulting SSE stream so the conversation re-enables and the bot
   * delivers a cancellation acknowledgement bubble.
   *
   * Thin sibling of resumeApproval — same SSE pipe, different endpoint.
   */
  const cancelCheckout = useCallback(
    async (convId: string) => {
      const controller = new AbortController();
      try {
        const response = await fetch("/api/chat/cancel-checkout", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ conversation_id: convId }),
          signal: controller.signal,
        });
        if (response.status === 204) return;
        if (!response.ok || !response.body) {
          console.warn(`[cancelCheckout] backend returned ${response.status}`);
          return;
        }
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const parts = buffer.split("\n\n");
          buffer = parts.pop() ?? "";
          for (const part of parts) {
            const event = parseSseFrame(part);
            if (!event) continue;
            switch (event.type) {
              case "message":
                setIsBubblePending(false);
                appendAssistantChunk(event.content, event.node, event.message_id);
                break;
              case "done":
                if (event.conversation_id) setConversationId(event.conversation_id);
                if (event.workflow_stage) setWorkflowStage(event.workflow_stage);
                setIsBubblePending(false);
                break;
              case "error":
                console.warn("[cancelCheckout] SSE error frame:", event.message);
                setIsBubblePending(false);
                break;
              default:
                break;
            }
          }
        }
      } catch (error) {
        console.warn("[cancelCheckout] error:", error);
      }
    },
    [appendAssistantChunk, setConversationId],
  );

  /**
   * Task 14 — check /me/pending-approvals and auto-dispatch
   * /chat/resume-approval for any approval row that was decided while the
   * user was offline.
   *
   * LOAD-BEARING CASE: the user was OFFLINE when the manager decided.
   * Realtime (Task 13) never delivered the UPDATE, so the ApprovalPendingCard
   * still shows "pending". This poll catches the gap and resumes the
   * conversation from the approval_required graph node.
   *
   * When the user IS online, both paths fire in parallel:
   *   - Realtime (Task 13) morphs the card instantly (visual).
   *   - This call fires resumeApproval → backend emits the next bubble (text).
   * No conflict — they update different pieces of UI.
   *
   * The firedApprovalResumesRef dedup set prevents double-firing across React
   * StrictMode double-invocations and HMR re-mounts.
   *
   * USAGE: the consuming component calls this once on mount:
   *   ```tsx
   *   const { checkPendingApprovals } = useChatStream();
   *   useEffect(() => { void checkPendingApprovals(); }, [checkPendingApprovals]);
   *   ```
   */
  const checkPendingApprovals = useCallback(async () => {
    try {
      const response = await fetch("/api/me/pending-approvals");
      if (!response.ok) return;
      const approvals = (await response.json()) as Array<{
        id: string;
        conversation_id: string | null;
        status: ApprovalStatus;
        decided_at?: string | null;
      }>;
      for (const approval of approvals) {
        // Only fire for decided rows — pending rows are still waiting.
        if (approval.status === "pending") continue;
        // Guard: conversation_id is UUID | None on the backend schema.
        // A null value means there is no thread to resume yet — skip
        // it rather than polluting the dedup set with an un-resumable id.
        if (!approval.conversation_id) continue;
        // Skip if we've already fired for this approval in this session.
        if (firedApprovalResumesRef.current.has(approval.id)) continue;
        firedApprovalResumesRef.current.add(approval.id);
        void resumeApproval(approval.conversation_id);
      }
    } catch (error) {
      console.warn("[pending-approvals] error:", error);
    }
  }, [resumeApproval]);

  // M2-H3 — auto-morph the CheckoutPaymentCard from "pending" to
  // "paid" when the Stripe webhook fires. We subscribe to Supabase
  // Realtime on `public.transactions` filtered by the most recent
  // un-paid checkout's trip_id. RLS (server-side) restricts payload
  // delivery to rows the user owns, so we don't need extra filters.
  //
  // `useMemo` lets React Compiler / hook deps observe the trip_id
  // without re-running the imperative `findLast` on every render
  // unrelated to messages.
  // Keep the Realtime channel alive until the booking is finalised one
  // way or the other. Two terminal states:
  //
  //   * Success — `m.booking` attaches once the M2-bis post-Checkout
  //     chain writes `transactions.duffel_order_id` and the second
  //     Realtime UPDATE triggers our fetch.
  //   * Failure — `m.checkoutLink.failed` flips when the chain refunds
  //     / fails / cancels (transactions.status terminal value).
  //
  // Pre-M2-bis this used `!m.checkoutLink.paid`, which tore the channel
  // down on the FIRST UPDATE (status='paid'). Since the M2-bis chain
  // writes `duffel_order_id` in a SECOND UPDATE ~5–20s later, that
  // event was firing into a dead channel and the BookingConfirmationCard
  // never hydrated.
  const pendingTripId = useMemo(
    () =>
      messages.findLast(
        (m) => m.checkoutLink && !m.booking && !m.checkoutLink.failed,
      )?.checkoutLink?.trip_id ?? null,
    [messages],
  );

  useEffect(() => {
    if (!pendingTripId) return;
    const supabase = createSupabaseBrowserClient();

    // Explicitly hydrate the user's JWT into the Realtime client
    // BEFORE `.subscribe()` runs. `@supabase/ssr`'s createBrowserClient
    // reads cookies lazily — the auth listener auto-wire that calls
    // `realtime.setAuth(token)` only fires once `getSession()` /
    // `getUser()` is invoked. Without this `await`, the very first
    // subscribe registers in `realtime.subscription` with
    // `claims_role = 'anon'`, and our RLS policy (which is `to
    // authenticated`) silently filters out every postgres_changes
    // event on UPDATE.
    //
    // The async-IIFE pattern requires a `cancelled` flag: if
    // pendingTripId changes (or the component unmounts) while
    // getSession is in flight, we must NOT subscribe — otherwise
    // the cleanup function above runs before `channel` is assigned
    // and we leak a subscription.
    let cancelled = false;
    let channel: ReturnType<typeof supabase.channel> | null = null;

    void (async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (cancelled) return;
      if (session) {
        supabase.realtime.setAuth(session.access_token);
      }
      channel = supabase
        .channel(`txn-${pendingTripId}`)
        .on(
          "postgres_changes",
          {
            event: "UPDATE",
            schema: "public",
            table: "transactions",
            filter: `trip_id=eq.${pendingTripId}`,
          },
          (payload: { new: Record<string, unknown> }) => {
            const next = payload.new as {
              status?: string;
              duffel_order_id?: string | null;
            };
            if (next.status === "paid") {
              markCheckoutPaid(pendingTripId);
              // Payment landed → leave payment_pending so the hard-block on the
              // chat input lifts (the block is keyed on workflowStage==="payment_pending").
              setWorkflowStage("completed");
            }
            // M2-bis Plan B hydration — when the post-Checkout chain
            // succeeds, the webhook handler writes `duffel_order_id`
            // (UPDATE with `IS NULL` guard, so this fires exactly once
            // per booking even if Stripe retries the webhook). Fetch
            // the BookingConfirmationCard payload and morph the chat
            // message in-place so the user sees PNR + flight legs +
            // PDF download without a refresh.
            if (next.duffel_order_id) {
              void fetchAndAttachBooking(pendingTripId, attachBooking);
              // Auto-trigger extras-resume after Plan B booking confirmation,
              // mirroring the K1 SSE path. 300 ms delay lets the
              // BookingConfirmationCard morph render first.
              const convIdAtBooking = conversationIdRef.current;
              if (convIdAtBooking) {
                setTimeout(() => {
                  void resumeExtras(convIdAtBooking);
                }, 300);
              }
            }
            // Plan B can also END with PR 6's refund safety net or a
            // J4/J5 chain failure — `transactions.status` flips to a
            // terminal non-success value. Release the channel hold so
            // we don't keep listening forever waiting for a booking
            // that will never come.
            if (
              next.status === "refunded" ||
              next.status === "failed" ||
              next.status === "canceled"
            ) {
              markBookingFailed(pendingTripId);
              // Post-payment failure must also lift the hard-block so the
              // user isn't stuck with a disabled input. Use a non-blocking
              // conversational stage rather than "completed".
              setWorkflowStage("pending_info");
            }
          },
        )
        .subscribe();
      // The unmount could have happened during `await` — clean up
      // the channel we just created if so.
      if (cancelled && channel) {
        void supabase.removeChannel(channel);
        channel = null;
      }
    })();

    return () => {
      cancelled = true;
      // Fire-and-forget — React's cleanup must be sync; the underlying
      // websocket close runs async on the supabase-js side.
      if (channel) void supabase.removeChannel(channel);
    };
  }, [pendingTripId, markCheckoutPaid, attachBooking, markBookingFailed, resumeExtras]);

  const send = useCallback(
    async (userText: string, options: { silent?: boolean } = {}) => {
      if (!userText.trim() || isStreaming) return;

      // `silent` skips the optimistic user-message append for system-
      // triggered turns (e.g. onboarding Realtime resume) where the
      // user didn't actually type anything. The assistant response
      // still streams normally. Used by the public-API
      // `triggerOnboardingResume` below.
      if (!options.silent) {
        const userMsg: ChatMessage = { id: randomId(), role: "user", content: userText };
        setMessages((prev) => [...prev, userMsg]);
      }
      setError(null);
      setStreaming(true);

      // Selection turns may end with a successful booking → buffer the
      // streamed text so the rich card doesn't replace visible text
      // mid-flight (jarring "type then delete" flicker).
      const stage = workflowStageRef.current;
      bufferingTurnRef.current =
        stage === "awaiting_departure_selection" ||
        stage === "awaiting_return_selection";
      bufferedSelectTextRef.current = "";
      bufferedCheckoutTextRef.current = "";
      bufferedOtherTextRef.current = "";

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "text/event-stream",
          },
          body: JSON.stringify({
            message: userText,
            conversation_id: conversationId,
            // Only included when set — keeps prod requests free of
            // dev-only fields, and the backend ignores it anyway when
            // settings.is_production is True.
            ...(devPolicyOverrideRef.current !== null
              ? { dev_policy_override: devPolicyOverrideRef.current }
              : {}),
            ...(devVibeOverrideRef.current !== null
              ? { dev_vibe_override: devVibeOverrideRef.current }
              : {}),
          }),
          signal: controller.signal,
        });

        // Backend gates company users without an org behind the pro-onboarding form.
        // Treat HTTP 403 + code='company_onboarding_required' as a hard navigation —
        // this can happen if the user reaches /chat via a stale tab, a deep link,
        // or before the server-side guard in app/chat/page.tsx kicks in.
        // Hard navigation (window.location.assign) — not router.push — is intentional:
        // drops in-flight SSE/Realtime subs and forces the form page's Server Component
        // to re-run its auth+state guard against fresh /me data.
        if (response.status === 403) {
          try {
            const body = (await response.clone().json()) as { code?: string };
            if (body.code === "company_onboarding_required") {
              window.location.assign("/onboarding/company-profile");
              return;
            }
          } catch {
            // Body wasn't JSON — fall through to normal error handling.
          }
        }

        if (!response.ok || !response.body) {
          throw new Error(`Chat stream failed: ${response.status}`);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        // Track the active conversation_id locally within this turn's stream
        // loop so we can pass it to resumeExtras when `event: booking` fires.
        // `conversationId` from the closure may be null on the very first send
        // (it's set by `event: start`, but the closure holds the pre-render
        // value). `currentConversationId` is updated synchronously from the
        // stream so resumeExtras always uses the correct thread id.
        let currentConversationId: string | null = conversationId;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const parts = buffer.split("\n\n");
          buffer = parts.pop() ?? "";

          for (const part of parts) {
            const event = parseSseFrame(part);
            if (!event) continue;

            switch (event.type) {
              case "start":
                setConversationId(event.conversation_id);
                currentConversationId = event.conversation_id;
                break;
              case "message":
                // Clear the between-bubbles typing indicator the
                // moment the next bubble's content starts arriving.
                setIsBubblePending(false);
                appendAssistantChunk(event.content, event.node, event.message_id);
                break;
              case "typing":
                // Backend paced a gap between consecutive bubbles
                // within this turn. Show the typing indicator until
                // the next `event: message` arrives.
                setIsBubblePending(true);
                break;
              case "options":
                attachOffers(
                  event.offers,
                  event.header,
                  event.footer,
                  event.selectable,
                );
                break;
              case "booking":
                attachBooking({
                  trip_id: event.trip_id,
                  booking_reference: event.booking_reference,
                  passenger_name: event.passenger_name,
                  amount_cents: event.amount_cents,
                  currency: event.currency,
                  legs: event.legs,
                  total_duration_minutes: event.total_duration_minutes,
                });
                // Auto-trigger the extras-resume endpoint after booking
                // confirmation. 300 ms delay lets the BookingConfirmationCard
                // render first; the extras catalogue bubble follows naturally.
                // `void` silences the floating-promise lint rule — resumeExtras
                // degrades silently on any failure (booking is already confirmed).
                // `currentConversationId` is preferred over the closure's
                // `conversationId` because the latter is null on the first
                // send (before any done frame updates the store + re-render).
                if (currentConversationId) {
                  const convIdAtBooking = currentConversationId;
                  setTimeout(() => {
                    void resumeExtras(convIdAtBooking);
                  }, 300);
                }
                break;
              case "checkout_link":
                attachCheckoutLink({
                  trip_id: event.trip_id,
                  checkout_url: event.checkout_url,
                  amount_cents: event.amount_cents,
                  currency: event.currency,
                });
                break;
              case "onboarding_redirect":
                attachOnboarding({
                  url: event.url,
                  company_name: event.company_name,
                });
                break;
              case "cancellation":
                attachCancellation({
                  trip_id: event.trip_id,
                  booking_reference: event.booking_reference,
                  refund_id: event.refund_id,
                  amount_cents: event.amount_cents,
                  currency: event.currency,
                });
                break;
              case "approval_required":
                attachApprovalRequest({
                  id: event.id,
                  total: event.total,
                  currency: event.currency,
                  expires_at: event.expires_at,
                  approver_emails: event.approver_emails,
                  policy_reason: event.policy_reason,
                  status: event.status,
                  decision_reason: event.decision_reason,
                  decided_at: event.decided_at,
                  decided_by_first_name: event.decided_by_first_name,
                });
                break;
              case "done":
                setConversationId(event.conversation_id);
                currentConversationId = event.conversation_id;
                setWorkflowStage(event.workflow_stage);
                // Capture the backend's sticky language if surfaced.
                // Stays unchanged otherwise so a later turn that the
                // backend couldn't classify doesn't flip the UI back
                // to fallback semantics.
                if (event.detected_language === "fr" || event.detected_language === "en") {
                  setBackendLanguage(event.detected_language);
                }
                // Clear any lingering between-bubbles typing indicator
                // — the turn is over, no more bubbles are coming.
                setIsBubblePending(false);
                // Flush per-node buffers if this was a buffered turn.
                // Two cases:
                //   1. A card landed (booking or checkout_link) — flush
                //      ONLY the checkout_node text as a NEW assistant
                //      message right after the card. Drop the
                //      select_node ack ("Got it, option 2 at 12:00…")
                //      since the card already says all that.
                //   2. No card landed — flush each non-empty buffer as
                //      its OWN distinct bubble in node order
                //      (select → extras/other → checkout). Pre-PR-63
                //      this used to be a priority OR-chain
                //      (`checkout || select || other`) picking ONE,
                //      because only one buffer was ever non-empty on a
                //      no-card turn. After PR-63 inserted extras_node
                //      between select and checkout, the SAME no-card
                //      turn can fill TWO buffers (select_node ack +
                //      extras_node prompt) and dropping either is the
                //      bug we're fixing here: live 2026-05-19, the
                //      extras prompt 'Autre chose pour ce voyage ?'
                //      was silently dropped because selectText took
                //      priority. Each non-empty buffer is its own
                //      bubble for natural multi-bubble reading order.
                if (bufferingTurnRef.current) {
                  const checkoutText = bufferedCheckoutTextRef.current;
                  const selectText = bufferedSelectTextRef.current;
                  const otherText = bufferedOtherTextRef.current;
                  bufferingTurnRef.current = false;
                  bufferedCheckoutTextRef.current = "";
                  bufferedSelectTextRef.current = "";
                  bufferedOtherTextRef.current = "";
                  setMessages((prev) => {
                    const last = prev[prev.length - 1];
                    const hasCard =
                      last?.role === "assistant" && (last.booking || last.checkoutLink);
                    // Case 1 — a card landed. Append checkout text as
                    // a fresh bubble BELOW the card. Card stays the
                    // headline, bubble carries the bot's conversational
                    // close (warm seed-pool output: "Copy on its way,
                    // ready for next trip?"). select_node text is
                    // dropped — it's redundant with the card.
                    if (hasCard) {
                      if (checkoutText) {
                        return [
                          ...prev,
                          { id: randomId(), role: "assistant", content: checkoutText },
                        ];
                      }
                      return prev;
                    }
                    // Case 2 — no card. Surface each non-empty buffer
                    // as its own distinct bubble in node order. Order
                    // matches the SSE arrival order on a typical
                    // select→extras turn: select_node ack first
                    // ('Nickel, option 1...'), extras_node prompt
                    // second ('Autre chose pour ce voyage ?'). The
                    // checkout buffer only reaches this branch on the
                    // K1-failure no-card path; it lands last as the
                    // bot's final word ('Hmm, your card was
                    // declined.'). Empty buffers are skipped.
                    const bubbleTexts = [
                      selectText,
                      otherText,
                      checkoutText,
                    ].filter((text) => text.trim() !== "");
                    if (bubbleTexts.length === 0) return prev;
                    const newBubbles: ChatMessage[] = bubbleTexts.map((text) => ({
                      id: randomId(),
                      role: "assistant",
                      content: text,
                    }));
                    return [...prev, ...newBubbles];
                  });
                }
                break;
              case "error":
                setError(event.message);
                setIsBubblePending(false);
                break;
            }
          }
        }
      } catch (e) {
        if ((e as Error).name === "AbortError") return;
        setError((e as Error).message);
      } finally {
        setStreaming(false);
        // Belt-and-suspenders: ensure the between-bubbles typing
        // indicator never sticks past an aborted / errored turn.
        setIsBubblePending(false);
        abortRef.current = null;
      }
    },
    [
      endpoint,
      conversationId,
      isStreaming,
      setConversationId,
      setStreaming,
      appendAssistantChunk,
      attachOffers,
      attachBooking,
      attachCheckoutLink,
      attachCancellation,
      attachOnboarding,
      attachApprovalRequest,
      resumeExtras,
    ],
  );

  // PR-Polish phase-4 — auto-resume onboarding once the Stripe
  // SetupIntent webhook flips `users.stripe_payment_method_id`.
  //
  // Without this, the user completes card setup in a separate tab
  // (OnboardingCard CTA `target="_blank"`) and the chat tab stays
  // parked at `onboarding_payment_redirect` until the user manually
  // types something — at which point the backend's polling
  // completion check fires. That works but it's bad UX: the user
  // expects "card saved → conversation continues" without having
  // to nudge the bot.
  //
  // The subscription mirrors the M2-H3 pattern above (Realtime on
  // `public.transactions`) but on `public.users` instead, filtered
  // by the authenticated user's id, and only mounted while the
  // workflow is parked at the redirect stage. The "tick" is a
  // silent send of a sentinel message that the backend's onboarding
  // node treats as any other turn (the handler doesn't use message
  // content — it polls the DB). After the turn, the workflow
  // transitions to `draft` and the bot emits "Welcome aboard" as a
  // normal AIMessage which streams into the chat.
  //
  // Ref guard prevents double-firing if Realtime delivers multiple
  // UPDATEs in a short window (e.g. a second webhook attempt).
  const resumedOnboardingForUserRef = useRef<string | null>(null);
  // Mount the resume subscription whenever an onboarding card is shown-but-
  // not-yet-saved — regardless of stage — so a card saved AFTER the offer
  // turn (e.g. mid-trip-flow) still morphs the widget. The resume *turn*
  // stays gated to the offer/redirect stages (below).
  const hasPendingOnboardingCard = messages.some(
    (m) => m.onboarding != null && !m.onboarding.completed,
  );
  useEffect(() => {
    if (!hasPendingOnboardingCard) return;
    const supabase = createSupabaseBrowserClient();

    let cancelled = false;
    let channel: ReturnType<typeof supabase.channel> | null = null;

    void (async () => {
      // Same JWT-hydration dance as the M2-H3 effect above —
      // necessary because RLS on `public.users` is `to authenticated`.
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (cancelled || !session) return;
      // Defensive: the session shape can vary across @supabase/ssr
      // versions and is mocked thinly in tests (no `user` field).
      // Bail quietly if the id is missing rather than throwing in
      // an effect (which would surface as an unhandled rejection).
      const userId = session.user?.id;
      if (!userId) return;
      supabase.realtime.setAuth(session.access_token);

      channel = supabase
        .channel(`onboarding-resume-${userId}`)
        .on(
          "postgres_changes",
          {
            event: "UPDATE",
            schema: "public",
            table: "users",
            filter: `id=eq.${userId}`,
          },
          (payload: { new: Record<string, unknown> }) => {
            const next = payload.new as {
              stripe_payment_method_id?: string | null;
            };
            const pmId = next.stripe_payment_method_id;
            if (typeof pmId !== "string" || !pmId.trim()) return;
            // Guard: only fire once per user. A second webhook
            // attempt (Stripe retries on 5xx) would otherwise
            // duplicate the resume turn.
            if (resumedOnboardingForUserRef.current === userId) return;
            resumedOnboardingForUserRef.current = userId;
            // Always morph the card to its "saved" state (stage-agnostic) so a
            // late save — e.g. after the user moved on to the trip flow — still
            // updates the widget in history.
            markOnboardingComplete();
            // Resume conversation turn ONLY at the offer/redirect stages —
            // injecting it mid-trip-flow would derail an active conversation.
            // Read the live stage via the ref so stage changes don't
            // re-subscribe this effect.
            if (
              workflowStageRef.current === "onboarding_payment_redirect" ||
              workflowStageRef.current === "onboarding_card_offer"
            ) {
              void send("__klymo_onboarding_resume__", { silent: true });
            }
          },
        )
        .subscribe();
      if (cancelled && channel) {
        void supabase.removeChannel(channel);
        channel = null;
      }
    })();

    return () => {
      cancelled = true;
      if (channel) void supabase.removeChannel(channel);
    };
  }, [hasPendingOnboardingCard, send, markOnboardingComplete]);

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    setMessages([]);
    setError(null);
    setWorkflowStage(null);
    setBackendLanguage(null);
    // Clear the once-per-user guard so a fresh onboarding cycle in
    // the same tab can re-fire the Realtime resume.
    resumedOnboardingForUserRef.current = null;
    // Clear the approval-resume dedup set so a conversation reset
    // allows the next checkPendingApprovals() call to re-fire for
    // any rows it previously processed (in case the user starts a
    // new session with the same approval ids still present).
    firedApprovalResumesRef.current.clear();
    useChatStore.getState().resetConversation();
  }, []);

  // Resolved language with the backend as source of truth:
  //   1. If the backend has surfaced `detected_language` via `event:
  //      done`, use it. That's the same sticky value the bot's
  //      `phrase()` rephraser used — single source of truth.
  //   2. Otherwise (first turn before any done frame, or the backend
  //      never set the value), fall back to a regex scan over the
  //      whole conversation. Once FR is observed anywhere it stays.
  //      This is a heuristic that drifts slightly from the backend
  //      (the frontend regex may not catch every word the backend's
  //      LLM-rephraser would) but it's the best we can do before the
  //      first done frame arrives.
  //
  // Pre-fix bug (2026-05-19): only the most recent user message was
  // scanned AND the regex missed common greetings ("bonjour"), so a
  // user opening with "bonjour" → "Harold" rendered the
  // OnboardingCard in English. Backend-sourced language closes the
  // gap because the bot's own sticky-language decision is what we
  // surface.
  const language: SupportedLanguage =
    backendLanguage ??
    (messages.some(
      (m) => m.role === "user" && detectLanguage(m.content) === "fr",
    )
      ? "fr"
      : browserLanguage);

  return {
    messages,
    error,
    isStreaming,
    isBubblePending,
    send,
    stop,
    reset,
    resumeExtras,
    checkPendingApprovals,
    resumeApproval,
    cancelCheckout,
    language,
    workflowStage,
  };
}

function parseSseFrame(raw: string): ServerEvent | null {
  const lines = raw.trim().split("\n");
  let eventName = "message";
  let dataRaw = "";
  for (const line of lines) {
    if (line.startsWith("event:")) eventName = line.slice(6).trim();
    else if (line.startsWith("data:")) dataRaw = line.slice(5).trim();
  }
  if (!dataRaw) return null;
  try {
    const payload = JSON.parse(dataRaw);
    return { type: eventName as ServerEvent["type"], ...payload };
  } catch {
    return null;
  }
}
