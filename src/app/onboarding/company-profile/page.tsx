import { redirect } from "next/navigation";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { CompanyProfileForm } from "./_components/CompanyProfileForm";

/**
 * Pro-onboarding form page (Phase 9 frontend).
 *
 * Server Component: gates the page on a valid Supabase session and on the
 * user being a company admin who hasn't completed onboarding yet. Reads
 * `/me` from the backend to get `account_type` and `organization_id` —
 * single source of truth for the dispatch decision (mirrors what
 * `app/chat/page.tsx` does for the reverse routing).
 *
 * Redirect matrix:
 *   - no session         → /login
 *   - account_type='individual' → /chat   (form is not for them)
 *   - has organization_id AND org_payment_method_saved → /chat (already done)
 *   - otherwise → render the form
 */
type Me = {
  account_type?: "company" | "individual";
  organization_id?: string | null;
  org_payment_method_saved?: boolean;
};

async function fetchMe(accessToken: string): Promise<Me | null> {
  const backendUrl = process.env.NEXT_PUBLIC_API_URL;
  if (!backendUrl) return null;
  try {
    const res = await fetch(`${backendUrl}/me`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
    });
    if (!res.ok) return null;
    return (await res.json()) as Me;
  } catch {
    return null;
  }
}

export default async function CompanyProfileOnboardingPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    redirect("/login");
  }

  const me = await fetchMe(session.access_token);

  // Defensive fall-through: if /me failed, render the form anyway —
  // the form's POST will return 401/403/409 and the form handles those.
  if (me?.account_type === "individual") {
    redirect("/chat");
  }

  if (me?.organization_id && me.org_payment_method_saved) {
    redirect("/chat");
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-gray-50 px-4 py-12">
      <div className="w-full max-w-2xl space-y-6 rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        <header>
          <h1 className="text-2xl font-bold">Set up your company on Klymo</h1>
          <p className="mt-1 text-sm text-gray-600">
            One-time profile — we&apos;ll create your workspace and policy in one step.
            Card details come next.
          </p>
        </header>

        <CompanyProfileForm />
      </div>
    </main>
  );
}
