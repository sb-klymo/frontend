/**
 * Phase 8 — Agent Wallet end-to-end coverage.
 *
 * Scenario 3: company employee books a flight ABOVE the manager-approval
 * threshold. Expected:
 *   1. Bot shows ApprovalPendingCard (Phase 6 behavior)
 *   2. Admin approves via direct DB update (simulating email-click)
 *   3. Realtime triggers resumeApproval → chat shows resume bubble
 *   4. Bot continues to extras prompt
 *   5. Employee says "non" → bot auto-charges against org card → BookingConfirmationCard
 *   6. NO Checkout link at any step
 *
 * Stub Duffel (DUFFEL_MODE=stub) returns 3 deterministic offers for
 * Marseille→Toulouse at 450/540/620 EUR. With a 100€ manager-approval
 * threshold, all three stub offers trigger approval.
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
// Under DUFFEL_MODE=stub returns 450/540/620 EUR (all > 100 EUR threshold).
const TRIP_QUERY = "Vol Marseille → Toulouse demain, 1 passager";

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

test.setTimeout(240_000);

test("company employee approval-then-auto-charge — no Checkout link", async ({ page }) => {
  const employeeEmail = `e2e-aw-approved-emp-${Date.now()}@klymo.local`;
  const adminEmail = `e2e-aw-approved-admin-${Date.now()}@klymo.local`;

  // Signup as company employee
  await page.goto("/signup");
  await page.getByLabel("Email").fill(employeeEmail);
  await page.getByLabel("Password").fill("password123456");
  const companyRadio = page.getByRole("radio", { name: /company/i });
  if (await companyRadio.count()) await companyRadio.check();
  await page.getByRole("button", { name: /create account/i }).click();
  await page.waitForURL(/\/chat$/);

  const employeeId = psql(
    `SELECT id::text FROM auth.users WHERE email = $$${employeeEmail}$$;`,
  );

  // Create org with saved card + low 100€ threshold so all stub offers flag.
  psql(`
    INSERT INTO public.organizations (
      id, name, policy_rules, onboarding_completed_at,
      stripe_customer_id, stripe_payment_method_id
    ) VALUES (
      gen_random_uuid(),
      'AW Approved Test Co',
      jsonb_build_object(
        'max_amount_per_employee_flight', jsonb_build_object('amount_cents', 1000000, 'currency', 'EUR'),
        'manager_approval_threshold', jsonb_build_object('amount_cents', 10000, 'currency', 'EUR')
      ),
      now(),
      'cus_e2e_aw_approved', 'pm_e2e_aw_approved'
    );
  `);
  const orgId = psql(
    `SELECT id::text FROM public.organizations WHERE name = 'AW Approved Test Co' ORDER BY created_at DESC LIMIT 1;`,
  );

  // Seed admin user directly in auth.users + public.users.
  // crypt() + gen_salt('bf') produces a valid bcrypt password hash for local
  // Supabase auth (password value here is not used — admin never logs in).
  psql(`
    INSERT INTO auth.users (id, email, created_at, updated_at, aud, role, email_confirmed_at, encrypted_password)
    VALUES (gen_random_uuid(), '${adminEmail}', now(), now(), 'authenticated', 'authenticated', now(),
            crypt('test', gen_salt('bf')));
  `);
  const adminId = psql(
    `SELECT id::text FROM auth.users WHERE email = '${adminEmail}';`,
  );
  psql(`
    INSERT INTO public.users (id, organization_id, role, account_type, created_at, updated_at)
    VALUES ('${adminId}', '${orgId}', 'company_admin', 'company', now(), now())
    ON CONFLICT (id) DO UPDATE
      SET organization_id = EXCLUDED.organization_id,
          role = EXCLUDED.role;
  `);

  // Link employee to org; set first_name to skip name-collection step.
  psql(`
    UPDATE public.users
       SET organization_id = '${orgId}',
           role = 'company_employee',
           account_type = 'company',
           first_name = $$TestApprovedEmployee$$
     WHERE id = '${employeeId}';
  `);

  // Reload so the new linkage is read by the chat
  await page.reload();
  await page.waitForURL(/\/chat$/);

  const input = page.getByPlaceholder(/ask about a trip/i);

  // Trigger a flight search. With a 100€ threshold all stub offers (450-620€)
  // will be flagged for manager approval.
  await input.fill(TRIP_QUERY);
  await input.press("Enter");
  // Wait for the option list to render before picking.
  await expect(
    page.getByText(/Option 1/i).first(),
  ).toBeVisible({ timeout: 60_000 });

  // Pick offer — any option will be above the 100€ threshold
  await input.fill("option 1");
  await input.press("Enter");

  // ASSERTION: ApprovalPendingCard should appear — poll for it directly.
  await expect(
    page.getByTestId("approval-pending-card").first(),
  ).toBeVisible({ timeout: 60_000 });

  // Simulate admin clicking Approve via direct DB update + decided_by_user_id.
  // Mirrors the pattern used in approval-flow.spec.ts.
  const approvalId = psql(`
    SELECT ar.id::text
      FROM public.approval_requests ar
      JOIN auth.users au ON au.id = ar.requesting_user_id
     WHERE au.email = $$${employeeEmail}$$
     ORDER BY ar.created_at DESC LIMIT 1;
  `);
  psql(`
    UPDATE public.approval_requests
       SET status = 'approved',
           decided_at = now(),
           decided_by_user_id = '${adminId}'
     WHERE id = '${approvalId}';
  `);

  // Wait for Realtime → resumeApproval → resume bubble appears.
  // Poll directly instead of sleeping; Supabase Realtime pushes the status
  // change and the chat client re-enters the graph.
  await expect(
    page.getByText(/validé|approuvé|feu vert|donné son accord|on continue|approved|continuing/i).first(),
  ).toBeVisible({ timeout: 60_000 });

  // Wait for the extras / ancillary prompt before skipping.
  await expect(
    page.getByText(/extra|bagage|siège|priorité|autre chose|skip|non|pas besoin/i).last(),
  ).toBeVisible({ timeout: 60_000 });

  // Skip extras — bot continues to checkout with org card
  await input.fill("non c'est bon");
  await input.press("Enter");
  // K1 chain (Stripe virtual-card + Duffel order stub) takes longer —
  // poll until BookingConfirmationCard text appears instead of sleeping.
  await expect(
    page.getByText(/PNR|booking reference|réservation|billet/i).first(),
  ).toBeVisible({ timeout: 90_000 });

  // ASSERTION 1: No "Payer maintenant" CTA appears at any point
  const checkoutLinkCount = await page
    .getByRole("link", { name: /payer maintenant|pay now/i })
    .count();
  expect(checkoutLinkCount).toBe(0);

  // ASSERTION 2: BookingConfirmationCard appears — already polled above (90s).
  await expect(
    page.getByText(/PNR|booking reference|réservation/i).first(),
  ).toBeVisible({ timeout: 2_000 });
});
