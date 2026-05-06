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

import { useCallback, useEffect, useRef, useState } from "react";
import type { OrgPolicySettings } from "@/lib/api/generated/types.gen";
import { useChatStore } from "@/stores/chatStore";
import { detectLanguage, type SupportedLanguage } from "@/lib/i18n";
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
};

type ServerEvent =
  | { type: "start"; conversation_id: string }
  | { type: "message"; content: string; node?: string }
  | { type: "options"; offers: DisplayedOffer[]; node?: string }
  | { type: "booking"; trip_id: string; booking_reference: string; passenger_name: string; amount_cents: number; currency: string; legs: BookingLeg[] }
  | { type: "done"; workflow_stage: string | null; conversation_id: string }
  | { type: "error"; code: string; message: string };

function randomId(): string {
  return (
    globalThis.crypto?.randomUUID?.() ??
    Math.random().toString(36).slice(2) + Date.now().toString(36)
  );
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

  const conversationId = useChatStore((s) => s.conversationId);
  const setConversationId = useChatStore((s) => s.setConversationId);
  const isStreaming = useChatStore((s) => s.isStreaming);
  const setStreaming = useChatStore((s) => s.setStreaming);

  const appendAssistantChunk = useCallback((content: string) => {
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

  const send = useCallback(
    async (userText: string) => {
      if (!userText.trim() || isStreaming) return;

      const userMsg: ChatMessage = { id: randomId(), role: "user", content: userText };
      setMessages((prev) => [...prev, userMsg]);
      setError(null);
      setStreaming(true);

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
              case "done":
                setConversationId(event.conversation_id);
                setWorkflowStage(event.workflow_stage);
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
