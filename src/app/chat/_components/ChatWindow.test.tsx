/**
 * ChatWindow tests — focused on the TypingIndicator behaviour wired
 * by this PR. The rest of ChatWindow (message rendering, send/stop
 * controls) is exercised through the per-card component tests in
 * sibling files and the Playwright suite.
 */

import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ApprovalRequestDetails, ChatMessage } from "@/hooks/useChatStream";

// Supabase mock — ApprovalPendingCard renders useApprovalRealtime which
// creates a Supabase channel. Stub it out so ChatWindow tests don't need a
// real WS or NEXT_PUBLIC_* env vars. Mirrors the mock in
// ApprovalPendingCard.test.tsx.
const mockOn = vi.fn().mockReturnThis();
const mockSubscribe = vi.fn().mockReturnThis();
const mockChannel = vi.fn(() => ({ on: mockOn, subscribe: mockSubscribe }));
const mockRemoveChannel = vi.fn();
vi.mock("@/lib/supabase/browser", () => ({
  createSupabaseBrowserClient: () => ({
    channel: mockChannel,
    removeChannel: mockRemoveChannel,
    auth: {
      getSession: vi.fn(async () => ({
        data: { session: { access_token: "test-jwt" } },
      })),
    },
    realtime: { setAuth: vi.fn() },
  }),
}));

import { useChatStore } from "@/stores/chatStore";

import { ChatWindow } from "./ChatWindow";

const _noop = () => undefined;

function _renderWindow(overrides: {
  workflowStage?: string | null;
  isStreaming?: boolean;
  isBubblePending?: boolean;
  messages?: ChatMessage[];
  language?: "en" | "fr";
  passengerProfileComplete?: boolean;
  onCancelCheckout?: () => void;
} = {}) {
  return render(
    <ChatWindow
      messages={overrides.messages ?? []}
      error={null}
      isStreaming={overrides.isStreaming ?? true}
      isBubblePending={overrides.isBubblePending ?? false}
      language={overrides.language ?? "en"}
      passengerProfileComplete={overrides.passengerProfileComplete ?? true}
      workflowStage={overrides.workflowStage ?? null}
      send={_noop}
      stop={_noop}
      reset={_noop}
      onCancelCheckout={overrides.onCancelCheckout}
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

// ---------------------------------------------------------------------------
// Phase 15b — static onboarding welcome on an empty chat
// ---------------------------------------------------------------------------

describe("ChatWindow — onboarding welcome (Phase 15b)", () => {
  it("shows the welcome bubbles on an empty chat when profile is incomplete", () => {
    _renderWindow({ messages: [], passengerProfileComplete: false, isStreaming: false });
    const welcome = screen.getByTestId("onboarding-welcome");
    expect(welcome).toBeInTheDocument();
    expect(welcome.textContent).toContain("Klymo");
    // Intro hook + the "details can't be changed" warning must be present.
    expect(welcome.textContent).toContain("last trip you'll ever book manually");
    expect(welcome.textContent).toContain("can't be changed afterwards");
    // No literal markdown asterisks leak through.
    expect(welcome.textContent).not.toContain("**");
    // The generic empty-state hint must NOT show in its place.
    expect(screen.queryByText("Start a conversation")).not.toBeInTheDocument();
  });

  it("localizes the welcome to French", () => {
    _renderWindow({
      messages: [],
      passengerProfileComplete: false,
      isStreaming: false,
      language: "fr",
    });
    const welcome = screen.getByTestId("onboarding-welcome");
    expect(welcome.textContent).toContain("Quatre onglets");
    expect(welcome.textContent).toContain("ne sont pas modifiables");
  });

  it("keeps the welcome pinned at the top once the user starts chatting (profile still incomplete)", () => {
    _renderWindow({
      messages: [
        { id: "m1", role: "user", content: "bonjour" },
        { id: "m2", role: "assistant", content: "Quel est votre **prénom** ?" },
      ],
      passengerProfileComplete: false,
      isStreaming: false,
    });
    // The welcome must NOT vanish when messages exist — it stays pinned for
    // the whole first (onboarding) conversation.
    expect(screen.getByTestId("onboarding-welcome")).toBeInTheDocument();
    // And the conversation still renders below it.
    expect(screen.getByText("bonjour")).toBeInTheDocument();
    // `**bold**` in assistant copy renders as <strong> (renderInline), not
    // literal asterisks — covered here now that the welcome copy is plain.
    expect(screen.getByText("prénom").tagName).toBe("STRONG");
  });

  it("shows the generic empty state (no welcome) once the profile is complete", () => {
    _renderWindow({ messages: [], passengerProfileComplete: true, isStreaming: false });
    expect(screen.queryByTestId("onboarding-welcome")).not.toBeInTheDocument();
    expect(screen.getByText("Start a conversation")).toBeInTheDocument();
  });

  it("hides the welcome once the profile is complete, even with messages", () => {
    _renderWindow({
      messages: [{ id: "m1", role: "user", content: "Salut" }],
      passengerProfileComplete: true,
      isStreaming: false,
    });
    expect(screen.queryByTestId("onboarding-welcome")).not.toBeInTheDocument();
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

describe("ChatWindow — approval request renders text + card together", () => {
  /**
   * Phase 6: when a message carries an `approvalRequest` payload, the
   * renderer must emit BOTH the assistant's warm phrasing bubble AND the
   * `ApprovalPendingCard` below it (same Fragment pattern as `m.booking`).
   *
   * The `approvalRequest` branch fires BEFORE `m.booking` so an offer
   * awaiting approval is never rendered as a confirmed-and-payable card.
   */

  function _approvalMsg(
    overrides: Partial<ApprovalRequestDetails> = {},
  ): ChatMessage {
    const approval: ApprovalRequestDetails = {
      id: "apr-chat-test-1",
      total: 350.0,
      currency: "EUR",
      expires_at: new Date(Date.now() + 3_600_000).toISOString(),
      approver_emails: ["boss@company.com"],
      policy_reason: "Exceeds €300 limit",
      status: "pending",
      decision_reason: null,
      decided_at: null,
      decided_by_first_name: null,
      ...overrides,
    };
    return {
      id: "msg-apr-1",
      role: "assistant",
      content: "I've sent this to your manager for approval.",
      approvalRequest: approval,
    };
  }

  it("keeps the 'pending approval' text alongside the ApprovalPendingCard", () => {
    _renderWindow({
      messages: [
        { id: "u1", role: "user", content: "option 2" },
        _approvalMsg(),
      ],
      isStreaming: false,
    });

    // The ApprovalPendingCard renders.
    expect(screen.getByTestId("approval-pending-card")).toBeInTheDocument();

    // AND the warm phrasing bubble renders.
    expect(
      screen.getByText(/I've sent this to your manager for approval/),
    ).toBeInTheDocument();
  });

  it("skips the empty bubble when the approval message has no content", () => {
    const msg: ChatMessage = {
      id: "msg-apr-2",
      role: "assistant",
      content: "",
      approvalRequest: _approvalMsg().approvalRequest,
    };
    const { container } = _renderWindow({
      messages: [{ id: "u1", role: "user", content: "option 2" }, msg],
      isStreaming: false,
    });

    expect(screen.getByTestId("approval-pending-card")).toBeInTheDocument();
    // No stray empty assistant bubble above the card.
    expect(container.querySelector(".bg-gray-100")).toBeNull();
  });

  it("approval branch fires before booking branch (priority check)", () => {
    // A message that (hypothetically) carries both fields should render
    // the approval card, not the booking card. In practice this shouldn't
    // occur, but the render order must be defensively correct.
    const msg: ChatMessage = {
      id: "msg-apr-3",
      role: "assistant",
      content: "Waiting for approval.",
      approvalRequest: _approvalMsg().approvalRequest,
      booking: {
        trip_id: "trip-x",
        booking_reference: "STUB999",
        passenger_name: "Test User",
        amount_cents: 35000,
        currency: "EUR",
        legs: [],
      },
    };
    _renderWindow({
      messages: [{ id: "u1", role: "user", content: "confirm" }, msg],
      isStreaming: false,
    });

    expect(screen.getByTestId("approval-pending-card")).toBeInTheDocument();
    expect(screen.queryByTestId("booking-confirmation-card")).toBeNull();
  });
});

describe("ChatWindow — awaiting-approval input block (Phase 13)", () => {
  afterEach(() => {
    // The draft lives in the shared zustand store — reset it between tests.
    // Wrapped in act() because a still-mounted ChatWindow subscribes to it.
    act(() => {
      useChatStore.setState({ draft: "" });
    });
  });

  it("shows the notice and disables the textarea at awaiting_approval", () => {
    _renderWindow({ workflowStage: "awaiting_approval", isStreaming: false });
    expect(screen.getByTestId("awaiting-approval-input-notice")).toBeInTheDocument();
    expect(screen.getByRole("textbox")).toBeDisabled();
  });

  it("blocks Send even with text typed while awaiting_approval", () => {
    useChatStore.setState({ draft: "actually, can I change the date?" });
    _renderWindow({ workflowStage: "awaiting_approval", isStreaming: false });
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
  });

  it("does not block input or show the notice at other stages", () => {
    _renderWindow({ workflowStage: "completed", isStreaming: false });
    expect(screen.queryByTestId("awaiting-approval-input-notice")).toBeNull();
    expect(screen.getByRole("textbox")).not.toBeDisabled();
  });

  it("renders the French notice when language is fr", () => {
    _renderWindow({
      workflowStage: "awaiting_approval",
      isStreaming: false,
      language: "fr",
    });
    expect(
      screen.getByTestId("awaiting-approval-input-notice").textContent,
    ).toContain("approbation de votre manager");
  });
});

describe("ChatWindow — payment_pending input block (Task 6)", () => {
  afterEach(() => {
    act(() => {
      useChatStore.setState({ draft: "" });
    });
  });

  it("hard-disables input and shows the Cancel button during payment_pending", () => {
    const onCancelCheckout = vi.fn();
    _renderWindow({
      messages: [], passengerProfileComplete: true, isStreaming: false,
      workflowStage: "payment_pending", onCancelCheckout,
    });
    expect(screen.getByRole("textbox")).toBeDisabled();
    expect(screen.getByTestId("payment-pending-input-notice")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("cancel-booking-button"));
    expect(onCancelCheckout).toHaveBeenCalledTimes(1);
  });

  it("re-enables input once the stage leaves payment_pending", () => {
    _renderWindow({ messages: [], passengerProfileComplete: true, isStreaming: false,
                    workflowStage: "pending_info" });
    expect(screen.getByRole("textbox")).not.toBeDisabled();
    expect(screen.queryByTestId("payment-pending-input-notice")).not.toBeInTheDocument();
  });
});
