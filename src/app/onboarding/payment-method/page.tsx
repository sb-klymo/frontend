import { redirect } from "next/navigation";

import {
  createSupabaseAdminClient,
  createSupabaseServerClient,
} from "@/lib/supabase/server";

import { PaymentMethodForm } from "./_components/PaymentMethodForm";
import { deriveInitialAutoCharge } from "./_lib/initialAutoCharge";

/**
 * Onboarding step — save a card and choose the payment mode.
 *
 * Server Component: gates the page on a valid Supabase session and reads
 * the user's existing `payment_mode` (single source of truth) so the
 * toggle starts checked iff they previously chose auto-charge. The actual
 * SetupIntent is fetched client-side on mount — SetupIntents are
 * short-lived, so we don't want them stale-cached inside server-rendered
 * HTML if the user holds the page open.
 *
 * Lives at `/onboarding/payment-method/` rather than under the spec'd
 * `(app)/onboarding/` route group because the existing pages
 * (`/chat`, `/login`, `/signup`) are still flat — moving everything
 * into `(app)` is its own refactor and can land later without behavior
 * changes here.
 */
export default async function PaymentMethodPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  // Determine scope + initial toggle state.
  //   company_admin with an org → "org" scope, reads org policy.
  //   everyone else → "user" scope, reads individual payment_mode.
  let scope: "user" | "org" = "user";
  let initialAutoCharge = false;
  try {
    const admin = createSupabaseAdminClient();
    const { data: u } = await admin
      .from("users")
      .select("payment_mode, role, account_type, organization_id")
      .eq("id", user.id)
      .single();
    const isCompanyAdmin =
      u?.account_type === "company" &&
      u?.role === "company_admin" &&
      Boolean(u?.organization_id);
    if (isCompanyAdmin) {
      scope = "org";
      const { data: org } = await admin
        .from("organizations")
        .select("auto_charge_bookings")
        .eq("id", u!.organization_id)
        .single();
      // Column default is true; a missing row falls back to true (matches DB).
      initialAutoCharge = org?.auto_charge_bookings ?? true;
    } else {
      initialAutoCharge = deriveInitialAutoCharge(u?.payment_mode);
    }
  } catch {
    scope = "user";
    initialAutoCharge = false;
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-gray-50 px-4 py-12">
      <div className="w-full max-w-md space-y-6 rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        <header>
          <h1 className="text-2xl font-bold">Save your card</h1>
          <p className="mt-1 text-sm text-gray-600">
            Klymo charges your bookings via Stripe. Card details are entered
            into Stripe&apos;s secure iframe — they never touch our server.
          </p>
        </header>

        <PaymentMethodForm initialAutoCharge={initialAutoCharge} scope={scope} />
      </div>
    </main>
  );
}
