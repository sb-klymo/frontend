import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useChatStore } from "@/stores/chatStore";
import { useChatStream } from "./useChatStream";

// M2-H3 — mock the Supabase browser client. The hook subscribes to
// Realtime when a CheckoutPaymentCard arrives; tests don't have the
// NEXT_PUBLIC_* env vars wired, and we don't want a real WS in tests
// anyway. The mock is module-scoped so all tests in this file share
// the same `mockChannel` / `mockRemoveChannel`; individual tests
// reset call history via `vi.restoreAllMocks()` in `beforeEach`.
const mockOn = vi.fn().mockReturnThis();
const mockSubscribe = vi.fn().mockReturnThis();
const mockChannel = vi.fn(() => ({ on: mockOn, subscribe: mockSubscribe }));
const mockRemoveChannel = vi.fn();
const mockSetAuth = vi.fn();
const mockGetSession = vi.fn(async () => ({
  data: { session: { access_token: "test-jwt-token" } },
}));
let lastPostgresChangesHandler:
  | ((payload: { new: Record<string, unknown> }) => void)
  | null = null;

vi.mock("@/lib/supabase/browser", () => ({
  createSupabaseBrowserClient: () => ({
    channel: mockChannel,
    removeChannel: mockRemoveChannel,
    auth: { getSession: mockGetSession },
    realtime: { setAuth: mockSetAuth },
  }),
}));

// Capture the postgres_changes handler so individual tests can
// invoke it directly (simulating a Realtime UPDATE event).
mockOn.mockImplementation((_event: string, _config: unknown, handler: typeof lastPostgresChangesHandler) => {
  lastPostgresChangesHandler = handler;
  return { on: mockOn, subscribe: mockSubscribe };
});

/**
 * Build a fake fetch Response whose body streams the given SSE-formatted
 * chunks, one at a time, to mimic what the backend emits.
 */
function mockSseResponse(frames: string[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      for (const frame of frames) {
        controller.enqueue(encoder.encode(frame));
      }
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

const START_FRAME = 'event: start\ndata: {"conversation_id":"conv-1"}\n\n';
const MESSAGE_FRAME =
  'event: message\ndata: {"content":"Where would you like to go?","node":"ask"}\n\n';
const DONE_FRAME =
  'event: done\ndata: {"conversation_id":"conv-1","workflow_stage":"pending_info"}\n\n';

describe("useChatStream", () => {
  beforeEach(() => {
    useChatStore.getState().resetConversation();
    vi.restoreAllMocks();
    // `restoreAllMocks` resets vi.fn() mocks too — reinstall the
    // postgres_changes handler-capture and base return values so the
    // Supabase mock keeps working across tests.
    lastPostgresChangesHandler = null;
    mockOn.mockImplementation(
      (_event: string, _config: unknown, handler: typeof lastPostgresChangesHandler) => {
        lastPostgresChangesHandler = handler;
        return { on: mockOn, subscribe: mockSubscribe };
      },
    );
    mockSubscribe.mockReturnValue({ on: mockOn, subscribe: mockSubscribe });
    mockChannel.mockReturnValue({ on: mockOn, subscribe: mockSubscribe });
    mockGetSession.mockResolvedValue({
      data: { session: { access_token: "test-jwt-token" } },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("sends nothing on empty text", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const { result } = renderHook(() => useChatStream());

    await act(async () => {
      await result.current.send("   ");
    });

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result.current.messages).toEqual([]);
  });

  it("appends user message and streams assistant chunks", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      mockSseResponse([START_FRAME, MESSAGE_FRAME, DONE_FRAME]),
    );

    const { result } = renderHook(() => useChatStream());
    await act(async () => {
      await result.current.send("Paris next Friday");
    });

    await waitFor(() => {
      expect(result.current.isStreaming).toBe(false);
    });
    expect(result.current.messages).toHaveLength(2);
    expect(result.current.messages[0]).toMatchObject({
      role: "user",
      content: "Paris next Friday",
    });
    expect(result.current.messages[1]).toMatchObject({
      role: "assistant",
      content: "Where would you like to go?",
    });
    expect(useChatStore.getState().conversationId).toBe("conv-1");
  });

  it("reuses conversation_id on follow-up sends", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(mockSseResponse([START_FRAME, MESSAGE_FRAME, DONE_FRAME]))
      .mockResolvedValueOnce(mockSseResponse([START_FRAME, DONE_FRAME]));

    const { result } = renderHook(() => useChatStream());
    await act(async () => {
      await result.current.send("turn one");
    });
    await act(async () => {
      await result.current.send("turn two");
    });

    const secondCallBody = JSON.parse(fetchSpy.mock.calls[1]![1]!.body as string);
    expect(secondCallBody.conversation_id).toBe("conv-1");
    expect(secondCallBody.message).toBe("turn two");
  });

  it("extends the last assistant message on subsequent token chunks", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      mockSseResponse([
        START_FRAME,
        'event: message\ndata: {"content":"Where "}\n\n',
        'event: message\ndata: {"content":"would you "}\n\n',
        'event: message\ndata: {"content":"like to go?"}\n\n',
        DONE_FRAME,
      ]),
    );

    const { result } = renderHook(() => useChatStream());
    await act(async () => {
      await result.current.send("hi");
    });

    const last = result.current.messages[result.current.messages.length - 1]!;
    expect(last.role).toBe("assistant");
    expect(last.content).toBe("Where would you like to go?");
  });

  it("surfaces server errors", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      mockSseResponse([
        START_FRAME,
        'event: error\ndata: {"code":"internal_error","message":"boom"}\n\n',
        DONE_FRAME,
      ]),
    );

    const { result } = renderHook(() => useChatStream());
    await act(async () => {
      await result.current.send("hi");
    });

    expect(result.current.error).toBe("boom");
  });

  it("attaches structured offers to the last assistant message", async () => {
    // Step 8 — when the backend emits `event: options` after a message,
    // the offers ride on the same assistant message so the renderer can
    // show OptionCards instead of the redundant text bubble.
    const optionsFrame =
      'event: options\ndata: ' +
      JSON.stringify({
        offers: [
          {
            offer_id: "off_1",
            rank: 1,
            airline_name: "Air Stub",
            airline_iata: "AS",
            total_amount_cents: 45000,
            total_currency: "EUR",
            outbound: {
              origin_iata: "CDG",
              destination_iata: "JFK",
              departure_datetime: "2026-06-01T08:00:00+00:00",
              arrival_datetime: "2026-06-01T10:15:00+00:00",
              duration_iso: "PT2H15M",
            },
            return_leg: null,
            policy_status: "auto_approved",
            policy_reason: "Within cap.",
          },
        ],
        node: "search_present",
      }) +
      "\n\n";

    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      mockSseResponse([
        START_FRAME,
        'event: message\ndata: {"content":"3 options for your trip:"}\n\n',
        optionsFrame,
        DONE_FRAME,
      ]),
    );

    const { result } = renderHook(() => useChatStream());
    await act(async () => {
      await result.current.send("Paris to NYC June 1");
    });

    const last = result.current.messages[result.current.messages.length - 1]!;
    expect(last.role).toBe("assistant");
    expect(last.offers).toHaveLength(1);
    expect(last.offers?.[0]?.offer_id).toBe("off_1");
    expect(last.offers?.[0]?.policy_status).toBe("auto_approved");
  });

  it("creates a fresh assistant message if options arrive without a prior message", async () => {
    // Defensive — the backend currently always emits message before options,
    // but if the order ever flips, the hook should still surface the cards.
    const optionsFrame =
      'event: options\ndata: ' +
      JSON.stringify({
        offers: [
          {
            offer_id: "off_only",
            rank: 1,
            airline_name: "Air Stub",
            airline_iata: "AS",
            total_amount_cents: 45000,
            total_currency: "EUR",
            outbound: {
              origin_iata: "CDG",
              destination_iata: "JFK",
              departure_datetime: "2026-06-01T08:00:00+00:00",
              arrival_datetime: "2026-06-01T10:15:00+00:00",
              duration_iso: "PT2H15M",
            },
            return_leg: null,
            policy_status: "auto_approved",
            policy_reason: "Within cap.",
          },
        ],
      }) +
      "\n\n";

    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      mockSseResponse([START_FRAME, optionsFrame, DONE_FRAME]),
    );

    const { result } = renderHook(() => useChatStream());
    await act(async () => {
      await result.current.send("hi");
    });

    const messages = result.current.messages;
    const lastAssistant = messages.findLast((m) => m.role === "assistant");
    expect(lastAssistant?.offers).toHaveLength(1);
  });

  it("handles HTTP errors from the backend", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("server unreachable", { status: 500 }),
    );

    const { result } = renderHook(() => useChatStream());
    await act(async () => {
      await result.current.send("hi");
    });

    await waitFor(() => expect(result.current.error).toMatch(/500/));
    expect(result.current.isStreaming).toBe(false);
  });

  it("omits dev_policy_override from request body when null", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(mockSseResponse([START_FRAME, DONE_FRAME]));

    const { result } = renderHook(() =>
      useChatStream({ devPolicyOverride: null }),
    );
    await act(async () => {
      await result.current.send("hi");
    });

    const init = fetchSpy.mock.calls[0]![1] as RequestInit;
    const body = JSON.parse(init.body as string);
    expect(body).not.toHaveProperty("dev_policy_override");
    expect(body.message).toBe("hi");
  });

  it("forwards dev_policy_override in request body when set", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(mockSseResponse([START_FRAME, DONE_FRAME]));

    const override = {
      spend_cap_cents: 50_000,
      manager_approval_threshold_cents: 30_000,
    };
    const { result } = renderHook(() =>
      useChatStream({ devPolicyOverride: override }),
    );
    await act(async () => {
      await result.current.send("hi");
    });

    const init = fetchSpy.mock.calls[0]![1] as RequestInit;
    const body = JSON.parse(init.body as string);
    expect(body.dev_policy_override).toEqual(override);
  });

  it("omits dev_vibe_override from request body when null", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(mockSseResponse([START_FRAME, DONE_FRAME]));

    const { result } = renderHook(() =>
      useChatStream({ devVibeOverride: null }),
    );
    await act(async () => {
      await result.current.send("hi");
    });

    const init = fetchSpy.mock.calls[0]![1] as RequestInit;
    const body = JSON.parse(init.body as string);
    expect(body).not.toHaveProperty("dev_vibe_override");
  });

  it("forwards dev_vibe_override in request body when set", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(mockSseResponse([START_FRAME, DONE_FRAME]));

    const { result } = renderHook(() =>
      useChatStream({ devVibeOverride: "neutral" }),
    );
    await act(async () => {
      await result.current.send("hi");
    });

    const init = fetchSpy.mock.calls[0]![1] as RequestInit;
    const body = JSON.parse(init.body as string);
    expect(body.dev_vibe_override).toBe("neutral");
  });

  it("picks up vibe override changes mid-conversation without restart", async () => {
    // Same ref-swap pattern as devPolicyOverride: the hook must observe
    // a fresh `devVibeOverride` on the next send without recreating
    // `send` (which would tear down the in-flight AbortController).
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(mockSseResponse([START_FRAME, DONE_FRAME]));

    type VibeProps = { vibe: "neutral" | "playful" | null };
    const { result, rerender } = renderHook<ReturnType<typeof useChatStream>, VibeProps>(
      ({ vibe }) => useChatStream({ devVibeOverride: vibe }),
      { initialProps: { vibe: null } },
    );

    await act(async () => {
      await result.current.send("hello");
    });
    expect(
      JSON.parse((fetchSpy.mock.calls[0]![1] as RequestInit).body as string),
    ).not.toHaveProperty("dev_vibe_override");

    rerender({ vibe: "neutral" });
    await act(async () => {
      await result.current.send("again");
    });
    expect(
      JSON.parse((fetchSpy.mock.calls[1]![1] as RequestInit).body as string).dev_vibe_override,
    ).toBe("neutral");
  });

  // -------------------------------------------------------------------------
  // Selection-turn text buffering
  //
  // When the previous turn ended at `awaiting_*_selection` and the user is
  // making a pick that may lead to a successful booking, the streaming text
  // from `select_node` + `checkout_node` is held in a buffer. Either:
  //   * `event: booking` arrives → the card lands as the message; buffered
  //     text is discarded (no flicker — text never appears).
  //   * `done` arrives without booking (round-trip stage 1, blocked option,
  //     K1 failure) → buffered text materialises as a normal text bubble.
  // -------------------------------------------------------------------------

  function bookingFrame(overrides: Record<string, unknown> = {}): string {
    return (
      "event: booking\ndata: " +
      JSON.stringify({
        trip_id: "tr-abc",
        booking_reference: "STUBABC",
        passenger_name: "Jean Dupont",
        amount_cents: 45000,
        currency: "USD",
        legs: [
          {
            origin_iata: "CDG",
            destination_iata: "JFK",
            departure_iso: "2026-06-01T08:00:00",
            arrival_iso: "2026-06-01T17:30:00",
            airline_name: "Air Stub",
          },
        ],
        ...overrides,
      }) +
      "\n\n"
    );
  }

  it("buffers select+checkout text when previous turn was a selection (booking lands, checkout text becomes a separate bubble)", async () => {
    // Turn 1: stage transitions to `awaiting_departure_selection`.
    // Turn 2: user picks → backend streams select+checkout text → booking
    // event fires → `done`. Post-2026-05-12 voice rework: select_node
    // text ("Parfait, on part sur l'option 1") is dropped because the
    // card already says the same thing. checkout_node text (the warm
    // seed-pool output: "Copy on its way, ready for next trip?") is
    // surfaced as a SEPARATE assistant message right after the card.
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        mockSseResponse([
          START_FRAME,
          'event: done\ndata: {"conversation_id":"conv-1","workflow_stage":"awaiting_departure_selection"}\n\n',
        ]),
      )
      .mockResolvedValueOnce(
        mockSseResponse([
          START_FRAME,
          'event: message\ndata: {"content":"Parfait, on part sur l\'option 1.","node":"select"}\n\n',
          'event: message\ndata: {"content":"C\'est réservé ! STUBABC, 450.00 EUR. ","node":"checkout"}\n\n',
          'event: message\ndata: {"content":"Le billet arrive par e-mail. Prêt pour le prochain voyage ?","node":"checkout"}\n\n',
          bookingFrame(),
          'event: done\ndata: {"conversation_id":"conv-1","workflow_stage":"completed"}\n\n',
        ]),
      );

    const { result } = renderHook(() => useChatStream());
    // Turn 1 — stage moves to awaiting_departure_selection.
    await act(async () => {
      await result.current.send("vol Marseille → Toulouse demain");
    });
    expect(result.current.workflowStage).toBe("awaiting_departure_selection");

    // Turn 2 — user picks.
    await act(async () => {
      await result.current.send("option 1");
    });

    const assistantMessages = result.current.messages.filter(
      (m) => m.role === "assistant",
    );
    // Two-bubble shape: card bubble, then warmth bubble.
    expect(assistantMessages.length).toBeGreaterThanOrEqual(2);
    const cardBubble = assistantMessages.find((m) => m.booking !== undefined);
    expect(cardBubble?.booking?.booking_reference).toBe("STUBABC");
    // Card bubble itself has no leaked select_node text content.
    expect(cardBubble?.content).toBe("");

    // The last assistant message is the warm checkout-node close,
    // landed as a separate bubble AFTER the card. select_node ack
    // ("Parfait, on part sur l'option 1") was dropped — only the
    // checkout-node text survives.
    const lastAssistant = assistantMessages[assistantMessages.length - 1];
    expect(lastAssistant?.booking).toBeUndefined();
    expect(lastAssistant?.content).toContain("Le billet arrive par e-mail");
    expect(lastAssistant?.content).not.toContain("Parfait, on part sur l'option 1");
  });

  it("flushes buffered text as a bubble when no booking arrives (round-trip stage 1)", async () => {
    // Stage 1 of round-trip: user picks departure → bot says "Departure
    // locked, pick a return". No booking event; the text MUST appear so
    // the user knows what to do next.
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        mockSseResponse([
          START_FRAME,
          'event: done\ndata: {"conversation_id":"conv-1","workflow_stage":"awaiting_departure_selection"}\n\n',
        ]),
      )
      .mockResolvedValueOnce(
        mockSseResponse([
          START_FRAME,
          'event: message\ndata: {"content":"Ok, vol aller verrouillé. ","node":"select"}\n\n',
          'event: message\ndata: {"content":"Et quel retour ?","node":"select"}\n\n',
          'event: done\ndata: {"conversation_id":"conv-1","workflow_stage":"awaiting_return_selection"}\n\n',
        ]),
      );

    const { result } = renderHook(() => useChatStream());
    await act(async () => {
      await result.current.send("aller-retour Paris → NYC");
    });
    await act(async () => {
      await result.current.send("option 1");
    });

    const lastAssistant = result.current.messages.findLast(
      (m) => m.role === "assistant",
    );
    expect(lastAssistant?.booking).toBeUndefined();
    expect(lastAssistant?.content).toBe("Ok, vol aller verrouillé. Et quel retour ?");
  });

  it("does NOT buffer when previous turn was not a selection turn", async () => {
    // First send (no previous workflowStage) — buffering must NOT fire,
    // streaming text appears as normal.
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      mockSseResponse([
        START_FRAME,
        'event: message\ndata: {"content":"Where would you like to go?","node":"ask"}\n\n',
        'event: done\ndata: {"conversation_id":"conv-1","workflow_stage":"pending_info"}\n\n',
      ]),
    );

    const { result } = renderHook(() => useChatStream());
    await act(async () => {
      await result.current.send("hi");
    });

    const lastAssistant = result.current.messages.findLast(
      (m) => m.role === "assistant",
    );
    // Text rendered live in the bubble, not buffered.
    expect(lastAssistant?.content).toBe("Where would you like to go?");
  });

  it("card bubble has empty content; checkout text lands as separate bubble after it", async () => {
    // Two-bubble invariant on the booking-success path: the card
    // bubble's `content` MUST be empty (no text leaks underneath the
    // card), and the checkout_node warm close lands as its own
    // subsequent bubble. Pins the card-vs-text separation.
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        mockSseResponse([
          START_FRAME,
          'event: done\ndata: {"conversation_id":"conv-1","workflow_stage":"awaiting_departure_selection"}\n\n',
        ]),
      )
      .mockResolvedValueOnce(
        mockSseResponse([
          START_FRAME,
          'event: message\ndata: {"content":"Booking now…","node":"checkout"}\n\n',
          bookingFrame(),
          'event: done\ndata: {"conversation_id":"conv-1","workflow_stage":"completed"}\n\n',
        ]),
      );

    const { result } = renderHook(() => useChatStream());
    await act(async () => {
      await result.current.send("turn 1");
    });
    await act(async () => {
      await result.current.send("option 1");
    });

    const assistantMessages = result.current.messages.filter(
      (m) => m.role === "assistant",
    );
    const cardBubble = assistantMessages.find((m) => m.booking !== undefined);
    expect(cardBubble?.booking).toBeDefined();
    expect(cardBubble?.content).toBe("");
    // The last assistant message is the warm checkout text, in its
    // own bubble below the card.
    const lastAssistant = assistantMessages[assistantMessages.length - 1];
    expect(lastAssistant?.booking).toBeUndefined();
    expect(lastAssistant?.content).toBe("Booking now…");
  });

  it("picks up the latest override at send-time (mid-conversation swap)", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(mockSseResponse([START_FRAME, DONE_FRAME]));

    const { result, rerender } = renderHook(
      ({ override }: { override: Record<string, number> | null }) =>
        useChatStream({ devPolicyOverride: override }),
      { initialProps: { override: null as Record<string, number> | null } },
    );

    await act(async () => {
      await result.current.send("first");
    });
    expect(
      JSON.parse((fetchSpy.mock.calls[0]![1] as RequestInit).body as string),
    ).not.toHaveProperty("dev_policy_override");

    // Swap preset → next send must include the new override.
    rerender({ override: { spend_cap_cents: 50_000 } });
    await act(async () => {
      await result.current.send("second");
    });
    const second = JSON.parse(
      (fetchSpy.mock.calls[1]![1] as RequestInit).body as string,
    );
    expect(second.dev_policy_override).toEqual({ spend_cap_cents: 50_000 });
  });

  // -------------------------------------------------------------------------
  // M2 — `event: checkout_link` (Stripe Checkout for modes 2/3)
  //
  // Mirrors the booking event tests but for `payment_pending` turns.
  // The buffering flush in `done` MUST also bail when a checkoutLink
  // landed — otherwise the buffered selection-turn text would leak
  // underneath the Checkout card.
  // -------------------------------------------------------------------------

  function checkoutLinkFrame(overrides: Record<string, unknown> = {}): string {
    return (
      "event: checkout_link\ndata: " +
      JSON.stringify({
        trip_id: "tr-mode2",
        checkout_url: "https://checkout.stripe.com/c/pay/cs_test_xyz",
        amount_cents: 51_900,
        currency: "EUR",
        ...overrides,
      }) +
      "\n\n"
    );
  }

  it("attaches checkoutLink to the last assistant message on `event: checkout_link`", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      mockSseResponse([
        START_FRAME,
        'event: message\ndata: {"content":"Click the link to complete your booking.","node":"checkout"}\n\n',
        checkoutLinkFrame(),
        'event: done\ndata: {"conversation_id":"conv-1","workflow_stage":"payment_pending"}\n\n',
      ]),
    );

    const { result } = renderHook(() => useChatStream());
    await act(async () => {
      await result.current.send("vol Marseille → Toulouse demain");
    });

    const lastAssistant = result.current.messages.findLast(
      (m) => m.role === "assistant",
    );
    expect(lastAssistant?.checkoutLink).toBeDefined();
    expect(lastAssistant?.checkoutLink?.checkout_url).toBe(
      "https://checkout.stripe.com/c/pay/cs_test_xyz",
    );
    expect(lastAssistant?.checkoutLink?.amount_cents).toBe(51_900);
    expect(lastAssistant?.checkoutLink?.currency).toBe("EUR");
  });

  it("on checkout_link, drops select text but surfaces checkout text as a separate bubble after the card", async () => {
    // Mode 2/3 selection turn. Same two-bubble shape as the booking
    // path: the CheckoutPaymentCard is one assistant bubble (with
    // empty content); the checkout_node intro ("Click the link to
    // complete your booking...") lands as a SECOND bubble after the
    // card. select_node's "On part sur l'option 1" is dropped.
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        mockSseResponse([
          START_FRAME,
          'event: done\ndata: {"conversation_id":"conv-1","workflow_stage":"awaiting_departure_selection"}\n\n',
        ]),
      )
      .mockResolvedValueOnce(
        mockSseResponse([
          START_FRAME,
          'event: message\ndata: {"content":"On part sur l\'option 1. ","node":"select"}\n\n',
          'event: message\ndata: {"content":"Click the link to complete your booking.","node":"checkout"}\n\n',
          checkoutLinkFrame(),
          'event: done\ndata: {"conversation_id":"conv-1","workflow_stage":"payment_pending"}\n\n',
        ]),
      );

    const { result } = renderHook(() => useChatStream());
    await act(async () => {
      await result.current.send("vol Marseille → Toulouse demain");
    });
    expect(result.current.workflowStage).toBe("awaiting_departure_selection");

    await act(async () => {
      await result.current.send("option 1");
    });

    const assistantMessages = result.current.messages.filter(
      (m) => m.role === "assistant",
    );
    const cardBubble = assistantMessages.find((m) => m.checkoutLink !== undefined);
    expect(cardBubble?.checkoutLink).toBeDefined();
    expect(cardBubble?.booking).toBeUndefined();
    expect(cardBubble?.content).toBe("");
    // checkout-node intro lands as the trailing bubble.
    const lastAssistant = assistantMessages[assistantMessages.length - 1];
    expect(lastAssistant?.content).toBe("Click the link to complete your booking.");
    // select-node text was dropped.
    expect(
      assistantMessages.some((m) => m.content.includes("On part sur")),
    ).toBe(false);
  });

  it("checkout_link card bubble has empty content; checkout intro lands as separate bubble after it", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        mockSseResponse([
          START_FRAME,
          'event: done\ndata: {"conversation_id":"conv-1","workflow_stage":"awaiting_departure_selection"}\n\n',
        ]),
      )
      .mockResolvedValueOnce(
        mockSseResponse([
          START_FRAME,
          'event: message\ndata: {"content":"Generating link…","node":"checkout"}\n\n',
          checkoutLinkFrame(),
          'event: done\ndata: {"conversation_id":"conv-1","workflow_stage":"payment_pending"}\n\n',
        ]),
      );

    const { result } = renderHook(() => useChatStream());
    await act(async () => {
      await result.current.send("turn 1");
    });
    await act(async () => {
      await result.current.send("option 1");
    });

    const assistantMessages = result.current.messages.filter(
      (m) => m.role === "assistant",
    );
    const cardBubble = assistantMessages.find((m) => m.checkoutLink !== undefined);
    expect(cardBubble?.checkoutLink).toBeDefined();
    expect(cardBubble?.content).toBe("");
    const lastAssistant = assistantMessages[assistantMessages.length - 1];
    expect(lastAssistant?.content).toBe("Generating link…");
  });

  // -------------------------------------------------------------------------
  // M2-H3 — Realtime subscription auto-morphs CheckoutPaymentCard to "paid"
  // when the Stripe webhook fires. Subscription is keyed on the trip_id of
  // the most recent un-paid checkout card; tearing down on reset/remount.
  // -------------------------------------------------------------------------

  it("subscribes to Supabase Realtime when a checkout_link arrives", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      mockSseResponse([
        START_FRAME,
        checkoutLinkFrame({ trip_id: "tr-realtime-1" }),
        'event: done\ndata: {"conversation_id":"conv-1","workflow_stage":"payment_pending"}\n\n',
      ]),
    );

    const { result } = renderHook(() => useChatStream());
    await act(async () => {
      await result.current.send("vol Marseille → Toulouse demain");
    });

    // Auth must be hydrated BEFORE the channel is created — otherwise
    // the subscription registers in `realtime.subscription` with
    // `claims_role='anon'` and RLS silently drops every event. This
    // assertion locks in the call ordering so a future refactor can't
    // accidentally reintroduce the anon-claims regression.
    expect(mockGetSession).toHaveBeenCalled();
    expect(mockSetAuth).toHaveBeenCalledWith("test-jwt-token");
    const setAuthOrder = mockSetAuth.mock.invocationCallOrder[0] ?? Infinity;
    const channelOrder = mockChannel.mock.invocationCallOrder[0] ?? -Infinity;
    expect(setAuthOrder).toBeLessThan(channelOrder);

    // Channel name is trip-scoped — the filter passed to `.on()`
    // narrows to that single transactions row.
    expect(mockChannel).toHaveBeenCalledWith("txn-tr-realtime-1");
    expect(mockOn).toHaveBeenCalledWith(
      "postgres_changes",
      expect.objectContaining({
        event: "UPDATE",
        schema: "public",
        table: "transactions",
        filter: "trip_id=eq.tr-realtime-1",
      }),
      expect.any(Function),
    );
    expect(mockSubscribe).toHaveBeenCalledTimes(1);
  });

  it("flips checkoutLink.paid=true on status='paid' AND keeps channel alive for M2-bis", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      mockSseResponse([
        START_FRAME,
        checkoutLinkFrame({ trip_id: "tr-paid-1" }),
        'event: done\ndata: {"conversation_id":"conv-1","workflow_stage":"payment_pending"}\n\n',
      ]),
    );

    const { result } = renderHook(() => useChatStream());
    await act(async () => {
      await result.current.send("turn 1");
    });
    expect(
      result.current.messages.findLast((m) => m.checkoutLink)?.checkoutLink?.paid,
    ).toBeFalsy();

    const removeChannelCallsBefore = mockRemoveChannel.mock.calls.length;

    // Simulate the FIRST webhook UPDATE (`status='paid'`, no
    // duffel_order_id yet — that comes in a second UPDATE later).
    expect(lastPostgresChangesHandler).toBeTruthy();
    await act(async () => {
      lastPostgresChangesHandler!({ new: { status: "paid" } });
    });

    const last = result.current.messages.findLast((m) => m.checkoutLink);
    expect(last?.checkoutLink?.paid).toBe(true);

    // CRITICAL: the channel must STAY alive after the paid morph.
    // Pre-fix this tore down the subscription, dropping the second
    // UPDATE (duffel_order_id) on the floor and leaving the
    // BookingConfirmationCard never hydrating. The teardown only runs
    // once `booking` attaches OR a terminal status arrives — covered
    // by the dedicated tests below.
    await new Promise((r) => setTimeout(r, 30));
    expect(mockRemoveChannel.mock.calls.length).toBe(removeChannelCallsBefore);
  });

  it("ignores non-terminal statuses on the Realtime channel", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      mockSseResponse([
        START_FRAME,
        checkoutLinkFrame({ trip_id: "tr-ignored-1" }),
        'event: done\ndata: {"conversation_id":"conv-1","workflow_stage":"payment_pending"}\n\n',
      ]),
    );

    const { result } = renderHook(() => useChatStream());
    await act(async () => {
      await result.current.send("turn 1");
    });
    await act(async () => {
      // `pending` is the seed status — Realtime won't actually deliver
      // it (no UPDATE has happened yet), but defensive: the handler
      // should ignore it cleanly.
      lastPostgresChangesHandler!({ new: { status: "pending" } });
    });

    const last = result.current.messages.findLast((m) => m.checkoutLink);
    expect(last?.checkoutLink?.paid).toBeFalsy();
    expect(last?.checkoutLink?.failed).toBeFalsy();
  });

  it("unsubscribes on conversation reset", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      mockSseResponse([
        START_FRAME,
        checkoutLinkFrame({ trip_id: "tr-cleanup-1" }),
        'event: done\ndata: {"conversation_id":"conv-1","workflow_stage":"payment_pending"}\n\n',
      ]),
    );

    const { result } = renderHook(() => useChatStream());
    await act(async () => {
      await result.current.send("turn 1");
    });
    expect(mockSubscribe).toHaveBeenCalled();
    const removeChannelCallsBefore = mockRemoveChannel.mock.calls.length;

    await act(async () => {
      result.current.reset();
    });

    await waitFor(() => {
      expect(mockRemoveChannel.mock.calls.length).toBeGreaterThan(
        removeChannelCallsBefore,
      );
    });
  });

  // ---------------------------------------------------------------
  // M2-bis Plan B — Realtime morph hydrates the BookingConfirmationCard
  // ---------------------------------------------------------------
  //
  // After the Stripe Checkout payment lands, the post-Checkout chain
  // (M2-bis) writes `duffel_order_id` to the transactions row. The
  // existing Realtime channel sees the UPDATE; the hook then fetches
  // `/api/trips/{trip_id}/booking-details` and morphs the latest
  // assistant message in place — same shape as the K1 SSE
  // `event: booking` frame, so ChatWindow renders the
  // BookingConfirmationCard with PNR + flight legs + PDF download.
  //
  // We exercise the path by capturing the postgres_changes handler
  // (already done by the existing setup) and dispatching a payload
  // with `duffel_order_id` set.

  function bookingDetailsFixture(
    overrides: Record<string, unknown> = {},
  ): Record<string, unknown> {
    return {
      trip_id: "tr-plan-b-1",
      booking_reference: "PNRPLB123",
      passenger_name: "Jean Dupont",
      amount_cents: 52_000,
      currency: "EUR",
      legs: [
        {
          origin_iata: "ORY",
          destination_iata: "MRS",
          departure_iso: "2026-06-02T08:00:00",
          arrival_iso: "2026-06-02T10:15:00",
          airline_name: "Air Stub",
        },
      ],
      ...overrides,
    };
  }

  it("attaches BookingDetails on the second UPDATE (paid then duffel_order_id)", async () => {
    // Production fires TWO sequential Realtime events:
    //   1. `set status='paid' where status='pending'`        (no order id)
    //   2. `set duffel_order_id=… where … is null`           (~5–20s later)
    // Pre-fix, the channel tore down between them — this regression
    // test forces them sequentially and asserts both morphs land.
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        mockSseResponse([
          START_FRAME,
          checkoutLinkFrame({ trip_id: "tr-plan-b-1" }),
          'event: done\ndata: {"conversation_id":"conv-1","workflow_stage":"payment_pending"}\n\n',
        ]),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(bookingDetailsFixture()), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );

    const { result } = renderHook(() => useChatStream());
    await act(async () => {
      await result.current.send("turn 1");
    });
    expect(lastPostgresChangesHandler).toBeTruthy();
    const removeChannelCallsBefore = mockRemoveChannel.mock.calls.length;

    // Event #1 — `status='paid'` only.
    await act(async () => {
      lastPostgresChangesHandler!({
        new: { status: "paid", duffel_order_id: null },
      });
    });
    expect(
      result.current.messages.findLast((m) => m.checkoutLink)?.checkoutLink?.paid,
    ).toBe(true);
    // Channel must still be alive — the booking-details fetch hasn't
    // happened yet, no teardown should have run.
    expect(mockRemoveChannel.mock.calls.length).toBe(removeChannelCallsBefore);

    // Event #2 — `duffel_order_id` arrives. Same row, full snapshot
    // includes the now-set status='paid' + the new order id.
    await act(async () => {
      lastPostgresChangesHandler!({
        new: { status: "paid", duffel_order_id: "ord_test_plan_b" },
      });
      // Settle the fetchAndAttachBooking microtasks.
      await Promise.resolve();
      await Promise.resolve();
    });

    // BFF route fetched.
    expect(fetchSpy).toHaveBeenLastCalledWith(
      "/api/trips/tr-plan-b-1/booking-details",
      expect.objectContaining({ method: "GET", cache: "no-store" }),
    );

    await waitFor(() => {
      const last = result.current.messages.findLast((m) => m.role === "assistant");
      expect(last?.booking?.booking_reference).toBe("PNRPLB123");
      expect(last?.booking?.legs).toHaveLength(1);
      expect(last?.booking?.legs[0]?.origin_iata).toBe("ORY");
    });

    // Now that booking is attached, the channel tears down.
    await waitFor(() => {
      expect(mockRemoveChannel.mock.calls.length).toBeGreaterThan(
        removeChannelCallsBefore,
      );
    });
  });

  it("does not attach booking when fetch fails (409 ticket_not_ready)", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        mockSseResponse([
          START_FRAME,
          checkoutLinkFrame({ trip_id: "tr-plan-b-409" }),
          'event: done\ndata: {"conversation_id":"conv-1","workflow_stage":"payment_pending"}\n\n',
        ]),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ code: "ticket_not_ready", message: "Booking not yet completed" }),
          { status: 409, headers: { "Content-Type": "application/json" } },
        ),
      );

    const { result } = renderHook(() => useChatStream());
    await act(async () => {
      await result.current.send("turn 1");
    });

    await act(async () => {
      lastPostgresChangesHandler!({
        new: { status: "paid", duffel_order_id: "ord_test_plan_b_409" },
      });
      await Promise.resolve();
      await Promise.resolve();
    });

    // The card flipped to paid (existing M2 morph), but no booking
    // attached (server says it's not ready yet — frontend will retry
    // on the next morph rather than render an empty card).
    const last = result.current.messages.findLast((m) => m.role === "assistant");
    expect(last?.checkoutLink?.paid).toBe(true);
    expect(last?.booking).toBeUndefined();
  });

  it("tears down channel when paid is followed by terminal status='refunded'", async () => {
    // Plan B can refund post-paid (PR 6 safety net fires when the
    // M2-bis Duffel chain blows up). Without this teardown signal the
    // channel would stay alive forever waiting for a `booking` that
    // will never come — a memory + websocket leak for the rest of the
    // session.
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      mockSseResponse([
        START_FRAME,
        checkoutLinkFrame({ trip_id: "tr-refunded-1" }),
        'event: done\ndata: {"conversation_id":"conv-1","workflow_stage":"payment_pending"}\n\n',
      ]),
    );

    const { result } = renderHook(() => useChatStream());
    await act(async () => {
      await result.current.send("turn 1");
    });
    const removeChannelCallsBefore = mockRemoveChannel.mock.calls.length;

    await act(async () => {
      lastPostgresChangesHandler!({ new: { status: "paid" } });
    });
    // Channel still alive after paid (M2-bis hasn't finished yet).
    expect(mockRemoveChannel.mock.calls.length).toBe(removeChannelCallsBefore);

    // Refund safety net fires.
    await act(async () => {
      lastPostgresChangesHandler!({ new: { status: "refunded" } });
    });

    const last = result.current.messages.findLast((m) => m.checkoutLink);
    expect(last?.checkoutLink?.failed).toBe(true);
    expect(last?.booking).toBeUndefined();

    await waitFor(() => {
      expect(mockRemoveChannel.mock.calls.length).toBeGreaterThan(
        removeChannelCallsBefore,
      );
    });
  });

  it("ignores duffel_order_id morph when payload lacks it (M2 paid-only event)", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      mockSseResponse([
        START_FRAME,
        checkoutLinkFrame({ trip_id: "tr-plan-b-no-order" }),
        'event: done\ndata: {"conversation_id":"conv-1","workflow_stage":"payment_pending"}\n\n',
      ]),
    );

    const { result } = renderHook(() => useChatStream());
    await act(async () => {
      await result.current.send("turn 1");
    });

    const fetchCallsBefore = fetchSpy.mock.calls.length;
    await act(async () => {
      // The first webhook (`checkout.session.completed`) flips status
      // to 'paid' but doesn't write duffel_order_id yet — that comes
      // later when the M2-bis chain finishes. Ensure we don't fetch
      // booking-details prematurely on every "paid" UPDATE.
      lastPostgresChangesHandler!({ new: { status: "paid" } });
      await Promise.resolve();
    });

    expect(fetchSpy.mock.calls.length).toBe(fetchCallsBefore);
  });
});
