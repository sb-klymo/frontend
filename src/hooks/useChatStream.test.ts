import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useChatStore } from "@/stores/chatStore";
import { useChatStream } from "./useChatStream";

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
});
