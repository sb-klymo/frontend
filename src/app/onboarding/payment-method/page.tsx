import { redirect } from "next/navigation";

import { createSupabaseServerClient } from "@/lib/supabase/server";

import { PaymentMethodForm } from "./_components/PaymentMethodForm";

/**
 * Onboarding step — save a card and choose the payment mode.
 *
 * Server Component: gates the page on a valid Supabase session and reads
 * the existing `auto_charge_enabled` preference from `user_metadata` so
 * the toggle starts pre-filled if the user is editing an existing
 * choice. The actual SetupIntent is fetched client-side on mount —
 * SetupIntents are short-lived, so we don't want them stale-cached
 * inside server-rendered HTML if the user holds the page open.
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

  const initialAutoCharge =
    typeof user.user_metadata?.auto_charge_enabled === "boolean"
      ? user.user_metadata.auto_charge_enabled
      : true;

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
