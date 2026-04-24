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
});
