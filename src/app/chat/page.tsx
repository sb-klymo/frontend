import { redirect } from "next/navigation";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { ChatWindow } from "./_components/ChatWindow";

/**
 * Authenticated chat page.
 *
 * Server Component: verifies the session server-side and redirects unsigned
 * users to /login before any client-side JS loads. No auth flicker.
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
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col">
      <header className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
        <h1 className="text-lg font-semibold">Klymo</h1>
        <span className="text-xs text-gray-500">{user.email}</span>
      </header>
      <ChatWindow />
    </main>
  );
}
