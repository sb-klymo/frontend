/**
 * BFF proxy — forwards `GET /api/me` to the backend's authenticated
 * `GET /me`, attaching the Supabase JWT server-side. Mirrors
 * `app/api/dev/cards/route.ts` and `app/api/payment/setup-intent/route.ts`
 * — same auth model, same dispatch shape, plain JSON in / out.
 *
 * Used by the dev panel's PaymentStatusSection to show the current
 * user's payment_mode + saved-card status without minting a dedicated
 * dev endpoint on the backend. The /me endpoint itself is NOT
 * dev-gated (it's the canonical "who am I" endpoint), so this proxy
 * works in production too — the calling component (PaymentStatusSection)
 * is dev-only via DEV_BUILD.
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

  const upstream = await fetch(`${backendUrl}/me`, {
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
