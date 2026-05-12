"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

export function LogoutButton() {
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);

  async function onClick() {
    if (signingOut) return;
    setSigningOut(true);
    const supabase = createSupabaseBrowserClient();
    try {
      // `scope: 'local'` revokes only this session's refresh token —
      // sibling tabs/devices stay signed in. The default `'global'`
      // would surprise a user who has the admin dashboard open in
      // another tab.
      await supabase.auth.signOut({ scope: "local" });
    } finally {
      // Redirect even on error: the server-side getUser() check on
      // /chat will catch any still-valid session on next nav.
      router.replace("/login");
      router.refresh();
    }
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={signingOut}
      data-testid="logout-button"
      className="rounded-md border border-gray-300 px-2.5 py-1 text-xs text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {signingOut ? "Signing out…" : "Sign out"}
    </button>
  );
}
