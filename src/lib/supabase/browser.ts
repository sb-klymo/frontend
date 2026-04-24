"use client";

/**
 * Browser-side Supabase client factory.
 *
 * Creates one client per browser session. Reads the NEXT_PUBLIC_ env vars
 * (injected at build time). Auth cookies are managed by @supabase/ssr so
 * `supabase.auth.getSession()` stays in sync with the server.
 */

import { createBrowserClient } from "@supabase/ssr";

export function createSupabaseBrowserClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
