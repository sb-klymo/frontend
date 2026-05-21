/**
 * ChatWindow tests — focused on the TypingIndicator behaviour wired
 * by this PR. The rest of ChatWindow (message rendering, send/stop
 * controls) is exercised through the per-card component tests in
 * sibling files and the Playwright suite.
 */

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { ChatMessage } from "@/hooks/useChatStream";

import { ChatWindow } from "./ChatWindow";

const _noop = () => undefined;

function _renderWindow(overrides: {
  workflowStage?: string | null;
  isStreaming?: boolean;
  isBubblePending?: boolean;
  messages?: ChatMessage[];
  language?: "en" | "fr";
} = {}) {
  return render(
    <ChatWindow
      messages={overrides.messages ?? []}
      error={null}
      isStreaming={overrides.isStreaming ?? true}
      isBubblePending={overrides.isBubblePending ?? false}
      language={overrides.language ?? "en"}
      workflowStage={overrides.workflowStage ?? null}
      send={_noop}
      stop={_noop}
      reset={_noop}
    />,
  );
}

describe("ChatWindow — TypingIndicator", () => {
  it("renders dots + 'Thinking…' label by default (no stage)", () => {
    _renderWindow({ workflowStage: null });
    expect(screen.getByTestId("typing-indicator")).toBeInTheDocument();
    expect(screen.getByTestId("typing-indicator-label").textContent).toBe(
      "Thinking…",
    );
  });

  it("renders 'Searching flights…' at ready_for_search", () => {
    _renderWindow({ workflowStage: "ready_for_search" });
    expect(screen.getByTestId("typing-indicator-label").textContent).toBe(
      "Searching flights…",
    );
  });

  it("renders 'Pulling the options together…' at options_returned", () => {
    _renderWindow({ workflowStage: "options_returned" });
    expect(screen.getByTestId("typing-indicator-label").textContent).toBe(
      "Pulling the options together…",
    );
  });

  it("renders 'Pulling the options together…' at awaiting_departure_selection", () => {
    // The user picks an option; until the bot replies, we're still in
    // a selection stage. Same label as options_returned — both feel
    // like "consolidating choices" from the user's POV.
    _renderWindow({ workflowStage: "awaiting_departure_selection" });
    expect(screen.getByTestId("typing-indicator-label").textContent).toBe(
      "Pulling the options together…",
    );
  });

  it("renders 'Finalizing your booking…' at checkout_ready", () => {
    _renderWindow({ workflowStage: "checkout_ready" });
    expect(screen.getByTestId("typing-indicator-label").textContent).toBe(
      "Finalizing your booking…",
    );
  });

  it("renders 'Finalizing your booking…' at payment_pending", () => {
    // Plan B users sit at payment_pending while Stripe Checkout +
    // M2-bis runs. If they type during that window, the indicator
    // should reflect what's actually happening.
    _renderWindow({ workflowStage: "payment_pending" });
    expect(screen.getByTestId("typing-indicator-label").textContent).toBe(
      "Finalizing your booking…",
    );
  });

  it("falls back to 'Thinking…' for unknown / draft stages", () => {
    _renderWindow({ workflowStage: "draft" });
    expect(screen.getByTestId("typing-indicator-label").textContent).toBe(
      "Thinking…",
    );
  });

  it("localizes the label to French", () => {
    _renderWindow({ language: "fr", workflowStage: "ready_for_search" });
    expect(screen.getByTestId("typing-indicator-label").textContent).toBe(
      "Recherche des vols…",
    );
  });

  it("indicator is hidden when not streaming", () => {
    _renderWindow({ isStreaming: false });
    expect(screen.queryByTestId("typing-indicator")).not.toBeInTheDocument();
  });

  it("indicator is hidden when the last message is already from the assistant", () => {
    // Token-streaming has started — the cursor on the live bubble
    // (`▍`) takes over from the placeholder dots. Showing both is
    // visually noisy.
    const messages: ChatMessage[] = [
      { id: "m1", role: "user", content: "Hi" },
      { id: "m2", role: "assistant", content: "Hello…" },
    ];
    _renderWindow({ messages, isStreaming: true });
    expect(screen.queryByTestId("typing-indicator")).not.toBeInTheDocument();
  });

  it("uses the label as aria-label for screen readers", () => {
    _renderWindow({ workflowStage: "ready_for_search" });
    const indicator = screen.getByRole("status");
    expect(indicator.getAttribute("aria-label")).toBe("Searching flights…");
  });
});

describe("ChatWindow — intra-turn typing indicator (between bubbles)", () => {
  /**
   * L3-suivi 2 (UI polish): when the backend paces multiple bubbles
   * within one turn (`event: typing` between `event: message`
   * frames), `useChatStream` flips `isBubblePending=true`. The
   * `ChatWindow` renders a typing indicator BELOW the last
   * assistant bubble so the user sees "the bot is thinking"
   * between consecutive thoughts.
   *
   * Distinct from the first-bubble case where `isStreaming=true`
   * AND no assistant message exists yet — that's the connection-
   * level "thinking" indicator above this turn's content.
   */

  it("renders typing indicator below the last assistant bubble when isBubblePending=true", () => {
    const messages: ChatMessage[] = [
      { id: "u1", role: "user", content: "oui, je veux partir à Londres" },
      {
        id: "a1",
        role: "assistant",
        content: "Refund en route!",
        messageId: "msg-A",
      },
    ];
    _renderWindow({
      messages,
      isStreaming: true,
      isBubblePending: true,
      workflowStage: "canceled",
    });

    // The indicator IS present — backend signalled another bubble
    // is coming.
    expect(screen.getByTestId("typing-indicator")).toBeInTheDocument();
  });

  it("does NOT render intra-turn typing indicator when isBubblePending=false", () => {
    const messages: ChatMessage[] = [
      { id: "u1", role: "user", content: "Hi" },
      {
        id: "a1",
        role: "assistant",
        content: "All your bubbles are belong to us.",
        messageId: "msg-A",
      },
    ];
    _renderWindow({
      messages,
      isStreaming: true,
      isBubblePending: false,
    });

    // The first-bubble indicator path also gates on
    // "last message not from assistant" — last IS from assistant
    // here, so neither indicator should render.
    expect(screen.queryByTestId("typing-indicator")).not.toBeInTheDocument();
  });

  it("isBubblePending takes effect even when isStreaming is false (defensive)", () => {
    // The two flags are independent: isBubblePending could
    // theoretically arrive before the connection-level
    // isStreaming flips. The renderer must trust the explicit
    // bubble-pending signal.
    const messages: ChatMessage[] = [
      { id: "u1", role: "user", content: "Hi" },
      {
        id: "a1",
        role: "assistant",
        content: "First bubble.",
        messageId: "msg-A",
      },
    ];
    _renderWindow({
      messages,
      isStreaming: false,
      isBubblePending: true,
      workflowStage: "canceled",
    });

    expect(screen.getByTestId("typing-indicator")).toBeInTheDocument();
  });
});

describe("ChatWindow — CancellationCard renders text bubble alongside card", () => {
  /**
   * 2026-05-13 regression: `attachCancellation` augments the
   * in-flight assistant message with the cancellation payload, but
   * the renderer used to short-circuit on `m.cancellation` and drop
   * the text content entirely. With the L3-suivi 1 follow-up hook
   * ("…want to plan another trip from Marseille?") landing in the
   * SAME message's `content`, the user lost that hook visually —
   * only the receipt-style card rendered.
   *
   * Contract: when a message carries BOTH content AND cancellation,
   * the bubble renders ABOVE the card. When content is empty (older
   * flow that pushes a fresh cancellation-only message), only the
   * card renders.
   */

  it("renders the cancellation card FIRST, then the rephrased text bubble below", () => {
    const messages: ChatMessage[] = [
      { id: "u1", role: "user", content: "oui je veux annuler" },
      {
        id: "a1",
        role: "assistant",
        content:
          "Remboursement en route ! La réservation STUBXXXXX1 est bien annulée, et vous récupérez 540.00 USD sur votre carte d'ici 5 à 10 jours ouvrés. On repart sur un nouveau trajet depuis Marseille ?",
        cancellation: {
          trip_id: "trip-1",
          booking_reference: "STUBXXXXX1",
          refund_id: "re_test_1",
          amount_cents: 54000,
          currency: "USD",
        },
      },
    ];
    _renderWindow({ messages, isStreaming: false, language: "fr" });

    // The cancellation card must render.
    const card = screen.getByTestId("cancellation-card");
    expect(card).toBeInTheDocument();

    // AND the follow-up text bubble must render with the origin
    // hook intact — this is the bug the fix targets.
    const followupText = screen.getByText(/nouveau trajet depuis Marseille/i);
    expect(followupText).toBeInTheDocument();

    // Order matters: the card is the factual anchor (receipt) and
    // must come BEFORE the conversational follow-up underneath.
    // `compareDocumentPosition` returns a bitmask; the
    // DOCUMENT_POSITION_FOLLOWING flag (4) is set when the second
    // node appears AFTER the first in document order.
    const followingMask = 4; // Node.DOCUMENT_POSITION_FOLLOWING
    expect(
      card.compareDocumentPosition(followupText) & followingMask,
    ).toBe(followingMask);
  });

  it("skips the empty bubble when the cancellation message has no content", () => {
    // Defensive — older flow / fresh-cancellation-only path pushes
    // a message with content="". The card must still render; no
    // empty rectangle bubble should appear above it.
    const messages: ChatMessage[] = [
      { id: "u1", role: "user", content: "oui" },
      {
        id: "a1",
        role: "assistant",
        content: "",
        cancellation: {
          trip_id: "trip-1",
          booking_reference: "STUBXXXXX2",
          refund_id: "re_test_2",
          amount_cents: 54000,
          currency: "USD",
        },
      },
    ];
    const { container } = _renderWindow({ messages, isStreaming: false });

    // Card renders.
    expect(screen.getByTestId("cancellation-card")).toBeInTheDocument();
    // No assistant bubble (the gray-100 pill) above it. Detect by
    // class since Bubble has no test id; the user message above is
    // blue-600, so any gray-100 element would be a stray assistant
    // bubble — there shouldn't be one when content is empty.
    expect(container.querySelector(".bg-gray-100")).toBeNull();
  });
});

describe("ChatWindow — booking message renders text bubble + card together", () => {
  it("keeps the warm 'Bouclé !' text visible alongside the BookingConfirmationCard", () => {
    // Regression for the "type then delete" flicker observed
    // 2026-05-21 with live Duffel: checkout_node streams a warm
    // seed-pool phrase ("Bouclé ! Marseille → Toulouse ref STUB...")
    // which arrives BEFORE event:booking. attachBooking augments the
    // last assistant message in-place; pre-fix the renderer returned
    // the card and discarded m.content, masking the bot's spoken
    // confirmation. Now both must render.
    const messages: ChatMessage[] = [
      { id: "u1", role: "user", content: "option 1" },
      {
        id: "a1",
        role: "assistant",
        content: "Bouclé ! Marseille → Toulouse ref STUB0000ABC.",
        booking: {
          trip_id: "trip-1",
          booking_reference: "STUB0000ABC",
          passenger_name: "Test Customer",
          amount_cents: 45000,
          currency: "USD",
          legs: [
            {
              origin_iata: "MRS",
              destination_iata: "TLS",
              departure_iso: "2026-06-01T08:00:00",
              arrival_iso: "2026-06-01T10:15:00",
              airline_name: "Duffel Airways",
            },
          ],
          total_duration_minutes: 135,
        },
      },
    ];
    _renderWindow({ messages, isStreaming: false });

    expect(screen.getByTestId("booking-confirmation-card")).toBeInTheDocument();
    expect(
      screen.getByText(/Bouclé ! Marseille → Toulouse ref STUB0000ABC\./),
    ).toBeInTheDocument();
  });

  it("skips the empty bubble when the booking message has no content", () => {
    // Defensive — the booking event can arrive without a preceding
    // assistant text (attachBooking's fallback branch pushes a fresh
    // message with content=""). The card must render; no empty
    // rectangle should appear above it.
    const messages: ChatMessage[] = [
      { id: "u1", role: "user", content: "option 1" },
      {
        id: "a1",
        role: "assistant",
        content: "",
        booking: {
          trip_id: "trip-1",
          booking_reference: "STUB0000ABC",
          passenger_name: "Test Customer",
          amount_cents: 45000,
          currency: "USD",
          legs: [
            {
              origin_iata: "MRS",
              destination_iata: "TLS",
              departure_iso: "2026-06-01T08:00:00",
              arrival_iso: "2026-06-01T10:15:00",
              airline_name: "Duffel Airways",
            },
          ],
          total_duration_minutes: 135,
        },
      },
    ];
    const { container } = _renderWindow({ messages, isStreaming: false });

    expect(screen.getByTestId("booking-confirmation-card")).toBeInTheDocument();
    // No stray assistant bubble — same detection pattern as the
    // cancellation test above.
    expect(container.querySelector(".bg-gray-100")).toBeNull();
  });
});
