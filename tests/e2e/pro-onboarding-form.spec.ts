/**
 * Phase 9 frontend — pro onboarding form happy path.
 *
 * Fresh Company signup → email validated → login → must land on
 * /onboarding/company-profile (not /chat). Submitting the form must
 * navigate to /onboarding/payment-method (the Stripe step).
 *
 * User-creation pattern: reuses the same inline signup + SQL UPDATE approach
 * used across the e2e suite (see _fixtures/userSetup.ts and
 * company-onboarding-card.spec.ts). A Company radio is checked before
 * submitting the signup form to set account_type='company' on the backend.
 *
 * The SQL UPDATE confirms the email and sets organization_id = NULL so the
 * chat-page guard (app/chat/page.tsx:74) reliably redirects to the form.
 */

import { execFileSync } from "node:child_process";

import { expect, test, type Page } from "@playwright/test";

// ---------------------------------------------------------------------------
// Psql helper — mirrors the pattern in _fixtures/userSetup.ts and
// company-onboarding-card.spec.ts. Dollar-quoting ($$...$$) prevents
// special characters in email addresses from escaping the query.
// ---------------------------------------------------------------------------

const PSQL_ARGS_BASE = [
  "-h", "127.0.0.1",
  "-p", "54322",
  "-U", "postgres",
  "-d", "postgres",
  "-tA",
] as const;

const PSQL_ENV = { ...process.env, PGPASSWORD: "postgres" } as const;

function psql(sql: string): string {
  return execFileSync(
    "psql",
    [...PSQL_ARGS_BASE, "-c", sql],
    { env: PSQL_ENV, stdio: "pipe" },
  ).toString().trim();
}

// ---------------------------------------------------------------------------
// Shared user-creation helper
//
// Signs up a fresh company user via the UI (Company radio checked), then uses
// psql to confirm the email and ensure organization_id is NULL so the
// /chat guard redirects to the onboarding form. Returns the email.
// ---------------------------------------------------------------------------

async function createFreshCompanyUser(page: Page): Promise<string> {
  const email = `e2e-co-${Date.now()}@klymo.local`;

  await page.goto("/signup");
  // Pick the Company account type — mirrors the pattern in auth.spec.ts.
  // Direct check (no count() guard): if the radio is missing we want a loud
  // failure here rather than a confusing assertion error later.
  await page.getByRole("radio", { name: /company/i }).check();

  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("password123456");
  await page.getByRole("button", { name: /create account/i }).click();

  // Wait for redirect (company signup may land on /chat or onboarding depending
  // on Phase 9 deploy state — we don't assert the destination here; we only
  // need the auth session to exist).
  await page.waitForURL(/\/(chat|onboarding)/);

  // Confirm email and ensure no org is attached so the redirect fires reliably.
  // account_type is already set to 'company' by the signup trigger (backend PR #68).
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

  return email;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.setTimeout(60_000);

test("Company signup lands on the form, not the chat", async ({ page }) => {
  const email = await createFreshCompanyUser(page);

  // Log out, then sign in fresh so the session reflects the confirmed email
  // and the server-side redirect logic runs from a clean state.
  await page.goto("/login");
  await page.getByLabel(/Email/i).fill(email);
  await page.getByLabel(/Password/i).fill("password123456");
  await page.getByRole("button", { name: /Sign in/i }).click();

  // Assertion #1: company admin with no org → redirected to the form.
  await expect(page).toHaveURL(/\/onboarding\/company-profile$/, { timeout: 15_000 });
  await expect(
    page.getByRole("heading", { name: /Set up your company on Klymo/i }),
  ).toBeVisible();

  // Fill editable v2 fields (labels match the <Field label="…"> props in
  // CompanyProfileForm.tsx — each wraps its input in a <label> element).
  // Locked fields (Plan, Billing mode, Transport allowed, Class allowed,
  // International travel) are display-only and must NOT be interacted with.
  await page.getByLabel(/Company name/i).fill("E2E Acme");
  await page.getByLabel(/Country/i).fill("France");
  await page.getByLabel(/Team size/i).selectOption("11-50");
  await page.getByLabel(/Billing email/i).fill("bills@e2e.local");
  await page.getByLabel(/Primary office city/i).fill("Paris");
  await page.getByLabel(/Workspace currency/i).selectOption("EUR");
  await page.getByLabel(/Cap per employee per flight/i).fill("500");
  // Approval mode stays at its default (self_serve) — no interaction needed.

  await page.getByRole("button", { name: /Create company/i }).click();

  // Assertion #2: successful form POST → backend returns stripe_setup_url
  // (settings.ONBOARDING_PAYMENT_URL in local env = http://localhost:3000/onboarding/payment-method).
  // The form calls window.location.assign(stripe_setup_url) on HTTP 201.
  await expect(page).toHaveURL(/\/onboarding\/payment-method$/, { timeout: 15_000 });
});

test("Company user with no org who manually visits /chat is redirected to the form", async ({ page }) => {
  const email = await createFreshCompanyUser(page);

  // Sign in via the login page so we have a valid session.
  await page.goto("/login");
  await page.getByLabel(/Email/i).fill(email);
  await page.getByLabel(/Password/i).fill("password123456");
  await page.getByRole("button", { name: /Sign in/i }).click();

  // Wait for any initial redirect to settle, then navigate directly to /chat.
  await page.waitForURL(/\/(chat|onboarding)/);
  await page.goto("/chat");

  // Assertion: the chat Server Component detects account_type='company' with
  // no organization_id and calls redirect('/onboarding/company-profile').
  await expect(page).toHaveURL(/\/onboarding\/company-profile$/, { timeout: 15_000 });
});
