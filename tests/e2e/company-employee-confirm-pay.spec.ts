import { execFileSync } from "node:child_process";
import { expect, test } from "@playwright/test";

const PSQL_ARGS_BASE = ["-h", "127.0.0.1", "-p", "54322", "-U", "postgres", "-d", "postgres", "-tA"] as const;
const PSQL_ENV = { ...process.env, PGPASSWORD: "postgres" } as const;
function psql(sql: string): string {
  return execFileSync("psql", [...PSQL_ARGS_BASE, "-c", sql], { env: PSQL_ENV, stdio: "pipe" }).toString().trim();
}

test.setTimeout(180_000);

test("company confirm-then-charge — card gate then BookingConfirmationCard", async ({ page }) => {
  const email = `e2e-pc-emp-${Date.now()}@klymo.local`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("password123456");
  const companyRadio = page.getByRole("radio", { name: /company/i });
  if (await companyRadio.count()) await companyRadio.check();
  await page.getByRole("button", { name: /create account/i }).click();
  await page.waitForURL(/\/chat$/);

  const userId = psql(`SELECT id::text FROM auth.users WHERE email = $$${email}$$;`);
  psql(`
    INSERT INTO public.organizations (
      id, name, policy_rules, onboarding_completed_at,
      stripe_customer_id, stripe_payment_method_id, auto_charge_bookings
    ) VALUES (
      gen_random_uuid(), 'PC Test Co',
      jsonb_build_object(
        'max_amount_per_employee_flight', jsonb_build_object('amount_cents', 500000, 'currency', 'EUR'),
        'manager_approval_threshold', jsonb_build_object('amount_cents', 400000, 'currency', 'EUR')
      ),
      now(), 'cus_e2e_pc_org', 'pm_e2e_pc_org', false
    );
  `);
  const orgId = psql(`SELECT id::text FROM public.organizations WHERE name = 'PC Test Co' ORDER BY created_at DESC LIMIT 1;`);
  psql(`
    UPDATE public.users SET organization_id = '${orgId}', role = 'company_employee', account_type = 'company',
      first_name = $$TestEmployee$$, last_name = $$Smith$$, title = 'mr', gender = 'm', birthdate = '1990-01-01'
    WHERE id = '${userId}';
  `);
  await page.reload();
  await page.waitForURL(/\/chat$/);

  const input = page.getByPlaceholder(/ask about a trip|parlez-moi d.un voyage/i);
  await input.fill("Vol Marseille → Toulouse demain, aller simple, 1 passager, classe éco");
  await input.press("Enter");
  await expect(page.getByText(/Option 1/i).first()).toBeVisible({ timeout: 60_000 });
  await input.fill("option 1");
  await input.press("Enter");
  await expect(page.getByText(/extra|bagage|siège|priorité|autre chose|skip|non|pas besoin/i).last()).toBeVisible({ timeout: 60_000 });
  await input.fill("non c'est bon");
  await input.press("Enter");

  // Gate appears, NOT a booking yet.
  await expect(page.getByTestId("payment-confirmation-card")).toBeVisible({ timeout: 60_000 });
  expect(await page.getByText(/PNR|booking reference|réservation/i).count()).toBe(0);

  // Confirm → charge → booking card.
  await page.getByRole("button", { name: /vérifier & payer|review & pay/i }).click();
  await expect(page.getByText(/PNR|booking reference|réservation|billet/i).first()).toBeVisible({ timeout: 90_000 });
});
