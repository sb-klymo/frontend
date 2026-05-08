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
};

type ServerEvent =
  | { type: "start"; conversation_id: string }
  | { type: "message"; content: string; node?: string }
  | { type: "options"; offers: DisplayedOffer[]; node?: string }
  | { type: "booking"; trip_id: string; booking_reference: string; passenger_name: string; amount_cents: number; currency: string; legs: BookingLeg[] }
  | { type: "checkout_link"; trip_id: string; checkout_url: string; amount_cents: number; currency: string }
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
};

export function useChatStream(options: UseChatStreamOptions = {}) {
  const { endpoint = "/api/chat", devPolicyOverride = null } = options;
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [workflowStage, setWorkflowStage] = useState<string | null>(null);
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

  // Buffer streamed text during selection turns that may end with a
  // booking. Without this, the user sees `select_node` + `checkout_node`
  // tokens stream into a bubble for ~2s and then watches the bubble
  // get nuked when the `event: booking` arrives and the rich card
  // replaces it — a jarring "type then delete" flicker.
  //
  // Strategy:
  //   * On send, if the previous turn ended at `awaiting_*_selection`,
  //     we know this turn is the user picking — likely heading to
  //     `checkout_ready` → `completed`. Mark the turn as buffering.
  //   * While buffering, message chunks accumulate in `bufferedTextRef`
  //     and DON'T touch `messages` — so no assistant bubble shows yet
  //     (the existing typing-dots fallback in <ChatWindow> kicks in
  //     because there's no assistant message to render).
  //   * When `event: booking` arrives, the card lands as the assistant
  //     message and the buffered text is discarded — the card is the
  //     message.
  //   * When `event: done` arrives WITHOUT a booking attached
  //     (round-trip stage 1, blocked option, K1 failure path), the
  //     buffered text is flushed into a normal text bubble so the
  //     user sees the response — no information lost.
  //
  // Refs (not state) so updates inside the streaming loop don't trigger
  // re-renders or fight the React 18+ batched updater.
  const bufferingTurnRef = useRef(false);
  const bufferedTextRef = useRef("");
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

  const appendAssistantChunk = useCallback((content: string) => {
    // Selection-turn tokens go to the invisible buffer instead of an
    // on-screen bubble. The booking event (or `done` fallback) decides
    // what becomes visible. See bufferingTurnRef block above.
    if (bufferingTurnRef.current) {
      bufferedTextRef.current += content;
      return;
    }
    setMessages((prev) => {
      const last = prev[prev.length - 1];
      if (last?.role === "assistant") {
        // Extend the existing assistant message (token-streaming case).
        return [...prev.slice(0, -1), { ...last, content: last.content + content }];
      }
      return [...prev, { id: randomId(), role: "assistant", content }];
    });
  }, []);

  const attachOffers = useCallback((offers: DisplayedOffer[]) => {
    setMessages((prev) => {
      const last = prev[prev.length - 1];
      if (last?.role === "assistant") {
        // Same turn — augment the assistant message with the structured
        // offers so the renderer can show OptionCards for it.
        return [...prev.slice(0, -1), { ...last, offers }];
      }
      // Defensive: options arrived without a preceding message (shouldn't
      // happen with the current backend, but if the order ever flips we
      // stash them on a fresh assistant turn so the UI renders cleanly).
      return [
        ...prev,
        { id: randomId(), role: "assistant", content: "", offers },
      ];
    });
  }, []);

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
      bufferedTextRef.current = "";

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
                appendAssistantChunk(event.content);
                break;
              case "options":
                attachOffers(event.offers);
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
              case "done":
                setConversationId(event.conversation_id);
                setWorkflowStage(event.workflow_stage);
                // Flush buffered text if this was a buffered turn AND
                // no booking event arrived to take its place. Common
                // cases: round-trip stage 1 ("Departure locked, pick a
                // return"), blocked option, K1 chain failure path —
                // each emits text the user must see.
                if (bufferingTurnRef.current) {
                  const buffered = bufferedTextRef.current;
                  bufferingTurnRef.current = false;
                  bufferedTextRef.current = "";
                  if (buffered) {
                    setMessages((prev) => {
                      const last = prev[prev.length - 1];
                      // If a booking or checkout-link card already
                      // landed, the card is the message — discard the
                      // buffered text so it doesn't leak underneath.
                      if (
                        last?.role === "assistant" &&
                        (last.booking || last.checkoutLink)
                      ) {
                        return prev;
                      }
                      // Otherwise materialise the buffered text as a
                      // normal assistant bubble.
                      if (last?.role === "assistant") {
                        return [
                          ...prev.slice(0, -1),
                          { ...last, content: last.content + buffered },
                        ];
                      }
                      return [
                        ...prev,
                        { id: randomId(), role: "assistant", content: buffered },
                      ];
                    });
                  }
                }
                break;
              case "error":
                setError(event.message);
                break;
            }
          }
        }
      } catch (e) {
        if ((e as Error).name === "AbortError") return;
        setError((e as Error).message);
      } finally {
        setStreaming(false);
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
