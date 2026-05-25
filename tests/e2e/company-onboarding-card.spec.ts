/**
 * Phase 8 — Agent Wallet end-to-end coverage.
 *
 * Scenario 1: company admin onboarding saves the company card on the
 * organizations row (via SetupIntent webhook with target=organization
 * metadata), not on the user row. After save: organizations.stripe_*
 * is populated, /me returns org_payment_method_saved=true.
 *
 * Stripe SetupIntent UI completion can't be driven in Playwright
 * without Stripe Elements iframe interaction (sandboxed). For V1 we
 * simulate the post-SetupIntent webhook by directly writing to
 * organizations.stripe_* via psql, then verifying /me reports the
 * new state. The "test the metadata flow" piece is covered by the
 * BACKEND unit tests (test_setup_intent_org_target.py); this E2E
 * verifies the END STATE the user observes.
 *
 * Company onboarding is now FORM-BASED (PR #52): after signup the app
 * redirects to /onboarding/company-profile (a multi-field form). This
 * test was updated from the stale chat-based flow to match the current
 * form-based onboarding. The psql webhook simulation + /me assertions
 * (the unique coverage not present in pro-onboarding-form.spec.ts) are
 * preserved unchanged.
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

test("company admin onboarding flow — company card saved on org row", async ({ page }) => {
  const email = `e2e-aw-admin-${Date.now()}@klymo.local`;

  // Signup as company admin (Company radio checked so account_type='company'
  // is set on the backend trigger — same pattern as pro-onboarding-form.spec.ts).
  await page.goto("/signup");
  await page.getByRole("radio", { name: /company/i }).check();
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("password123456");
  await page.getByRole("button", { name: /create account/i }).click();

  // Wait for any initial redirect to settle (company signup may land on
  // /chat or /onboarding depending on session state).
  await page.waitForURL(/\/(chat|onboarding)/);

  // Confirm email and ensure organization_id is NULL so the /chat guard
  // reliably redirects to the form (mirrors pro-onboarding-form.spec.ts).
  psql(
    `UPDATE auth.users
        SET email_confirmed_at = now()
      WHERE email = $$${email}$$;`,
  );
  psql(
    `UPDATE public.users
        SET organization_id = NULL
      WHERE id = (SELECT id FROM auth.users WHERE email = $$${email}$$);`,
  );

  // Log in fresh so the server-side redirect logic runs from a clean session
  // that reflects the confirmed email.
  await page.goto("/login");
  await page.getByLabel(/Email/i).fill(email);
  await page.getByLabel(/Password/i).fill("password123456");
  await page.getByRole("button", { name: /Sign in/i }).click();

  // Assertion: company admin with no org → redirected to the onboarding form.
  await expect(page).toHaveURL(/\/onboarding\/company-profile$/, { timeout: 15_000 });
  await expect(
    page.getByRole("heading", { name: /Set up your company on Klymo/i }),
  ).toBeVisible();

  // Fill the v2 form fields (labels match the <Field label="…"> props in
  // CompanyProfileForm.tsx — selectors mirror pro-onboarding-form.spec.ts).
  // Locked display-only fields (Plan, Billing mode, Transport, Class,
  // International travel) are intentionally skipped.
  await page.getByLabel(/Company name/i).fill("ACME Test E2E");
  await page.getByLabel(/Country/i).fill("France");
  await page.getByLabel(/Team size/i).selectOption("11-50");
  await page.getByLabel(/Billing email/i).fill("bills@e2e-aw.local");
  await page.getByLabel(/Primary office city/i).fill("Paris");
  await page.getByLabel(/Workspace currency/i).selectOption("EUR");
  await page.getByLabel(/Cap per employee per flight/i).fill("50000");
  // Approval mode stays at its default (self_serve) — no interaction needed.

  await page.getByRole("button", { name: /Create company/i }).click();

  // The form POST returns HTTP 201 with stripe_setup_url; the form calls
  // window.location.assign(stripe_setup_url). In local env this resolves to
  // /onboarding/payment-method (ONBOARDING_PAYMENT_URL backend setting).
  await expect(page).toHaveURL(/\/onboarding\/payment-method$/, { timeout: 15_000 });

  // At this point the org has been created and organization_id is set on the
  // user row. Simulate the SetupIntent webhook completing: write to org row
  // directly (same technique as Phase 8 original test).
  const userId = psql(
    `SELECT id::text FROM auth.users WHERE email = $$${email}$$;`,
  );
  const orgId = psql(
    `SELECT organization_id::text FROM public.users WHERE id = '${userId}';`,
  );
  if (!orgId) {
    throw new Error("Org not created during form onboarding — onboarding state broken");
  }

  psql(
    `UPDATE public.organizations
        SET stripe_customer_id = 'cus_e2e_aw_admin',
            stripe_payment_method_id = 'pm_e2e_aw_admin',
            onboarding_completed_at = now()
      WHERE id = '${orgId}';`,
  );

  // Verify via /me that the field flipped to true.
  // /me is the source of truth read by PaymentStatusSection.
  const meResponse = await page.evaluate(async () => {
    const res = await fetch("/api/me");
    return await res.json() as Record<string, unknown>;
  });

  expect(meResponse.account_type).toBe("company");
  expect(meResponse.organization_id).toBe(orgId);
  expect(meResponse.org_payment_method_saved).toBe(true);
});
