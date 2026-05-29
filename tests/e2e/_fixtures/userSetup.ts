/**
 * Shared E2E setup helpers — signup + DB seed to bypass onboarding.
 *
 * After the dual-onboarding rollout (2026-05-19), individual users land
 * in `workflow_stage='onboarding_personal_name'` on first chat turn.
 * The chat service skips onboarding when `users.first_name` is set
 * (src/chat/service.py:494-502). Tests that want to land directly in
 * the trip-booking flow must seed first_name before sending the first
 * message.
 *
 * Phase 14a (2026-05-28) added a SECOND gate after primary onboarding:
 * src/chat/service.py:584-604 routes any user without a complete
 * passenger profile (last_name + title + gender + birthdate) to
 * workflow_stage='onboarding_user_passenger' before any trip flow can
 * run. So we now seed those columns too — CHECK constraints accept
 * the Duffel-wire enums (`title in mr/mrs/ms/miss/dr`, `gender in m/f`).
 *
 * Two payment-mode flavours mirror what the agent routes on:
 *   - "checkout_fallback" (default) — no card on file → Plan B routing
 *   - "auto_charge"                  — saved card → inline auto-charge
 *
 * DB seed uses the same dollar-quoted psql pattern as approval-flow.spec.ts.
 */

import { execFileSync } from "node:child_process";

import { expect, type Page } from "@playwright/test";

const PSQL_ARGS_BASE = [
  "-h", "127.0.0.1",
  "-p", "54322",
  "-U", "postgres",
  "-d", "postgres",
  "-tA",
] as const;

const PSQL_ENV = { ...process.env, PGPASSWORD: "postgres" } as const;

export function psql(sql: string): string {
  return execFileSync(
    "psql",
    [...PSQL_ARGS_BASE, "-c", sql],
    { env: PSQL_ENV, stdio: "pipe" },
  ).toString().trim();
}

export type PaymentMode = "checkout_fallback" | "auto_charge";

export type SignupOptions = {
  prefix: string;
  paymentMode?: PaymentMode;
};

/**
 * Sign up a fresh individual user and seed their profile so the chat
 * service treats them as already-onboarded. Returns the email and the
 * chat input locator ready for the first message.
 */
export async function signupAndOnboard(
  page: Page,
  options: SignupOptions,
): Promise<{
  email: string;
  input: ReturnType<Page["getByPlaceholder"]>;
}> {
  const { prefix, paymentMode = "checkout_fallback" } = options;
  const email = `e2e-${prefix}-${Date.now()}@klymo.local`;

  await page.goto("/signup");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("password123456");
  await page.getByRole("button", { name: /create account/i }).click();
  await expect(page).toHaveURL(/\/chat$/);

  const paymentCols =
    paymentMode === "auto_charge"
      ? ", payment_mode = 'auto_charge', stripe_payment_method_id = 'pm_e2e_fixture'"
      : ", payment_mode = 'checkout_fallback'";

  psql(
    `UPDATE public.users
       SET first_name = $$TestUser$$,
           last_name  = $$Smith$$,
           title      = 'mr',
           gender     = 'm',
           birthdate  = '1990-01-01',
           account_type = 'individual'${paymentCols}
     WHERE id = (SELECT id FROM auth.users WHERE email = $$${email}$$);`,
  );

  return { email, input: page.getByPlaceholder(/ask about a trip|parlez-moi d.un voyage/i) };
}
