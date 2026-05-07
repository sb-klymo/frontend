"use client";

/**
 * Browser-side Supabase client — process-singleton.
 *
 * Returns the same instance for every caller. The single instance
 * matters for Realtime: supabase-js wires `auth.onAuthStateChange` to
 * `realtime.setAuth(token)` automatically on `SIGNED_IN` /
 * `TOKEN_REFRESHED`, but cookie hydration is async. Per-call factories
 * created a race where a fresh client's first `channel.subscribe()`
 * fired before the auth listener propagated the user's JWT, so the
 * subscription registered with `claims_role = 'anon'` and RLS
 * silently dropped every `postgres_changes` event for tables policied
 * `to authenticated`.
 *
 * One memoized client = the auth listener fires once at module load,
 * has settled long before any UI flow reaches `subscribe()` (user
 * sends a chat message, sees options, clicks one — many seconds), and
 * the JWT is in place by subscribe-time.
 */

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

let _client: SupabaseClient | null = null;

export function createSupabaseBrowserClient(): SupabaseClient {
  if (!_client) {
    _client = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    );
  }
  return _client;
}
