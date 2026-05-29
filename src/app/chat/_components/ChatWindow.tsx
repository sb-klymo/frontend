"use client";

import { Fragment, useEffect, useRef } from "react";

import type { ChatMessage } from "@/hooks/useChatStream";
import { strings, type SupportedLanguage } from "@/lib/i18n";
import { useChatStore } from "@/stores/chatStore";

import { ApprovalPendingCard } from "./ApprovalPendingCard";
import { BookingConfirmationCard } from "./BookingConfirmationCard";
import { CancellationCard } from "./CancellationCard";
import { CheckoutPaymentCard } from "./CheckoutPaymentCard";
import { OnboardingCard } from "./OnboardingCard";
import { OptionList } from "./OptionList";

export type ChatWindowProps = {
  messages: ChatMessage[];
  error: string | null;
  isStreaming: boolean;
  /** L3-suivi 2 (UI polish): when true, render a typing indicator
   * BELOW the last assistant bubble. Set by `useChatStream` on
   * receipt of an `event: typing` SSE frame from the backend's
   * intra-turn pacing, and cleared on the next `event: message`.
   * Used to show "the bot is thinking" between consecutive bubbles
   * within one turn (e.g. cancel-continuation emits 3 bubbles with
   * 600ms pauses between). Distinct from `isStreaming`, which
   * covers the gap BEFORE the first bubble of a turn. */
  isBubblePending?: boolean;
  language: SupportedLanguage;
  /** Phase 15b — whether the user has already captured a complete Duffel
   * passenger profile (`/me.passenger_profile_complete`). When false (the
   * default — identity capture still pending), an empty chat shows the
   * static onboarding welcome bubbles (intro + "not editable" warning)
   * instead of the generic empty-state hint. */
  passengerProfileComplete?: boolean;
  /** Latest known agent workflow stage, used to label the typing
   * indicator (e.g. "Searching flights…" vs the generic "Thinking…").
   * Null while the first turn is still in flight. */
  workflowStage: string | null;
  send: (text: string) => void | Promise<void>;
  stop: () => void;
  reset: () => void;
  /** Fires when Realtime delivers a terminal approval status (approved /
   * rejected / expired / canceled) to a chat tab the user is currently
   * watching. The handler should trigger `resumeApproval(conversationId)`
   * so the post-decision AIMessage from `_reentry_approved` /
   * `_reentry_rejected` reaches the chat tab via SSE — without this, the
   * card morphs visually but the resume bubble never appears (the backend
   * decide endpoint no longer eagerly advances the graph since the
   * 2026-05-22 hotfix). Optional: when undefined (or null conversationId
   * at mount), the card morph is still visual-only. */
  onApprovalDecided?: () => void;
};

export function ChatWindow({
  messages,
  error,
  isStreaming,
  isBubblePending = false,
  language,
  passengerProfileComplete = false,
  workflowStage,
  send,
  stop,
  reset,
  onApprovalDecided,
}: ChatWindowProps) {
  const draft = useChatStore((s) => s.draft);
  const setDraft = useChatStore((s) => s.setDraft);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Phase 13 — while a booking awaits manager approval the chat input is
  // blocked (UX layer; the backend `approval_block` node also refuses
  // messages server-side as the safety net). Re-enables automatically when
  // the manager's decision lands: that flows through `resumeApproval` →
  // a fresh SSE `done` event → `workflowStage` changes away from
  // "awaiting_approval".
  const isAwaitingApproval = workflowStage === "awaiting_approval";
  const inputDisabled = isStreaming || isAwaitingApproval;

  // Auto-scroll to the latest message on every update.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, isStreaming]);

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const text = draft.trim();
    if (!text || inputDisabled) return;
    setDraft("");
    void send(text);
  }

  return (
    <div className="flex flex-1 flex-col">
      <div
        ref={scrollRef}
        className="flex-1 space-y-4 overflow-y-auto px-4 py-6"
        aria-live="polite"
      >
        {messages.length === 0 ? (
          // Phase 15b — on an empty chat, a user who still has identity
          // capture pending sees the static onboarding welcome (intro +
          // "not editable" warning) so the disclaimer appears BEFORE they
          // send anything. Once the passenger profile is complete, fall
          // back to the generic empty-state hint.
          passengerProfileComplete ? (
            <EmptyState />
          ) : (
            <OnboardingWelcome language={language} />
          )
        ) : (
          messages.map((m) => {
            if (m.cancellation) {
              // L3 — user cancelled a confirmed booking. Outranks
              // `booking` and `checkoutLink` because a cancelled trip
              // must never display as confirmed-and-payable. The
              // cancel acknowledgement is the final state.
              //
              // Render order — card FIRST, then the rephrased text
              // bubble BELOW. The card is the factual anchor (PNR,
              // refund amount, refund ID, ETA), the text is the warm
              // follow-up ("…want to plan another trip from Marseille?").
              // Reading top-to-bottom this lands as "here's the
              // receipt — now let's keep going" rather than burying
              // the transactional outcome under conversational copy.
              //
              // `attachCancellation` augments the in-flight assistant
              // message with the cancellation payload, so `m.content`
              // already carries the streamed/rephrased text by the
              // time this branch fires. Skip the bubble when content
              // is empty (defensive — earlier flow that pushes a
              // fresh cancellation-only message has content="").
              return (
                <div key={m.id} className="space-y-3">
                  <CancellationCard
                    cancellation={m.cancellation}
                    language={language}
                  />
                  {m.content ? (
                    <Bubble
                      key={`${m.id}-text`}
                      role={m.role}
                      content={m.content}
                      streaming={false}
                    />
                  ) : null}
                </div>
              );
            }
            if (m.onboarding) {
              // PR-4 phase-4 — first-time signup CTA. Onboarding only
              // fires before any trip exists, so this branch is
              // mutually exclusive with booking/checkoutLink in
              // practice.
              //
              // Phase 7 (2026-05-22) — render text bubble AND card
              // together (Fragment pattern, same as booking/approval
              // cards). Previously the card replaced the text bubble,
              // which worked when the only text was a redundant "add
              // a payment method here…" prompt. But the threshold
              // stage now emits meaningful confirmation text
              // ("Compris, je vous demande votre accord à partir de
              // 200 €") in the same SSE turn that the
              // `onboarding_redirect` event attaches the card payload
              // to — without this Fragment, that confirmation was
              // invisible. Guard the bubble on non-empty content so
              // legacy turns with no preceding text (the redirect
              // re-emit path) don't render an empty grey rectangle.
              return (
                <Fragment key={m.id}>
                  {m.content && (
                    <Bubble
                      role="assistant"
                      content={m.content}
                      streaming={false}
                    />
                  )}
                  <OnboardingCard
                    onboarding={m.onboarding}
                    language={language}
                  />
                </Fragment>
              );
            }
            if (m.approvalRequest) {
              // Phase 6 — offer flagged as requiring manager/finance
              // approval. The card subscribes to Supabase Realtime and
              // morphs in-place when the manager decides (approved /
              // rejected / expired / canceled). Placed BEFORE `booking`
              // and `checkoutLink`: an offer awaiting approval must
              // never be rendered as a payable or confirmed booking.
              //
              // Render pattern mirrors the `m.booking` Fragment: text
              // bubble first (the bot's "I've sent this to your manager"
              // phrase), then the structured card below. Guard the bubble
              // on non-empty content so no empty grey rectangle appears
              // when the message was pushed without assistant text.
              return (
                <Fragment key={m.id}>
                  {m.content && (
                    <Bubble
                      role="assistant"
                      content={m.content}
                      streaming={false}
                    />
                  )}
                  <ApprovalPendingCard
                    approval={m.approvalRequest}
                    language={language}
                    onDecided={onApprovalDecided}
                  />
                </Fragment>
              );
            }
            if (m.booking) {
              // K1 (SSE event:booking) and Plan B / M2-bis (Realtime
              // morph → /api/trips/{id}/booking-details) both land
              // here. In Plan B the SAME message also carries
              // `checkoutLink` (the morph augments the existing
              // CheckoutPaymentCard message in-place — see
              // `attachBooking` in useChatStream.ts), so `booking`
              // MUST win the render priority over `checkoutLink` —
              // otherwise the booked card with PNR + flight legs +
              // PDF download never appears.
              //
              // Render the text bubble AND the card when both are
              // present. The booking event arrives as an augmentation
              // of the previous assistant message (the warm
              // checkout_node "Bouclé !" close phrased via
              // `phrase()`), and that text was being silently
              // discarded by the renderer pre-2026-05-21 — see user
              // feedback "the text appears briefly then is replaced
              // by the card". The defensive branch in `attachBooking`
              // pushes a fresh message with `content=""` when no
              // preceding assistant text exists, so guard the Bubble
              // on a non-empty `m.content` to avoid an empty grey
              // rectangle in that case.
              return (
                <Fragment key={m.id}>
                  {m.content && (
                    <Bubble
                      role="assistant"
                      content={m.content}
                      streaming={false}
                    />
                  )}
                  <BookingConfirmationCard
                    booking={m.booking}
                    language={language}
                  />
                </Fragment>
              );
            }
            if (m.checkoutLink) {
              // Modes 2/3 in flight (Stripe Checkout link + paid
              // morph). Falls through to here only when no booking
              // is attached yet — once Plan B's M2-bis chain
              // finalises, the branch above takes over.
              return (
                <CheckoutPaymentCard
                  key={m.id}
                  checkoutLink={m.checkoutLink}
                  language={language}
                />
              );
            }
            if (m.offers) {
              // Structured offers replace the redundant text bubble — the
              // OptionList carries the same info more cleanly.
              return (
                <OptionList
                  key={m.id}
                  offers={m.offers}
                  language={language}
                  header={m.optionsHeader}
                  footer={m.optionsFooter}
                  selectable={m.optionsSelectable}
                />
              );
            }
            return (
              <Bubble key={m.id} role={m.role} content={m.content} streaming={false} />
            );
          })
        )}
        {isStreaming && messages[messages.length - 1]?.role !== "assistant" && (
          <TypingIndicator language={language} workflowStage={workflowStage} />
        )}
        {/* L3-suivi 2 (UI polish): when the backend paced a gap
         * between two assistant bubbles within the same turn (`event:
         * typing` frame), render the typing indicator BELOW the
         * existing assistant bubble. The first-bubble case above
         * gates on "last message isn't from assistant"; this case
         * gates on the inverse (an assistant bubble already exists
         * AND the backend signalled another bubble is coming). */}
        {isBubblePending && messages[messages.length - 1]?.role === "assistant" && (
          <TypingIndicator language={language} workflowStage={workflowStage} />
        )}
      </div>

      {error && (
        <div className="border-t border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
          {error}{" "}
          <button onClick={reset} className="underline underline-offset-2">
            Reset
          </button>
        </div>
      )}

      {isAwaitingApproval && (
        <div
          data-testid="awaiting-approval-input-notice"
          role="status"
          className="border-t border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800"
        >
          {strings(language).approvalCard.inputBlockedNotice}
        </div>
      )}

      <form
        onSubmit={onSubmit}
        className="flex items-end gap-2 border-t border-gray-200 px-4 py-3"
      >
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              onSubmit(e as unknown as React.FormEvent);
            }
          }}
          placeholder={
            isAwaitingApproval
              ? strings(language).chatInput.awaitingApprovalPlaceholder
              : strings(language).chatInput.placeholder
          }
          rows={1}
          disabled={inputDisabled}
          className="flex-1 resize-none rounded-md border border-gray-300 px-3 py-2 focus:border-blue-500 focus:outline-none disabled:bg-gray-50"
        />
        {isStreaming ? (
          <button
            type="button"
            onClick={stop}
            className="rounded-md bg-gray-700 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800"
          >
            Stop
          </button>
        ) : (
          <button
            type="submit"
            disabled={!draft.trim() || isAwaitingApproval}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            Send
          </button>
        )}
      </form>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex h-full items-center justify-center text-center text-sm text-gray-500">
      <div>
        <p className="text-base font-medium text-gray-700">Start a conversation</p>
        <p className="mt-1">
          Try: &ldquo;I want to fly from Paris to New York next Friday&rdquo;
        </p>
      </div>
    </div>
  );
}

/**
 * Phase 15b — static onboarding welcome shown on an empty chat while the
 * user still has identity capture pending. Renders the intro + "details
 * aren't editable" warning as assistant bubbles, so they look identical
 * to a bot turn but appear immediately on arrival (no user message, no
 * backend round-trip). Copy lives in `i18n.ts::onboardingWelcome`; the
 * backend no longer emits these (Phase 15b backend half).
 */
function OnboardingWelcome({ language }: { language: SupportedLanguage }) {
  const s = strings(language).onboardingWelcome;
  return (
    <div className="space-y-4" data-testid="onboarding-welcome">
      <Bubble role="assistant" content={s.intro} streaming={false} />
      <Bubble role="assistant" content={s.warning} streaming={false} />
    </div>
  );
}

// Map every backend workflow_stage onto a typing-indicator label. The
// mapping is coarse on purpose — "is the bot reasoning, searching,
// presenting, or finalising?" is the granularity that helps the user
// understand the wait. Stages that don't add useful information all
// fall through to the generic "Thinking…" copy. See
// `backend/src/agent/state.py::WorkflowStage` for the source of truth.
function _typingLabelKey(
  workflowStage: string | null,
): keyof ReturnType<typeof strings>["typingIndicator"] {
  switch (workflowStage) {
    case "ready_for_search":
      return "searching";
    case "options_returned":
    case "awaiting_departure_selection":
    case "awaiting_return_selection":
      return "presenting";
    case "checkout_ready":
    case "payment_pending":
      return "booking";
    default:
      // draft / pending_info / completed / canceled / unknown
      return "thinking";
  }
}

function TypingIndicator({
  language,
  workflowStage,
}: {
  language: SupportedLanguage;
  workflowStage: string | null;
}) {
  const t = strings(language).typingIndicator;
  const label = t[_typingLabelKey(workflowStage)];
  return (
    <div className="flex justify-start" data-testid="typing-indicator">
      <div
        role="status"
        aria-label={label}
        className="flex items-center gap-2 rounded-2xl bg-gray-100 px-4 py-3"
      >
        <div className="flex items-center gap-1">
          <span className="h-1.5 w-1.5 rounded-full bg-gray-500 motion-safe:animate-bounce" />
          <span
            className="h-1.5 w-1.5 rounded-full bg-gray-500 motion-safe:animate-bounce"
            style={{ animationDelay: "150ms" }}
          />
          <span
            className="h-1.5 w-1.5 rounded-full bg-gray-500 motion-safe:animate-bounce"
            style={{ animationDelay: "300ms" }}
          />
        </div>
        <span
          className="text-xs text-gray-600"
          data-testid="typing-indicator-label"
        >
          {label}
        </span>
      </div>
    </div>
  );
}

function Bubble({
  role,
  content,
  streaming,
}: {
  role: "user" | "assistant" | "system";
  content: string;
  streaming: boolean;
}) {
  const isUser = role === "user";
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-4 py-2 text-sm ${
          isUser
            ? "bg-blue-600 text-white"
            : "bg-gray-100 text-gray-900"
        }`}
      >
        {content}
        {streaming && <span className="ml-1 animate-pulse">▍</span>}
      </div>
    </div>
  );
}
