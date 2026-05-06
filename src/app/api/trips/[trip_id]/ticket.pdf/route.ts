/**
 * BFF proxy — forwards `GET /api/trips/{trip_id}/ticket.pdf` to the
 * backend's `GET /trips/{trip_id}/ticket.pdf`, attaching the Supabase
 * JWT server-side. Mirrors the auth pattern used by other BFF routes
 * (`app/api/payment/setup-intent`, `app/api/dev/cards`).
 *
 * The response body is a PDF (binary). We forward the upstream
 * `Content-Type`, `Content-Disposition`, and `Cache-Control` so the
 * browser sees the same headers it would from a direct backend hit.
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
    `${backendUrl}/trips/${encodeURIComponent(trip_id)}/ticket.pdf`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${session.access_token}`,
      },
    },
  );

  // Forward upstream body (PDF bytes) + the headers the browser cares
  // about. We don't surface the body when upstream is a JSON error;
  // either way the body shape matches what the user-facing request
  // would have received from a direct hit.
  const headers = new Headers();
  const contentType = upstream.headers.get("content-type");
  if (contentType) headers.set("Content-Type", contentType);
  const contentDisposition = upstream.headers.get("content-disposition");
  if (contentDisposition) headers.set("Content-Disposition", contentDisposition);
  const cacheControl = upstream.headers.get("cache-control");
  if (cacheControl) headers.set("Cache-Control", cacheControl);

  return new Response(upstream.body, {
    status: upstream.status,
    headers,
  });
}
