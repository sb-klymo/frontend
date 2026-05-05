/**
 * BFF proxy — forwards `GET /api/dev/cards` to the backend's
 * authenticated `GET /dev/cards`, attaching the Supabase JWT
 * server-side. Mirrors `app/api/payment/setup-intent/route.ts`
 * — same auth model, same dispatch shape, plain JSON in / out.
 *
 * Backend gates this endpoint with `_require_dev_env` (404 in
 * production), so a request that reaches here in production
 * naturally returns a 404 rather than leaking the dev surface.
 * Frontend gates the calling component (`IssuingCardsSection`)
 * via `DEV_BUILD` so the route is never invoked in production
 * builds anyway — this proxy exists only for the dev-mode panel.
 */

import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
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

  const upstream = await fetch(`${backendUrl}/dev/cards`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${session.access_token}`,
    },
  });

  const body = await upstream.text();
  return new Response(body, {
    status: upstream.status,
    headers: { "Content-Type": "application/json" },
  });
}
