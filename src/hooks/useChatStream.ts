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

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
      node?: string;
    }
  | { type: "booking"; trip_id: string; booking_reference: string; passenger_name: string; amount_cents: number; currency: string; legs: BookingLeg[] }
  | { type: "checkout_link"; trip_id: string; checkout_url: string; amount_cents: number; currency: string }
  | {
      type: "cancellation";
      trip_id: string;
      booking_reference: string;
      refund_id: string;
      amount_cents: number;
      currency: string;
    }
  | { type: "done"; workflow_stage: string | null; conversation_id: string }
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

  useEffect(() => {
    workflowStageRef.current = workflowStage;
  }, [workflowStage]);

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
            { ...last, offers, optionsHeader, optionsFooter },
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
  }, [pendingTripId, markCheckoutPaid, attachBooking, markBookingFailed]);

  const send = useCallback(
    async (userText: string) => {
      if (!userText.trim() || isStreaming) return;

      const userMsg: ChatMessage = { id: randomId(), role: "user", content: userText };
      setMessages((prev) => [...prev, userMsg]);
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

        if (!response.ok || !response.body) {
          throw new Error(`Chat stream failed: ${response.status}`);
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
              case "start":
                setConversationId(event.conversation_id);
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
                attachOffers(event.offers, event.header, event.footer);
                break;
              case "booking":
                attachBooking({
                  trip_id: event.trip_id,
                  booking_reference: event.booking_reference,
                  passenger_name: event.passenger_name,
                  amount_cents: event.amount_cents,
                  currency: event.currency,
                  legs: event.legs,
                });
                break;
              case "checkout_link":
                attachCheckoutLink({
                  trip_id: event.trip_id,
                  checkout_url: event.checkout_url,
                  amount_cents: event.amount_cents,
                  currency: event.currency,
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
              case "done":
                setConversationId(event.conversation_id);
                setWorkflowStage(event.workflow_stage);
                // Clear any lingering between-bubbles typing indicator
                // — the turn is over, no more bubbles are coming.
                setIsBubblePending(false);
                // Flush per-node buffers if this was a buffered turn.
                // Three cases handled below:
                //   1. A card landed (booking or checkout_link) — flush
                //      ONLY the checkout_node text as a NEW assistant
                //      message right after the card. Drop the
                //      select_node ack ("Got it, option 2 at 12:00…")
                //      since the card already says all that.
                //   2. No card landed AND we have checkout_node text
                //      (K1 failure path: "Hmm, your card was
                //      declined…") — flush that into the existing
                //      bubble. Failure messages from checkout matter
                //      more than the duplicate select ack.
                //   3. No card landed AND we only have select_node
                //      text (round-trip stage 1: "Got the 8:00 flight,
                //      now pick a return") — flush that into the
                //      existing bubble.
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
                    // Cases 2 + 3 — no card. Prefer checkout > select
                    // > other so failure messages and stage-2 prompts
                    // surface cleanly. Concatenated into the last
                    // assistant bubble if present, else new bubble.
                    const content = checkoutText || selectText || otherText;
                    if (!content) return prev;
                    if (last?.role === "assistant") {
                      return [
                        ...prev.slice(0, -1),
                        { ...last, content: last.content + content },
                      ];
                    }
                    return [
                      ...prev,
                      { id: randomId(), role: "assistant", content },
                    ];
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
    ],
  );

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    setMessages([]);
    setError(null);
    setWorkflowStage(null);
    useChatStore.getState().resetConversation();
  }, []);

  // Detect the language from the most recent user message so the
  // static UI labels (OptionList header/footer, OptionCard badges)
  // can be rendered in FR or EN. The bot's conversational text is
  // localised by the backend's phrase() helper; this is just for
  // hardcoded React-rendered strings that don't go through it.
  //
  // No manual `useMemo`: React Compiler (Next 16+) auto-memoizes
  // pure derivations of inputs, and the previous imperative
  // for-loop-with-early-return blocked compiler analysis
  // (react-hooks/preserve-manual-memoization).
  const lastUserMessage = messages.findLast((m) => m.role === "user");
  const language: SupportedLanguage = lastUserMessage
    ? detectLanguage(lastUserMessage.content)
    : "en";

  return {
    messages,
    error,
    isStreaming,
    isBubblePending,
    send,
    stop,
    reset,
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
