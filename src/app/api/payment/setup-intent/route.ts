/**
 * BFF proxy — forwards `POST /api/payment/setup-intent` to the backend's
 * authenticated `POST /payment/setup-intent`, attaching the Supabase JWT
 * server-side so the browser never juggles tokens.
 *
 * Mirrors `app/api/chat/route.ts` — same auth model, same dispatch shape,
 * minus the SSE streaming concerns (this endpoint returns plain JSON).
 *
 * Phase 8 Agent Wallet: for company_admin callers this route resolves
 * the user's `role` + `organization_id` from `public.users` and forwards
 * `{ target: "organization", org_id }` in the body to the backend so the
 * resulting SetupIntent carries metadata that routes the `setup_intent.succeeded`
 * webhook to `public.organizations` (instead of `public.users`).
 *
 * Individual users and company employees (defensive — they shouldn't call
 * this endpoint in V1) receive `{ target: "user" }` as a safe fallback.
 */

import {
  createSupabaseAdminClient,
  createSupabaseServerClient,
} from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Minimal public.users columns needed to determine SetupIntent routing. */
type UserContext = {
  role: string | null;
  organization_id: string | null;
  account_type: string | null;
};

/**
 * Resolve `role`, `organization_id`, and `account_type` for the current user.
 *
 * Uses the service-role admin client so this read is not blocked by RLS —
 * the route performs its own auth check (valid Supabase session) before
 * calling this. Returns null on any error so the route degrades gracefully
 * to the safe `target: "user"` fallback.
 */
async function fetchUserContext(userId: string): Promise<UserContext | null> {
  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from("users")
      .select("role, organization_id, account_type")
      .eq("id", userId)
      .single();
    if (error || !data) return null;
    return data as UserContext;
  } catch {
    return null;
  }
}

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

  // Determine SetupIntent routing metadata for the backend.
  // company_admin → target=organization so the webhook writes the company card
  // to public.organizations. All other callers → target=user (safe fallback).
  const userCtx = await fetchUserContext(session.user.id);
  const isCompanyAdmin =
    userCtx?.account_type === "company" &&
    userCtx?.role === "company_admin" &&
    Boolean(userCtx?.organization_id);

  const requestBody = isCompanyAdmin
    ? { target: "organization", org_id: userCtx!.organization_id }
    : { target: "user" };

  const upstream = await fetch(`${backendUrl}/payment/setup-intent`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify(requestBody),
  });

  const body = await upstream.text();
  return new Response(body, {
    status: upstream.status,
    headers: { "Content-Type": "application/json" },
  });
}
