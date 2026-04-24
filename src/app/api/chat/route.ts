/**
 * BFF proxy — forwards `POST /api/chat` from the browser to the backend's
 * authenticated `POST /chat` SSE endpoint.
 *
 * Why a proxy:
 *   1. The backend URL stays a server-side secret (NEXT_PUBLIC_ not needed).
 *   2. We attach the Supabase JWT server-side, so the browser never has to
 *      juggle tokens when calling the API from client components.
 *   3. CORS is sidestepped — browser always talks to same-origin /api/chat.
 *
 * `export const dynamic = "force-dynamic"` is CRITICAL — without it, Next.js
 * tries to cache the response and SSE breaks silently.
 */

import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    return new Response(
      JSON.stringify({ code: "unauthorized", message: "Not signed in" }),
      { status: 401, headers: { "Content-Type": "application/json" } },
    );
  }

  const backendUrl = process.env.NEXT_PUBLIC_API_URL;
  if (!backendUrl) {
    return new Response(
      JSON.stringify({ code: "misconfigured", message: "NEXT_PUBLIC_API_URL is not set" }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }

  const body = await request.text();

  const upstream = await fetch(`${backendUrl}/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
      Authorization: `Bearer ${session.access_token}`,
    },
    body,
  });

  if (!upstream.ok || !upstream.body) {
    const detail = await upstream.text();
    return new Response(detail, {
      status: upstream.status,
      headers: { "Content-Type": "application/json" },
    });
  }

  return new Response(upstream.body, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
      Connection: "keep-alive",
    },
  });
}
