/**
 * Phase 8 — Agent Wallet end-to-end coverage.
 *
 * Scenario 2: a company employee with no individual payment-method setup
 * books a flight under the manager-approval threshold. Expected:
 *   - bot does NOT emit a Checkout link
 *   - K1 chain runs against the org's stripe_payment_method_id
 *   - bot emits BookingConfirmationCard with PNR + PDF
 *
 * Test setup: SQL-seed an admin + employee + org with org card set
 * (skipping Stripe SetupIntent UI). Set the policy threshold high so
 * the booking auto-approves (below threshold). Confirm the BookingConfirmationCard
 * appears and no "Payer maintenant" CTA.
 *
 * Stub Duffel (DUFFEL_MODE=stub) returns 3 deterministic offers for
 * Marseille→Toulouse at 450/540/620 EUR — all under the 4000€ threshold
 * seeded here, so all three auto-approve.
 */

import { execFileSync } from "node:child_process";

import { expect, test } from "@playwright/test";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PSQL_ARGS_BASE = [
  "-h", "127.0.0.1",
  "-p", "54322",
  "-U", "postgres",
  "-d", "postgres",
  "-tA",
] as const;

const PSQL_ENV = { ...process.env, PGPASSWORD: "postgres" } as const;

// Marseille→Toulouse, single-airport cities, no disambiguation step.
// Under DUFFEL_MODE=stub returns 450/540/620 EUR (all < 4000 EUR threshold).
const TRIP_QUERY = "Vol Marseille → Toulouse demain, 1 passager, classe éco";

// ---------------------------------------------------------------------------
// Psql helper — executes a single SQL statement via execFileSync.
// Dollar-quoting ($$...$$) is used for string values so that special
// characters in emails cannot escape the query.
// ---------------------------------------------------------------------------

function psql(sql: string): string {
  return execFileSync(
    "psql",
    [...PSQL_ARGS_BASE, "-c", sql],
    { env: PSQL_ENV, stdio: "pipe" },
  ).toString().trim();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.setTimeout(180_000);

test("company employee auto-books — no Checkout link, BookingConfirmationCard appears", async ({ page }) => {
  const employeeEmail = `e2e-aw-emp-${Date.now()}@klymo.local`;

  // Signup as a company user (becomes the employee)
  await page.goto("/signup");
  await page.getByLabel("Email").fill(employeeEmail);
  await page.getByLabel("Password").fill("password123456");
  const companyRadio = page.getByRole("radio", { name: /company/i });
  if (await companyRadio.count()) await companyRadio.check();
  await page.getByRole("button", { name: /create account/i }).click();
  await page.waitForURL(/\/chat$/);

  // Pre-seed: skip onboarding for this user by linking them to an org
  // with onboarding done + saved card.
  const userId = psql(
    `SELECT id::text FROM auth.users WHERE email = $$${employeeEmail}$$;`,
  );

  // Create the org with saved card and high manager-approval threshold (4000€)
  // so all 450-620€ stub offers auto-approve.
  psql(`
    INSERT INTO public.organizations (
      id, name, policy_rules, onboarding_completed_at,
      stripe_customer_id, stripe_payment_method_id
    )
    VALUES (
      gen_random_uuid(),
      'AW Test Co',
      jsonb_build_object(
        'max_amount_per_employee_flight', jsonb_build_object('amount_cents', 500000, 'currency', 'EUR'),
        'manager_approval_threshold', jsonb_build_object('amount_cents', 400000, 'currency', 'EUR')
      ),
      now(),
      'cus_e2e_aw_org', 'pm_e2e_aw_org'
    );
  `);
  const orgId = psql(
    `SELECT id::text FROM public.organizations WHERE name = 'AW Test Co' ORDER BY created_at DESC LIMIT 1;`,
  );

  // Link the user as employee with role=company_employee, account_type=company.
  // Also set first_name so the bot skips the name-collection step.
  psql(`
    UPDATE public.users
       SET organization_id = '${orgId}',
           role = 'company_employee',
           account_type = 'company',
           first_name = $$TestEmployee$$
     WHERE id = '${userId}';
  `);

  // Reload so the new linkage is read by the chat
  await page.reload();
  await page.waitForURL(/\/chat$/);

  // Send a flight search. Use a route + threshold combination such that the
  // result is UNDER the manager threshold (4000€) so the offer auto-approves.
  const input = page.getByPlaceholder(/ask about a trip/i);
  await input.fill(TRIP_QUERY);
  await input.press("Enter");
  // Wait for the option list to render before sending the next message.
  await expect(
    page.getByText(/Option 1/i).first(),
  ).toBeVisible({ timeout: 60_000 });

  // Pick option 1
  await input.fill("option 1");
  await input.press("Enter");
  // Wait for the extras / ancillary prompt before skipping.
  await expect(
    page.getByText(/extra|bagage|siège|priorité|autre chose|skip|non|pas besoin/i).last(),
  ).toBeVisible({ timeout: 60_000 });

  // Skip extras
  await input.fill("non c'est bon");
  await input.press("Enter");
  // K1 chain (Stripe + Duffel stub) takes longer than a typical turn —
  // poll until BookingConfirmationCard text appears instead of sleeping.
  await expect(
    page.getByText(/PNR|booking reference|réservation|billet/i).first(),
  ).toBeVisible({ timeout: 90_000 });

  // ASSERTION 1: No "Payer maintenant" CTA appears (the Checkout link card)
  const checkoutLinkCount = await page
    .getByRole("link", { name: /payer maintenant|pay now/i })
    .count();
  expect(checkoutLinkCount).toBe(0);

  // ASSERTION 2: BookingConfirmationCard appears — already polled above (90s),
  // this is a belt-and-suspenders re-check with a short grace window.
  await expect(
    page.getByText(/PNR|booking reference|réservation/i).first(),
  ).toBeVisible({ timeout: 2_000 });
});
