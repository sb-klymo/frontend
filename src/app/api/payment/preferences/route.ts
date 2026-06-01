/**
 * BFF proxy — forwards `PATCH /api/payment/preferences` to the backend's
 * authenticated `PATCH /payment/preferences`, attaching the Supabase JWT
 * server-side so the browser never juggles tokens. Body `{ auto_charge: boolean }`
 * is passed through verbatim.
 *
 * Mirrors `app/api/payment/setup-intent/route.ts` — same auth model.
 */
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function PATCH(request: Request) {
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

  const body = await request.text(); // { "auto_charge": boolean }
  const upstream = await fetch(`${backendUrl}/payment/preferences`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.access_token}`,
    },
    body,
  });

  const text = await upstream.text();
  return new Response(text, {
    status: upstream.status,
    headers: { "Content-Type": "application/json" },
  });
}
