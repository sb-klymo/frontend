# Chat UI — SSE Consumption and Streaming UX

The chat interface consumes server-sent events (SSE) from `POST /chat` on the backend. Streaming must feel natural (token-by-token), handle disconnection gracefully, and never block the UI.

## Why not native `EventSource`?

Native `EventSource` can't send `Authorization` headers. Since we use Supabase JWTs for auth, we need `fetch` + `ReadableStream` + `TextDecoder`, parsing SSE frames manually.

Exception: if we move to cookie-based auth, `EventSource` becomes viable again.

## Recommended pattern — `useChatStream` hook

```tsx
// src/hooks/useChatStream.ts
"use client";

import { useState, useCallback, useRef } from "react";

type ChatMessage = { role: "user" | "assistant"; content: string };

export function useChatStream(endpoint: string, authToken: string) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const send = useCallback(
    async (userMessage: string) => {
      // Append user message immediately
      setMessages((prev) => [...prev, { role: "user", content: userMessage }, { role: "assistant", content: "" }]);
      setIsStreaming(true);

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${authToken}`,
            Accept: "text/event-stream",
          },
          body: JSON.stringify({ message: userMessage }),
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

          // Parse SSE frames: `data: {...}\n\n`
          const parts = buffer.split("\n\n");
          buffer = parts.pop() ?? "";

          for (const part of parts) {
            const line = part.trim();
            if (!line.startsWith("data:")) continue;
            const payload = line.slice(5).trim();
            if (payload === "[DONE]") break;

            try {
              const chunk = JSON.parse(payload);
              // Append to the last assistant message
              setMessages((prev) => {
                const updated = [...prev];
                const last = updated[updated.length - 1];
                if (last?.role === "assistant") {
                  updated[updated.length - 1] = {
                    ...last,
                    content: last.content + (chunk.delta ?? ""),
                  };
                }
                return updated;
              });
            } catch {
              // Ignore malformed frames
            }
          }
        }
      } finally {
        setIsStreaming(false);
        abortRef.current = null;
      }
    },
    [endpoint, authToken],
  );

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  return { messages, isStreaming, send, stop };
}
```

## UX rules

- **Token-by-token rendering** — set state on each chunk. Do not buffer tokens.
- **Instant user message** — append the user's message before starting the stream.
- **Typing indicator** — render "..." while `isStreaming` and the assistant's content is empty.
- **Abort support** — user can stop generation mid-stream.
- **Reconnection** — if the connection drops, show a retry button. Do NOT auto-retry silently (could hide backend errors).
- **Markdown rendering** — use `react-markdown` or similar for bot responses (they contain formatting).

## Server-side route handler (BFF pattern)

Optionally proxy through a Next.js Route Handler to hide the backend URL and attach cookies:

```ts
// src/app/api/chat/route.ts
export const dynamic = "force-dynamic";  // critical — prevents caching

export async function POST(request: Request) {
  const { message } = await request.json();
  const authToken = /* read from cookie */;

  const upstream = await fetch(`${process.env.BACKEND_URL}/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${authToken}`,
    },
    body: JSON.stringify({ message }),
  });

  return new Response(upstream.body, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
```

## What NOT to do

- Never use native `EventSource` for auth-gated endpoints (can't send headers)
- Never buffer tokens before rendering — defeats the purpose of streaming
- Never forget `export const dynamic = "force-dynamic"` in the Route Handler (Vercel will try to cache)
- Never render bot messages as `innerHTML` — always use safe text/markdown rendering
- Never silently retry on disconnection — surface the error to the user
