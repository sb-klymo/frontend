/**
 * BFF proxy — forwards `POST /api/payment/setup-intent` to the backend's
 * authenticated `POST /payment/setup-intent`, attaching the Supabase JWT
 * server-side so the browser never juggles tokens.
 *
 * Mirrors `app/api/chat/route.ts` — same auth model, same dispatch shape,
 * minus the SSE streaming concerns (this endpoint returns plain JSON).
 */

import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    return Response.json(
      { code: "unauthorized", message: "Not signed in" },
      { status: 401 },
    );
  }

  const backendUrl = process.env.NEXT_PUBLIC_API_URL;
  if (!backendUrl) {
    return Response.json(
      { code: "misconfigured", message: "NEXT_PUBLIC_API_URL is not set" },
      { status: 500 },
    );
  }

  const upstream = await fetch(`${backendUrl}/payment/setup-intent`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.access_token}`,
    },
  });

  const body = await upstream.text();
  return new Response(body, {
    status: upstream.status,
    headers: { "Content-Type": "application/json" },
  });
}
