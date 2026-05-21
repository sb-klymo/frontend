/**
 * BFF route — proxies POST /api/chat/resume-approval to the backend.
 *
 * Pattern mirrors src/app/api/chat/resume-extras/route.ts: forwards the
 * user's Supabase JWT server-side (never exposed to the browser), pipes
 * the upstream SSE response back to the client.
 *
 * Special case: the backend returns 204 No Content when there's nothing
 * to resume (already resumed, approval still pending, etc.). We pass
 * that through without a body so the FE useChatStream silently no-ops.
 *
 * Called by useChatStream's pending-approval listener on chat mount when
 * it detects a decided approval row from GET /api/me/pending-approvals.
 * The backend re-enters the approval_required graph node with the decision
 * and emits a new bubble (extras prompt for approved, polite-cancel for
 * rejected) downstream.
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

  const upstream = await fetch(`${backendUrl}/chat/resume-approval`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
      Authorization: `Bearer ${session.access_token}`,
    },
    body,
  });

  // Pass through 204 (nothing to resume — FE silently no-ops)
  if (upstream.status === 204) {
    return new Response(null, { status: 204 });
  }

  // Pass through non-success errors as-is
  if (!upstream.ok || !upstream.body) {
    const detail = await upstream.text();
    return new Response(detail, {
      status: upstream.status,
      headers: {
        "Content-Type": upstream.headers.get("Content-Type") ?? "application/json",
      },
    });
  }

  // Pipe SSE stream back to the client
  return new Response(upstream.body, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
      Connection: "keep-alive",
    },
  });
}
