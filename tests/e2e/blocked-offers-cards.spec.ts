/**
 * Phase 11 — Blocked Offers as Read-Only Cards.
 *
 * ## What we're pinning
 *
 * When a company employee's org has a spend cap so low that every Duffel stub
 * offer (450/540/620 EUR) exceeds it, the previous behavior was a 40-line
 * hardcoded-English text wall listing the blocked flights. After Phase 11:
 *
 *   1. The backend curates the 3 cheapest blocked offers into `DisplayedOffer`s.
 *   2. It emits `event: options` with `selectable: false`, a localized header,
 *      and a localized "adjust your trip" footer.
 *   3. The frontend renders the 3 cards read-only (red "✗ bloqué"/"✗ blocked"
 *      badge + localized over-cap reason) under the header.
 *   4. The interactive "répondez option 1 pour réserver" footer is ABSENT.
 *   5. The old text wall is ABSENT.
 *
 * ## Setup
 *
 * Seeds a company employee + org with `spend_cap_cents: 500` (€5 cap).
 * Under DUFFEL_MODE=stub all three stub offers (450/540/620 EUR) exceed the
 * cap, so every offer is policy_blocked and the backend takes the all-blocked
 * branch.
 *
 * ## Backend caveat
 *
 * The test suite hits the backend on :8000. If that server is running the
 * pre-Phase-11 code (primary checkout, `main` branch), it will return the old
 * text wall and the blocked-card assertions will fail. That is an expected
 * environment artifact — the spec is correct for the Phase-11 branch and will
 * pass once the phase-11 backend is running (CI / post-merge).
 *
 * When the stale backend is detected, the failure is:
 *   "Expected [option-list-header] to be visible" (no cards emitted at all, or
 *    the old text wall rendered instead of the structured options event).
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

/**
 * Marseille→Toulouse: single-airport cities (no disambiguation). Stub Duffel
 * returns 3 deterministic offers at 450/540/620 EUR. With a €5 cap, all three
 * are policy_blocked.
 */
const TRIP_QUERY =
  "Vol Marseille → Toulouse demain, aller simple, 1 passager, classe éco";

// ---------------------------------------------------------------------------
// Psql helper
// ---------------------------------------------------------------------------

function psql(sql: string): string {
  return execFileSync(
    "psql",
    [...PSQL_ARGS_BASE, "-c", sql],
    { env: PSQL_ENV, stdio: "pipe" },
  ).toString().trim();
}

// ---------------------------------------------------------------------------
// Spec
// ---------------------------------------------------------------------------

test.describe("Phase 11 — Blocked offers as read-only cards", () => {
  // One full chat turn (search → present_options → SSE flush) takes 15-45s
  // under the stub. 120s is comfortable headroom.
  test.setTimeout(120_000);

  test(
    "low spend cap (€5) → 3 read-only blocked cards, no booking footer",
    async ({ page }) => {
      // -------------------------------------------------------------------
      // 1. Sign up a company employee
      // -------------------------------------------------------------------
      const employeeEmail = `e2e-blocked-cards-${Date.now()}@klymo.local`;

      await page.goto("/signup");
      await page.getByLabel("Email").fill(employeeEmail);
      await page.getByLabel("Password").fill("password123456");
      // Some builds render a company/personal radio; click it if present.
      const companyRadio = page.getByRole("radio", { name: /company/i });
      if (await companyRadio.count()) await companyRadio.check();
      await page.getByRole("button", { name: /create account/i }).click();
      await page.waitForURL(/\/chat$/);

      // -------------------------------------------------------------------
      // 2. Seed: link employee to org with spend_cap = 500 cents (€5)
      //    — ensures every stub offer (450/540/620 EUR) is policy_blocked.
      //
      //    We deliberately do NOT set manager_approval_threshold so that the
      //    policy engine takes the spend-cap-blocked path, not the flagged
      //    path. The backend's all-blocked branch (no compliant options)
      //    is what produces selectable=false.
      // -------------------------------------------------------------------
      const userId = psql(
        `SELECT id::text FROM auth.users WHERE email = $$${employeeEmail}$$;`,
      );

      psql(`
        INSERT INTO public.organizations (
          id, name, policy_rules, onboarding_completed_at,
          stripe_customer_id, stripe_payment_method_id
        )
        VALUES (
          gen_random_uuid(),
          'Blocked Cards Test Co',
          jsonb_build_object(
            'spend_cap_cents', 500,
            'max_amount_per_employee_flight', jsonb_build_object('amount_cents', 500, 'currency', 'EUR')
          ),
          now(),
          'cus_e2e_blocked_cards', 'pm_e2e_blocked_cards'
        );
      `);

      const orgId = psql(
        `SELECT id::text FROM public.organizations WHERE name = 'Blocked Cards Test Co' ORDER BY created_at DESC LIMIT 1;`,
      );

      // Set first_name so the chat service skips the onboarding name-collection
      // step (service.py:494-502 bypasses onboarding_personal_name when set).
      psql(`
        UPDATE public.users
           SET organization_id = '${orgId}',
               role             = 'company_employee',
               account_type     = 'company',
               first_name       = $$TestBlockedEmployee$$
         WHERE id = '${userId}';
      `);

      // Reload so the new linkage is picked up by the chat session.
      await page.reload();
      await page.waitForURL(/\/chat$/);

      // -------------------------------------------------------------------
      // 3. Send flight search
      // -------------------------------------------------------------------
      const input = page.getByPlaceholder(/ask about a trip/i);
      await input.fill(TRIP_QUERY);
      await input.press("Enter");

      // -------------------------------------------------------------------
      // 4. Wait for the OptionList to render (option-list-header testid is
      //    emitted ONLY by the chat OptionList component, not the dev-panel
      //    sidebar buttons — so this scoping is precise).
      // -------------------------------------------------------------------
      await expect(page.getByTestId("option-list-header")).toBeVisible({
        timeout: 90_000,
      });

      // -------------------------------------------------------------------
      // 5. Assert: exactly 3 offer cards are rendered.
      //    `slice-info-row` is unique to the chat OptionCard component.
      // -------------------------------------------------------------------
      const sliceRows = page.getByTestId("slice-info-row");
      await expect(sliceRows).toHaveCount(3, { timeout: 10_000 });

      // -------------------------------------------------------------------
      // 6. Assert: each card shows the blocked badge.
      //    The badge text is "✗ bloqué" (FR) or "✗ blocked" (EN) depending
      //    on the detected language. We match both with a flexible regex.
      // -------------------------------------------------------------------
      const badgeCells = page.getByText(/✗\s*(bloqué|blocked)/i);
      // At least 3 badges (one per card).
      expect(await badgeCells.count()).toBeGreaterThanOrEqual(3);

      // -------------------------------------------------------------------
      // 7. Assert: each card shows a localized over-cap reason.
      //    FR: "Dépasse votre plafond de voyage"
      //    EN: "Over your travel-policy cap"
      // -------------------------------------------------------------------
      const reasonCells = page.getByText(/plafond|cap/i);
      // At least 3 reason texts (one per card).
      expect(await reasonCells.count()).toBeGreaterThanOrEqual(3);

      // -------------------------------------------------------------------
      // 8. Assert: the interactive booking footer is ABSENT.
      //    The "répondez option 1"/"reply option 1 to book" text must not
      //    appear anywhere in the rendered option list footer.
      // -------------------------------------------------------------------
      const optionListFooter = page.getByTestId("option-list-footer");
      // If a footer is shown at all, it must be the adjust-criteria hint,
      // not the interactive booking instruction.
      if (await optionListFooter.count() > 0) {
        const footerText = await optionListFooter.first().textContent() ?? "";
        expect(footerText).not.toMatch(/répondez|reply.*option.*book|option 1.*réserv/i);
      }

      // Broader check: no "reply option 1" phrasing anywhere on the page.
      const replyBookingText = page.getByText(
        /répondez.*option.*réserv|reply.*option.*book|option 1 to book|répondez option 1/i,
      );
      expect(await replyBookingText.count()).toBe(0);
    },
  );
});
