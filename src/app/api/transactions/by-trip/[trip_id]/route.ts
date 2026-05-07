/**
 * BFF proxy — forwards `GET /api/transactions/by-trip/{trip_id}` to
 * the backend's `GET /transactions/by-trip/{trip_id}`, attaching the
 * Supabase JWT server-side.
 *
 * Powers the M2 `/payment/success` Server Component, which Stripe
 * Checkout redirects to after the user pays. Same auth pattern as the
 * sibling routes.
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
    `${backendUrl}/transactions/by-trip/${encodeURIComponent(trip_id)}`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${session.access_token}`,
      },
    },
  );

  const body = await upstream.text();
  return new Response(body, {
    status: upstream.status,
    headers: { "Content-Type": "application/json" },
  });
}
