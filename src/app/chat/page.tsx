import { redirect } from "next/navigation";

import { createSupabaseServerClient } from "@/lib/supabase/server";

import { ChatRoot } from "./_components/ChatRoot";
import { LogoutButton } from "./_components/LogoutButton";

/**
 * Authenticated chat page.
 *
 * Server Component: verifies the session server-side and redirects unsigned
 * users to /login before any client-side JS loads. No auth flicker.
 *
 * Also fetches the backend's `/me` server-side to extract `is_team` — the
 * server-derived allowlist flag that decides whether `<DevPanel>` renders
 * in production builds. Doing this in the page (not in `ChatRoot`) means
 * the panel either renders on first paint or doesn't — no client-side
 * flicker while a /me query resolves. Single source of truth lives on the
 * backend (`TEAM_EMAILS` env var on Render); the frontend never decides
 * who's "team" on its own.
 *
 * Layout: full-viewport flex column with a sticky header, then the
 * `<ChatRoot>` client wrapper which handles the dev-panel-vs-chat
 * split and owns the single `useChatStream` instance.
 */
type Me = {
  is_team?: boolean;
  account_type?: "company" | "individual";
  organization_id?: string | null;
};

async function fetchMe(accessToken: string): Promise<Me> {
  /**
   * Server-side `/me` fetch. Failure-tolerant: any error (backend down,
   * network blip, malformed payload) returns `{}` so callers get safe
   * defaults. Mirrors the BFF proxy at `/api/me/route.ts` but inline
   * because we need the result during page render, not in an effect.
   */
  const backendUrl = process.env.NEXT_PUBLIC_API_URL;
  if (!backendUrl) {
    return {};
  }
  try {
    const res = await fetch(`${backendUrl}/me`, {
      method: "GET",
      headers: { Authorization: `Bearer ${accessToken}` },
      // Server-rendered Next.js fetches default to cache: 'force-cache' on
      // some configs — pin to no-store so a refresh after an allowlist
      // change reflects the new state.
      cache: "no-store",
    });
    if (!res.ok) return {};
    return (await res.json()) as Me;
  } catch {
    return {};
  }
}

export default async function ChatPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    redirect("/login");
  }

  const me = await fetchMe(session.access_token);

  // Phase 9: company users without an org must complete the onboarding form
  // first. The backend's /api/chat also enforces this with HTTP 403 — this
  // guard runs earlier (page render) so the user never sees a chat flash.
  if (me.account_type === "company" && !me.organization_id) {
    redirect("/onboarding/company-profile");
  }

  const isTeam = me.is_team === true;

  return (
    <main className="flex h-screen flex-col">
      <header className="flex shrink-0 items-center justify-between border-b border-gray-200 px-4 py-3">
        <h1 className="text-lg font-semibold">Klymo</h1>
        <div className="flex items-center gap-3">
          <span className="text-xs text-gray-500">{session.user.email}</span>
          <LogoutButton />
        </div>
      </header>
      <ChatRoot isTeam={isTeam} />
    </main>
  );
}
