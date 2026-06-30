import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) {
    return Response.json({ code: "unauthorized", message: "Not signed in" }, { status: 401 });
  }
  const backendUrl = process.env.NEXT_PUBLIC_API_URL;
  if (!backendUrl) {
    return Response.json({ code: "misconfigured", message: "NEXT_PUBLIC_API_URL is not set" }, { status: 500 });
  }
  const body = await request.text(); // { conversation_id, decision }
  const upstream = await fetch(`${backendUrl}/chat/resume-payment-confirmation`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
    body,
  });
  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
