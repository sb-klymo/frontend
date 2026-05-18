/**
 * BFF proxy — forwards `GET` / `PATCH /api/dev/org/policy-rules` to the
 * backend's authenticated `GET` / `PATCH /dev/org/policy-rules`,
 * attaching the Supabase JWT server-side. Mirrors `app/api/dev/cards/route.ts`
 * — same auth model, same dispatch shape, plain JSON in / out.
 *
 * Backend gates the upstream with `_require_dev_env_or_team` (404 in
 * production unless the user is on the `TEAM_EMAILS` allowlist), so a
 * non-team prod request that reaches the upstream gets the same opaque
 * 404 a typo'd URL would. Frontend gates the DevPanel via
 * `DEV_BUILD || isTeam` so the route is never invoked from a non-team
 * prod build; this proxy exists for the team-prod path AND the
 * dev/staging path.
 *
 * Read uses GET, write uses PATCH (overwrite semantics — body is the
 * full PolicyRules envelope). Both proxy the upstream JSON response
 * verbatim so error codes / messages round-trip cleanly to the
 * dev-panel hook.
 */

import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function authedProxy(
  request: Request,
  init: { method: "GET" | "PATCH" },
): Promise<Response> {
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

  // Pass through the body verbatim for PATCH; GET has no body. Using
  // request.text() preserves whatever the client sent (including
  // Pydantic-rejectable values) so the backend's 422 surfaces with the
  // original payload context.
  const body = init.method === "PATCH" ? await request.text() : undefined;

  const upstream = await fetch(`${backendUrl}/dev/org/policy-rules`, {
    method: init.method,
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body,
  });

  const upstreamBody = await upstream.text();
  return new Response(upstreamBody, {
    status: upstream.status,
    headers: { "Content-Type": "application/json" },
  });
}

export async function GET(request: Request): Promise<Response> {
  return authedProxy(request, { method: "GET" });
}

export async function PATCH(request: Request): Promise<Response> {
  return authedProxy(request, { method: "PATCH" });
}
