/**
 * Server-side Supabase client factory (Route Handlers, Server Components).
 *
 * Reads and writes auth cookies via Next.js's `cookies()` API so the session
 * is kept in sync across server and browser. Creates a fresh client per
 * request — do not cache it across requests.
 */

import { cookies } from "next/headers";
import { createClient } from "@supabase/supabase-js";
import { createServerClient, type CookieOptions } from "@supabase/ssr";

/**
 * Service-role Supabase client — bypasses RLS.
 *
 * Use ONLY in server-side code (Server Components, Route Handlers) where you
 * need to read rows that RLS would block for the current user, but you then
 * perform your own auth checks in code before returning any data to the client.
 *
 * NEVER expose the service role key to the browser.
 */
export function createSupabaseAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    },
  );
}

export async function createSupabaseServerClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookies: { name: string; value: string; options: CookieOptions }[]) {
          // Server Components cannot set cookies; swallow silently. The
          // middleware (src/middleware.ts) is responsible for writing refreshed
          // auth cookies back to the browser.
          try {
            for (const { name, value, options } of cookies) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // noop
          }
        },
      },
    },
  );
}
