"use client";

import { useEffect, useRef } from "react";

import { useChatStream } from "@/hooks/useChatStream";
import { useChatStore } from "@/stores/chatStore";

import { OptionList } from "./OptionList";

export function ChatWindow() {
  const { messages, error, isStreaming, send, stop, reset, language } =
    useChatStream();
  const draft = useChatStore((s) => s.draft);
  const setDraft = useChatStore((s) => s.setDraft);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to the latest message on every update.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, isStreaming]);

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const text = draft.trim();
    if (!text || isStreaming) return;
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
          <EmptyState />
        ) : (
          messages.map((m) =>
            m.offers ? (
              // Structured offers replace the redundant text bubble — the
              // OptionList carries the same info more cleanly.
              <OptionList key={m.id} offers={m.offers} language={language} />
            ) : (
              <Bubble key={m.id} role={m.role} content={m.content} streaming={false} />
            ),
          )
        )}
        {isStreaming && messages[messages.length - 1]?.role !== "assistant" && (
          <Bubble role="assistant" content="…" streaming />
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
          placeholder="Ask about a trip…"
          rows={1}
          disabled={isStreaming}
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
            disabled={!draft.trim()}
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
