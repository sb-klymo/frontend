/**
 * Approval-required flow E2E suite (Phase 6, Task 15).
 *
 * Three scenarios:
 *
 *   Test 1 — happy path
 *     Signup → manager_only preset → search → pick flagged offer →
 *     ApprovalPendingCard renders → DB-seed approve → page.reload() →
 *     checkPendingApprovals fires → approval_required_node re-entry emits
 *     approved bubble ("validé" / "Continuing").
 *
 *   Test 2 — hard-block re-request (prior rejection)
 *     Signup → seed an approval_requests row with status='rejected' for one of
 *     the deterministic stub offers → manager_only preset → search → pick that
 *     flagged offer → bot emits _PRIOR_REJECTION_TEMPLATE instead of creating
 *     a new approval row ("refusé" / "rejected").
 *
 *   Test 3 — forwarded link, non-authorised user
 *     Signup user A → seed a pending approval_requests row for user A's org →
 *     sign up user B (no org assignment) → navigate to /approvals/decide →
 *     NotAuthorizedToApprovePage renders ("You don't have access").
 *
 * DB seed pattern mirrors name-greeting.spec.ts: dollar-quoted execFileSync
 * calls to psql against the local Supabase Postgres (127.0.0.1:54322).
 *
 * Stub Duffel (DUFFEL_MODE=stub) returns 3 deterministic offers for
 * Marseille→Toulouse at 450/540/620 EUR — all above the manager_only 300 EUR
 * threshold, so all three carry the manager_approval_required badge.
 */

import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

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
// Under DUFFEL_MODE=stub returns 450/540/620 EUR (all > 300 EUR threshold).
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
// User setup helpers
// ---------------------------------------------------------------------------

/**
 * Sign up via /signup and land on /chat.
 * Returns the email used (for subsequent DB seeds).
 */
async function signupUser(page: Page, prefix: string): Promise<string> {
  const email = `e2e-approval-${prefix}-${Date.now()}@klymo.local`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("password123456");
  await page.getByRole("button", { name: /create account/i }).click();
  await expect(page).toHaveURL(/\/chat$/);
  return email;
}

/**
 * Seed first_name + stripe_payment_method_id so the chat service
 * treats the user as fully onboarded (mirrors name-greeting.spec.ts).
 */
function seedUserProfile(email: string): void {
  psql(
    `UPDATE public.users
       SET first_name = $$TestUser$$,
           stripe_payment_method_id = 'pm_e2e_approval_test',
           account_type = 'individual'
     WHERE id = (SELECT id FROM auth.users WHERE email = $$${email}$$);`,
  );
}

// ---------------------------------------------------------------------------
// Policy preset helper (mirrors policy-enforcement.spec.ts)
// ---------------------------------------------------------------------------

async function activatePolicyPreset(
  page: Page,
  presetId: "mixed_verdict" | "block_expensive" | "manager_only" | "train_preferred" | "none",
): Promise<void> {
  const presetButton = page.getByTestId(`dev-policy-preset-${presetId}`);
  await expect(presetButton).toBeVisible({ timeout: 5_000 });
  await presetButton.click();
  await expect(presetButton).toHaveAttribute("data-active", "true");
}

// ---------------------------------------------------------------------------
// Chat helpers
// ---------------------------------------------------------------------------

async function sendMessage(page: Page, message: string): Promise<void> {
  const input = page.getByPlaceholder(/ask about a trip/i);
  await input.fill(message);
  await input.press("Enter");
}

// ---------------------------------------------------------------------------
// DB seed helpers for approval_requests rows
//
// approval_requests schema (20260521105434_approval_requests.sql):
//   id, trip_id*, conversation_id*, requesting_user_id*, org_id*,
//   policy_status (approval_tier: manager|finance), offer_snapshot (jsonb),
//   total_amount_cents, currency, policy_reason, status (approval_status),
//   decision_token, expires_at, decided_by_user_id, decision_reason,
//   created_at, decided_at
//
// The decided_consistency CHECK constraint requires:
//   IF status IN ('approved','rejected') THEN
//     decided_by_user_id IS NOT NULL AND decided_at IS NOT NULL
//   IF status IN ('pending','expired','canceled') THEN
//     decided_by_user_id IS NULL AND decided_at IS NULL
//
// For foreign-key dependencies we create minimal stub rows:
//   organizations → conversations → trips (trips FK → conversations)
// ---------------------------------------------------------------------------

/**
 * Ensure an organization row exists for a user (returns its id).
 * If the user already belongs to an org, returns that org's id.
 * Otherwise inserts a new org and assigns it to the user.
 */
function ensureOrgForUser(userEmail: string): string {
  // Check if user already has an org
  const existing = psql(
    `SELECT u.organization_id::text
       FROM public.users u
       JOIN auth.users a ON a.id = u.id
      WHERE a.email = $$${userEmail}$$
      LIMIT 1;`,
  );
  if (existing && existing !== "" && existing !== "NULL" && existing !== "(0 rows)") {
    return existing;
  }

  // Insert a new org and assign it to the user
  const orgId = randomUUID();
  psql(
    `INSERT INTO public.organizations (id, name)
     VALUES ('${orgId}', 'E2E Approval Test Org ${orgId.slice(0, 8)}')
     ON CONFLICT (id) DO NOTHING;`,
  );
  psql(
    `UPDATE public.users
        SET organization_id = '${orgId}'
      WHERE id = (SELECT id FROM auth.users WHERE email = $$${userEmail}$$);`,
  );
  return orgId;
}

/**
 * Insert a minimal conversations row for a user and return its id.
 */
function seedConversation(userEmail: string): string {
  const convId = randomUUID();
  psql(
    `INSERT INTO public.conversations (id, user_id)
     VALUES (
       '${convId}',
       (SELECT id FROM auth.users WHERE email = $$${userEmail}$$)
     );`,
  );
  return convId;
}

/**
 * Insert a minimal trips row and return its id.
 */
function seedTrip(userEmail: string, conversationId: string): string {
  const tripId = randomUUID();
  psql(
    `INSERT INTO public.trips (id, conversation_id, user_id)
     VALUES (
       '${tripId}',
       '${conversationId}',
       (SELECT id FROM auth.users WHERE email = $$${userEmail}$$)
     );`,
  );
  return tripId;
}

type SeedApprovalOptions = {
  status: "pending" | "rejected" | "approved" | "expired" | "canceled";
  /** Required when status is 'approved' or 'rejected'. Must be a valid auth.users id. */
  decidedByUserId?: string;
  decisionReason?: string;
  offerId?: string;
  totalAmountCents?: number;
  currency?: string;
  policyStatus?: "manager" | "finance";
  policyReason?: string;
};

/**
 * Insert an approval_requests row for userEmail, creating org / conversation /
 * trip as needed. Returns { approvalId, decisionToken, orgId }.
 */
function seedApprovalRow(
  userEmail: string,
  opts: SeedApprovalOptions,
): { approvalId: string; decisionToken: string; orgId: string; conversationId: string } {
  const orgId = ensureOrgForUser(userEmail);
  const conversationId = seedConversation(userEmail);
  const tripId = seedTrip(userEmail, conversationId);

  const approvalId = randomUUID();
  const decisionToken = randomUUID();
  const offerId = opts.offerId ?? `offer_e2e_${Date.now()}`;
  const totalAmountCents = opts.totalAmountCents ?? 45000;
  const currency = opts.currency ?? "EUR";
  const policyStatus = opts.policyStatus ?? "manager";
  const policyReason = opts.policyReason ?? "Amount exceeds 300 EUR manager threshold";

  // Build the offer_snapshot JSON (mirrors DisplayedOffer.model_dump shape
  // used by approval_required_node._resolve_selected_offer)
  const offerSnapshot = JSON.stringify({
    offer_id: offerId,
    rank: 1,
    airline_name: "Air Stub",
    airline_iata: "AS",
    total_amount_cents: totalAmountCents,
    total_currency: currency,
    policy_status:
      policyStatus === "manager" ? "manager_approval_required" : "finance_approval_required",
    policy_reason: policyReason,
    outbound: {
      origin_iata: "MRS",
      destination_iata: "TLS",
      departure_datetime: "2026-05-22T08:00:00",
      arrival_datetime: "2026-05-22T09:00:00",
    },
    return_leg: null,
  });

  // Expiry: 48 hours from now (safe for pending; not checked for rejected rows)
  const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();

  if (opts.status === "approved" || opts.status === "rejected") {
    // decided_consistency constraint requires decided_by_user_id + decided_at
    const decidedByUserId = opts.decidedByUserId ?? "";
    if (!decidedByUserId) {
      throw new Error(
        "seedApprovalRow: decidedByUserId is required when status is approved/rejected",
      );
    }
    const decisionReasonSql = opts.decisionReason
      ? `$$${opts.decisionReason}$$`
      : "NULL";

    psql(
      `INSERT INTO public.approval_requests (
         id, trip_id, conversation_id, requesting_user_id, org_id,
         policy_status, offer_snapshot, total_amount_cents, currency,
         policy_reason, status, decision_token, expires_at,
         decided_by_user_id, decision_reason, decided_at
       ) VALUES (
         '${approvalId}',
         '${tripId}',
         '${conversationId}',
         (SELECT id FROM auth.users WHERE email = $$${userEmail}$$),
         '${orgId}',
         '${policyStatus}',
         '${offerSnapshot.replace(/'/g, "''")}',
         ${totalAmountCents},
         '${currency}',
         $$${policyReason}$$,
         '${opts.status}',
         '${decisionToken}',
         '${expiresAt}',
         '${decidedByUserId}',
         ${decisionReasonSql},
         now()
       );`,
    );
  } else {
    // pending / expired / canceled — decided_by_user_id + decided_at must be NULL
    psql(
      `INSERT INTO public.approval_requests (
         id, trip_id, conversation_id, requesting_user_id, org_id,
         policy_status, offer_snapshot, total_amount_cents, currency,
         policy_reason, status, decision_token, expires_at
       ) VALUES (
         '${approvalId}',
         '${tripId}',
         '${conversationId}',
         (SELECT id FROM auth.users WHERE email = $$${userEmail}$$),
         '${orgId}',
         '${policyStatus}',
         '${offerSnapshot.replace(/'/g, "''")}',
         ${totalAmountCents},
         '${currency}',
         $$${policyReason}$$,
         '${opts.status}',
         '${decisionToken}',
         '${expiresAt}'
       );`,
    );
  }

  return { approvalId, decisionToken, orgId, conversationId };
}

/**
 * Seed a second minimal user in the same org as userEmail, assigned
 * company_admin role — used as decided_by_user_id for approved/rejected rows.
 * Returns the admin user's auth.users id.
 */
function seedAdminUserInOrg(orgId: string): string {
  // We INSERT directly into auth.users. In local Supabase this works; the
  // handle_new_user trigger then creates the public.users row.
  const adminId = randomUUID();
  const adminEmail = `e2e-approval-admin-${adminId.slice(0, 8)}@klymo.local`;

  // Insert into auth.users (minimal — no password needed; just an id)
  psql(
    `INSERT INTO auth.users (
       id, email, encrypted_password, email_confirmed_at,
       created_at, updated_at, aud, role
     ) VALUES (
       '${adminId}',
       '${adminEmail}',
       crypt('password123456', gen_salt('bf')),
       now(), now(), now(), 'authenticated', 'authenticated'
     ) ON CONFLICT (id) DO NOTHING;`,
  );

  // The handle_new_user trigger creates the public.users row; assign org + role
  psql(
    `UPDATE public.users
        SET organization_id = '${orgId}',
            role = 'company_admin'
      WHERE id = '${adminId}';`,
  );

  return adminId;
}

/**
 * Flip an existing approval_requests row to approved/rejected (post-seed).
 * Satisfies the decided_consistency CHECK constraint.
 */
function setApprovalDecision(
  approvalId: string,
  decision: "approved" | "rejected",
  decidedByUserId: string,
  decisionReason?: string,
): void {
  const reasonSql = decisionReason ? `$$${decisionReason}$$` : "NULL";
  psql(
    `UPDATE public.approval_requests
        SET status = '${decision}',
            decided_at = now(),
            decided_by_user_id = '${decidedByUserId}',
            decision_reason = ${reasonSql}
      WHERE id = '${approvalId}';`,
  );
}

// ---------------------------------------------------------------------------
// Test 1 — happy path
// ---------------------------------------------------------------------------

test(
  "full approval happy path: pick flagged offer → seed approve via DB → resume bubble",
  async ({ page }) => {
    // 1. Sign up + seed user profile so the chat treats user as onboarded.
    const email = await signupUser(page, "happy");
    seedUserProfile(email);
    await page.reload();
    await expect(page).toHaveURL(/\/chat$/);

    // 2. Activate manager_only policy preset (300 EUR threshold — all stub
    //    offers at 450/540/620 EUR will carry manager_approval_required badge).
    await activatePolicyPreset(page, "manager_only");

    // 3. Send search query.
    await sendMessage(page, TRIP_QUERY);

    // 4. Wait for the option list to render.
    await expect(page.getByText(/Option 1/i).first()).toBeVisible({
      timeout: 60_000,
    });

    // 5. Assert at least one option carries the approval badge.
    await expect(
      page
        .getByText(/approbation manager|approbation finance|requires.*approval/i)
        .first(),
    ).toBeVisible({ timeout: 5_000 });

    // 6. Pick option 1 (flagged → routes through approval_required_node).
    await sendMessage(page, "option 1");

    // 7. The ApprovalPendingCard renders — this is the load-bearing assertion
    //    that the gate is wired. The card's pending state has
    //    data-testid="approval-pending-card".
    await expect(page.getByTestId("approval-pending-card")).toBeVisible({
      timeout: 60_000,
    });

    // 8. Retrieve the approval_requests row that the backend just inserted for
    //    this user. We need the id and org_id to create the decided_by admin.
    const approvalId = psql(
      `SELECT ar.id::text
         FROM public.approval_requests ar
         JOIN auth.users au ON au.id = ar.requesting_user_id
        WHERE au.email = $$${email}$$
        ORDER BY ar.created_at DESC
        LIMIT 1;`,
    );

    if (!approvalId || approvalId === "") {
      throw new Error(
        "No approval_requests row found for user — backend gate may not have fired",
      );
    }

    const orgId = psql(
      `SELECT org_id::text FROM public.approval_requests WHERE id = '${approvalId}';`,
    );

    // 9. Seed an admin user in the same org to act as the approver
    //    (decided_by_user_id must reference a real auth.users row).
    const adminUserId = seedAdminUserInOrg(orgId);

    // 10. DB-approve the row.
    setApprovalDecision(approvalId, "approved", adminUserId);

    // 11. Reload the page — ChatRoot remounts, checkPendingApprovals fires,
    //     /api/me/pending-approvals returns the decided row, resumeApproval
    //     is called, approval_required_node re-enters with approval_decision='approved'
    //     and emits the approved bubble.
    await page.reload();
    await expect(page).toHaveURL(/\/chat$/);

    // 12. The approved bubble emitted by _reentry_approved uses
    //     _APPROVED_TEMPLATE: "Votre manager a validé le vol {origin} → {destination}."
    //     or _APPROVED_FALLBACK_TEMPLATE: "Votre booking a été validé. Je continue."
    //     Both are rephrased by phrase() so we match a stable substring.
    //     English i18n: "Approved" / "Continuing your booking" from approvedBy().
    await expect(
      page.getByText(
        /validé|approved|continuing|réservation.*continue/i,
      ).last(),
    ).toBeVisible({ timeout: 60_000 });
  },
);

// ---------------------------------------------------------------------------
// Test 2 — hard-block re-request
// ---------------------------------------------------------------------------

test(
  "hard-block re-request: pick same flagged offer after prior rejection",
  async ({ page }) => {
    // 1. Sign up + seed user profile.
    const email = await signupUser(page, "hardblock");
    seedUserProfile(email);
    await page.reload();
    await expect(page).toHaveURL(/\/chat$/);

    // 2. Seed an admin user and a rejected approval_requests row for an offer
    //    that matches stub offer option 1 (offer_id determined at runtime —
    //    the stub returns stable IDs when DUFFEL_MODE=stub but we can't know
    //    the id before the search runs). Strategy: seed the rejection AFTER the
    //    option list appears so we can read the offer_id from the DOM or from
    //    the approval_requests row the first pick would create.
    //
    //    Simpler approach: do a first search, pick option 1, wait for
    //    ApprovalPendingCard to appear (first pick creates the approval row),
    //    then DB-seed a rejection override on that row (UPDATE status to
    //    rejected), then pick option 1 AGAIN in a follow-up search — the
    //    hard-block fires because find_rejected_for_offer finds the row.
    //
    //    This tests the actual hard-block path end-to-end.

    // 2a. Activate manager_only preset.
    await activatePolicyPreset(page, "manager_only");

    // 2b. First search turn.
    await sendMessage(page, TRIP_QUERY);
    await expect(page.getByText(/Option 1/i).first()).toBeVisible({
      timeout: 60_000,
    });

    // 2c. Pick option 1 → ApprovalPendingCard renders (first approval row inserted).
    await sendMessage(page, "option 1");
    await expect(page.getByTestId("approval-pending-card")).toBeVisible({
      timeout: 60_000,
    });

    // 2d. Read the created approval row, then DB-seed a rejection with admin user.
    const approvalId = psql(
      `SELECT ar.id::text
         FROM public.approval_requests ar
         JOIN auth.users au ON au.id = ar.requesting_user_id
        WHERE au.email = $$${email}$$
        ORDER BY ar.created_at DESC
        LIMIT 1;`,
    );

    if (!approvalId || approvalId === "") {
      throw new Error("No approval_requests row created after first pick");
    }

    const orgId = psql(
      `SELECT org_id::text FROM public.approval_requests WHERE id = '${approvalId}';`,
    );
    const adminUserId = seedAdminUserInOrg(orgId);
    setApprovalDecision(approvalId, "rejected", adminUserId, "Booked too late in the cycle");

    // 2e. Do a second search in the SAME conversation so the graph has the
    //     same conversation_id (hard-block guard is per conversation_id + offer_id).
    //     We send a new search message to get a fresh option list.
    await sendMessage(page, TRIP_QUERY);
    await expect(page.getByText(/Option 1/i).last()).toBeVisible({
      timeout: 60_000,
    });

    // 2f. Pick option 1 again — the hard-block in select_node fires because
    //     find_rejected_for_offer returns the rejected row for this
    //     conversation_id + offer_id pair. The bot emits _PRIOR_REJECTION_TEMPLATE:
    //     "Ce vol {airline} a déjà été refusé par votre manager. Choisissez-en un autre..."
    //     phrase() rephrases it — we match a stable substring.
    await sendMessage(page, "option 1");

    // The rejection-reuse bubble should contain a fragment from
    // _PRIOR_REJECTION_TEMPLATE. phrase() preserves the semantic intent.
    await expect(
      page.getByText(
        /refusé|rejected|déjà.*refus|manager.*refus|already.*rejected/i,
      ).last(),
    ).toBeVisible({ timeout: 60_000 });

    // Guard: NO new approval_requests row should have been created for this
    // second pick (the hard-block returns early before calling approval_service).
    const rowCount = psql(
      `SELECT COUNT(*)::text
         FROM public.approval_requests ar
         JOIN auth.users au ON au.id = ar.requesting_user_id
        WHERE au.email = $$${email}$$;`,
    );
    // Should still be exactly 1 (the first row, now rejected).
    expect(rowCount).toBe("1");
  },
);

// ---------------------------------------------------------------------------
// Test 3 — forwarded link, non-authorised user
// ---------------------------------------------------------------------------

test(
  "forwarded link: non-approver lands on 'not authorized' page",
  async ({ page }) => {
    // 1. Sign up user A (the requester).
    const emailA = await signupUser(page, "fwdlink-a");

    // 2. Create an org for user A and seed a pending approval_requests row.
    const { approvalId, decisionToken } = seedApprovalRow(emailA, {
      status: "pending",
    });

    // 3. Sign out user A — navigate to /signup (which in the app serves as a
    //    clean session boundary because it does not auto-redirect authenticated
    //    users, and signing up a new user replaces the Supabase session cookie).
    //
    //    The /signup flow already replaces the Supabase session on submit, so
    //    signing up user B is sufficient to invalidate user A's session.

    // 4. Sign up user B (different email, no org assignment by default).
    const emailB = `e2e-approval-fwdlink-b-${Date.now()}@klymo.local`;
    await page.goto("/signup");
    await page.getByLabel("Email").fill(emailB);
    await page.getByLabel("Password").fill("password123456");
    await page.getByRole("button", { name: /create account/i }).click();
    await expect(page).toHaveURL(/\/chat$/);

    // User B is now signed in. User B has no organization_id (fresh signup,
    // no org seeded). The page.tsx authorization checks will find:
    //   currentUser.organization_id = null ≠ approval.org_id
    //   → returns <NotAuthorizedToApprovePage />

    // 5. Navigate to the magic-link URL for user A's approval.
    await page.goto(
      `/approvals/decide?id=${approvalId}&action=approve&t=${decisionToken}`,
    );

    // 6. The page renders <NotAuthorizedToApprovePage />.
    //    error-states.tsx title: "You don't have access to approve this booking"
    await expect(
      page.getByText(/you don't have access to approve this booking/i),
    ).toBeVisible({ timeout: 15_000 });

    // 7. Optionally assert the helper body text for belt-and-suspenders.
    await expect(
      page.getByText(/only company admins in the same organization/i),
    ).toBeVisible({ timeout: 5_000 });
  },
);
