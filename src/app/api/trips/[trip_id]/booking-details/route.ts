/**
 * BFF proxy — forwards `GET /api/trips/{trip_id}/booking-details` to the
 * backend's `GET /trips/{trip_id}/booking-details`, attaching the Supabase
 * JWT server-side. Hydrates the chat-side `BookingConfirmationCard` for
 * the M2-bis Plan B chain — the webhook path can't push the SSE
 * `event: booking` frame K1 uses, so the chat fetches the same shape via
 * REST after the Realtime morph fires.
 *
 * Mirrors the ticket.pdf BFF's auth pattern (same `createSupabaseServerClient`
 * → forward Bearer token → forward the upstream JSON body verbatim).
 */

import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ trip_id: string }> },
) {
  const { trip_id } = await context.params;

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

  const upstream = await fetch(
    `${backendUrl}/trips/${encodeURIComponent(trip_id)}/booking-details`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        Accept: "application/json",
      },
      // The chat refetches on each Realtime morph; the cache header
      // is set defensively here too in case a CDN sits in between.
      cache: "no-store",
    },
  );

  // Forward upstream body verbatim. The backend already returns
  // application/json with the BookingDetailsResponse schema (or a
  // KlymoException JSON for 4xx/5xx).
  const body = await upstream.text();
  return new Response(body, {
    status: upstream.status,
    headers: {
      "Content-Type": upstream.headers.get("content-type") ?? "application/json",
    },
  });
}
