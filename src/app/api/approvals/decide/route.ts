/**
 * POST /api/approvals/decide — BFF proxy for the approval decision endpoint.
 *
 * The browser calls this route; this route calls the backend's internal
 * endpoint `POST /internal/approvals/{id}/decide` using the shared service
 * secret (KLYMO_INTERNAL_SHARED_SECRET), which is NEVER exposed to the browser.
 *
 * Auth model:
 *   - Browser → this route: Supabase session cookie (validated via getUser())
 *   - This route → backend: Bearer KLYMO_INTERNAL_SHARED_SECRET in header
 *
 * The deciding_user_id is read from the verified session (never from the
 * request body — the browser cannot be trusted for this field).
 *
 * Request body: { approval_id: string, action: "approve"|"reject", decision_reason?: string }
 * Backend body: { action, deciding_user_id, decision_reason? }
 */

import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RequestBody = {
  approval_id: string;
  action: "approve" | "reject";
  decision_reason?: string;
};

export async function POST(request: Request) {
  // 1. Verify Supabase session
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return Response.json(
      { code: "unauthorized", message: "Not signed in" },
      { status: 401 },
    );
  }

  // 2. Validate env
  const backendUrl = process.env.NEXT_PUBLIC_API_URL;
  if (!backendUrl) {
    return Response.json(
      { code: "misconfigured", message: "NEXT_PUBLIC_API_URL is not set" },
      { status: 500 },
    );
  }

  const internalSecret = process.env.KLYMO_INTERNAL_SHARED_SECRET;
  if (!internalSecret) {
    return Response.json(
      { code: "misconfigured", message: "KLYMO_INTERNAL_SHARED_SECRET is not set" },
      { status: 500 },
    );
  }

  // 3. Parse and validate the request body
  let body: RequestBody;
  try {
    body = (await request.json()) as RequestBody;
  } catch {
    return Response.json(
      { code: "bad_request", message: "Invalid JSON body" },
      { status: 400 },
    );
  }

  const { approval_id, action, decision_reason } = body;

  if (!approval_id || typeof approval_id !== "string") {
    return Response.json(
      { code: "bad_request", message: "approval_id is required" },
      { status: 400 },
    );
  }

  if (action !== "approve" && action !== "reject") {
    return Response.json(
      { code: "bad_request", message: "action must be 'approve' or 'reject'" },
      { status: 400 },
    );
  }

  // 4. Forward to the backend internal endpoint
  //    - Authorization uses KLYMO_INTERNAL_SHARED_SECRET (NOT the user's JWT)
  //    - deciding_user_id is sourced from the verified session
  const backendBody = {
    action,
    deciding_user_id: user.id,
    ...(decision_reason ? { decision_reason } : {}),
  };

  const upstream = await fetch(
    `${backendUrl}/internal/approvals/${encodeURIComponent(approval_id)}/decide`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${internalSecret}`,
      },
      body: JSON.stringify(backendBody),
    },
  );

  // 5. Return the backend response as-is
  const upstreamBody = await upstream.text();
  return new Response(upstreamBody, {
    status: upstream.status,
    headers: {
      "Content-Type":
        upstream.headers.get("Content-Type") ?? "application/json",
    },
  });
}
