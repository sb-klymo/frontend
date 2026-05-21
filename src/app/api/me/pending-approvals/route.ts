/**
 * BFF proxy — forwards `GET /api/me/pending-approvals` to the backend's
 * authenticated `GET /me/pending-approvals`, attaching the Supabase JWT
 * server-side. Mirrors `src/app/api/me/route.ts` exactly.
 *
 * Called on chat mount by `useChatStream` to detect approval rows that
 * a manager has decided since the user last had the chat open. The hook
 * auto-dispatches `/api/chat/resume-approval` for each decided row so
 * the conversation continues from where it left off (the
 * `awaiting_approval` graph node).
 *
 * Returns a JSON array of ApprovalRequest objects (all statuses — the
 * frontend filters for `status !== "pending"` before firing resume).
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

  const upstream = await fetch(`${backendUrl}/me/pending-approvals`, {
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
