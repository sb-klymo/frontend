import { redirect } from "next/navigation";

import { createSupabaseServerClient } from "@/lib/supabase/server";

import { ChatRoot } from "./_components/ChatRoot";

/**
 * Authenticated chat page.
 *
 * Server Component: verifies the session server-side and redirects unsigned
 * users to /login before any client-side JS loads. No auth flicker.
 *
 * Layout: full-viewport flex column with a sticky header, then the
 * `<ChatRoot>` client wrapper which handles the dev-panel-vs-chat
 * split and owns the single `useChatStream` instance.
 */
export default async function ChatPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  return (
    <main className="flex h-screen flex-col">
      <header className="flex shrink-0 items-center justify-between border-b border-gray-200 px-4 py-3">
        <h1 className="text-lg font-semibold">Klymo</h1>
        <span className="text-xs text-gray-500">{user.email}</span>
      </header>
      <ChatRoot />
    </main>
  );
}
