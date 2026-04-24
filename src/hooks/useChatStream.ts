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

import { useCallback, useRef, useState } from "react";
import { useChatStore } from "@/stores/chatStore";

export type ChatRole = "user" | "assistant" | "system";

export type ChatMessage = {
  id: string;
  role: ChatRole;
  content: string;
};

type ServerEvent =
  | { type: "start"; conversation_id: string }
  | { type: "message"; content: string; node?: string }
  | { type: "done"; workflow_stage: string | null; conversation_id: string }
  | { type: "error"; code: string; message: string };

function randomId(): string {
  return (
    globalThis.crypto?.randomUUID?.() ??
    Math.random().toString(36).slice(2) + Date.now().toString(36)
  );
}

export function useChatStream(endpoint: string = "/api/chat") {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

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
              case "done":
                setConversationId(event.conversation_id);
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
    ],
  );

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    setMessages([]);
    setError(null);
    useChatStore.getState().resetConversation();
  }, []);

  return { messages, error, isStreaming, send, stop, reset };
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
