/**
 * Next.js middleware — refreshes the Supabase session on every request.
 *
 * Without this, Supabase auth tokens expire silently (~1h) and server
 * components would see stale sessions. The middleware reads cookies, calls
 * `supabase.auth.getUser()` to validate/refresh them, and writes the updated
 * tokens back to the response.
 *
 * Skips static assets and Next.js internals via the `matcher` config.
 */

import { NextResponse, type NextRequest } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookies: { name: string; value: string; options: CookieOptions }[]) {
          for (const { name, value } of cookies) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookies) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  // Touching getUser() triggers the refresh+persist round-trip.
  await supabase.auth.getUser();

  return response;
}

export const config = {
  matcher: [
    // Skip Next.js internals and static assets.
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
