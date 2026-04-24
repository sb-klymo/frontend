/**
 * Server-side Supabase client factory (Route Handlers, Server Components).
 *
 * Reads and writes auth cookies via Next.js's `cookies()` API so the session
 * is kept in sync across server and browser. Creates a fresh client per
 * request — do not cache it across requests.
 */

import { cookies } from "next/headers";
import { createServerClient, type CookieOptions } from "@supabase/ssr";

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
