/**
 * BFF proxy — forwards `POST /api/onboarding/company-profile` to the backend's
 * authenticated `POST /onboarding/company-profile`, attaching the Supabase JWT
 * server-side. Mirrors `app/api/payment/setup-intent/route.ts`.
 *
 * The backend handles all validation, account_type checks, and 409/422 cases.
 * This route is a pure pass-through so the browser never sees the backend URL
 * and never juggles tokens.
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

  try {
    const body = await request.text();
    const upstream = await fetch(`${backendUrl}/onboarding/company-profile`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body,
    });

    const upstreamBody = await upstream.text();
    return new Response(upstreamBody, {
      status: upstream.status,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[onboarding/company-profile] upstream error", err);
    return Response.json(
      { code: "upstream_error", message: "Could not reach backend" },
      { status: 502 },
    );
  }
}
