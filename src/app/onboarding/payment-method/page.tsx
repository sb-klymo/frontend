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

  // Single source of truth: public.users.payment_mode. The checkbox is
  // checked iff the user previously chose auto-charge. A brand-new user
  // (payment_mode='checkout_fallback') starts unchecked — no false promise.
  let initialAutoCharge = false;
  try {
    const admin = createSupabaseAdminClient();
    const { data } = await admin
      .from("users")
      .select("payment_mode")
      .eq("id", user.id)
      .single();
    initialAutoCharge = deriveInitialAutoCharge(data?.payment_mode);
  } catch {
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

        <PaymentMethodForm initialAutoCharge={initialAutoCharge} />
      </div>
    </main>
  );
}
