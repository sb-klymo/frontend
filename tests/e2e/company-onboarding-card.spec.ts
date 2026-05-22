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

  // Signup as company admin
  await page.goto("/signup");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("password123456");
  const companyRadio = page.getByRole("radio", { name: /company/i });
  if (await companyRadio.count()) await companyRadio.check();
  await page.getByRole("button", { name: /create account/i }).click();
  await page.waitForURL(/\/chat$/);

  // Walk through company onboarding (company name + cap + threshold)
  const input = page.getByPlaceholder(/ask about a trip/i);
  for (const message of ["bonjour", "ACME Test E2E", "ok pour 500€", "oui", "ok"]) {
    await input.fill(message);
    await input.press("Enter");
    await page.waitForTimeout(15_000);
  }

  // At this point bot should be parked at onboarding_payment_redirect.
  // The chat should show the OnboardingCard with "Ajouter la carte d'entreprise" copy.
  // Verify by checking for the company-card-flavored text (per locked decision #8):
  await expect(
    page.getByText(/carte d'entreprise|company card/i).first(),
  ).toBeVisible({ timeout: 5_000 });

  // Simulate the SetupIntent webhook completing: write to org row directly.
  const userId = psql(
    `SELECT id::text FROM auth.users WHERE email = $$${email}$$;`,
  );
  const orgId = psql(
    `SELECT organization_id::text FROM public.users WHERE id = '${userId}';`,
  );
  if (!orgId) {
    throw new Error("Org not created during onboarding — onboarding state broken");
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
