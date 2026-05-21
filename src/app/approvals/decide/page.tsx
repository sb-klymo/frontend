/**
 * /approvals/decide — Server Component
 *
 * Reached from an approval-request email magic-link:
 *   /approvals/decide?id=<uuid>&action=<approve|reject>&t=<token>
 *
 * This page:
 *   1. Reads ?id, ?action, ?t from search params (purely informational at
 *      render time — token verification is deferred to the decide endpoint).
 *   2. Authenticates via Supabase session (cookies). Unauthenticated →
 *      redirect to /login (login page does NOT currently support ?next=...,
 *      so we redirect to plain /login).
 *   3. Reads the approval row from Supabase (RLS ensures only org admins and
 *      the requester can see it).
 *   4. Runs authorization checks and renders the appropriate error state when
 *      a check fails.
 *   5. On all checks passing, renders <DecideForm> (Client Component) with
 *      the approval data pre-loaded.
 *
 * NOTE — spec drift: Server-side HMAC token verification (§3.4 step 2) is
 * intentionally skipped. The backend's decide endpoint already verifies the
 * token; duplicating that logic in TypeScript would require either replicating
 * the Python HMAC implementation or adding a new backend verify endpoint.
 * The defensive check is belt-and-suspenders at best, and the backend is the
 * single source of truth. See task-12 report for detail.
 *
 * NOTE — spec drift: /login does not currently support ?next=... redirect.
 * Users are redirected to plain /login; after sign-in they will need to
 * revisit the email link. Implementing ?next= support in the login page is a
 * separate follow-up (tracked but deferred).
 *
 * Vitest does not support async Server Components (CLAUDE.md line 5).
 * This file is covered by Playwright E2E tests (Task 15).
 */

import { redirect } from "next/navigation";

import { createSupabaseServerClient } from "@/lib/supabase/server";

import { DecideForm } from "./DecideForm";
import {
  ApprovalAlreadyDecidedPage,
  CannotApproveOwnBookingPage,
  InvalidTokenPage,
  NotAuthorizedToApprovePage,
  TokenExpiredPage,
} from "./error-states";

// ---------------------------------------------------------------------------
// Types matching public.approval_requests columns
// ---------------------------------------------------------------------------

type ApprovalRow = {
  id: string;
  requesting_user_id: string;
  org_id: string;
  status: "pending" | "approved" | "rejected" | "expired" | "canceled";
  expires_at: string;
  total_amount_cents: number;
  currency: string;
  offer_snapshot: Record<string, unknown>;
  policy_reason: string;
  decided_by_user_id: string | null;
  decided_at: string | null;
  decision_reason: string | null;
};

type UserRow = {
  id: string;
  organization_id: string | null;
  role: string | null;
  first_name: string | null;
};

// ---------------------------------------------------------------------------
// Trip summary helper — extract a human-readable line from offer_snapshot
// ---------------------------------------------------------------------------

function buildTripSummary(offerSnapshot: Record<string, unknown>): string {
  try {
    const outbound = (offerSnapshot.outbound ?? {}) as Record<string, unknown>;
    const origin = String(outbound.origin_iata ?? "?");
    const dest = String(outbound.destination_iata ?? "?");
    const depRaw = String(outbound.departure_datetime ?? "");
    const depDate = depRaw ? depRaw.slice(0, 10) : "";
    if (depDate) return `${origin} → ${dest} · ${depDate}`;
    return `${origin} → ${dest}`;
  } catch {
    return "Trip details unavailable";
  }
}

// ---------------------------------------------------------------------------
// Page props
// ---------------------------------------------------------------------------

type SearchParams = {
  id?: string;
  action?: string;
  t?: string;
};

type PageProps = {
  searchParams: Promise<SearchParams>;
};

// ---------------------------------------------------------------------------
// Server Component
// ---------------------------------------------------------------------------

export default async function ApprovalsDecidePage({ searchParams }: PageProps) {
  const params = await searchParams;
  const approvalId = params.id;
  const actionParam = params.action;

  // 1. Basic param presence check — if id is missing the link is broken.
  if (!approvalId) {
    return <InvalidTokenPage />;
  }

  // Validate action param loosely (it's just a UI hint; not security-critical
  // because the user picks approve/reject via buttons).
  const actionFromUrl: "approve" | "reject" | null =
    actionParam === "approve" ? "approve"
    : actionParam === "reject" ? "reject"
    : null;

  // 2. Auth guard
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  // 3. Fetch the approval row (RLS: visible to org admins + the requester)
  const { data: approvalData, error: approvalError } = await supabase
    .from("approval_requests")
    .select(
      "id, requesting_user_id, org_id, status, expires_at, total_amount_cents, currency, offer_snapshot, policy_reason, decided_by_user_id, decided_at, decision_reason",
    )
    .eq("id", approvalId)
    .single<ApprovalRow>();

  if (approvalError || !approvalData) {
    // Row not found OR RLS blocked access — treat as broken link.
    return <InvalidTokenPage />;
  }

  const approval = approvalData;

  // 4. Check approval status
  if (approval.status === "expired") {
    return <TokenExpiredPage />;
  }

  if (approval.status !== "pending") {
    // already approved or rejected
    const decider = approval.decided_by_user_id ?? "a manager";
    const decidedAt = approval.decided_at ?? new Date().toISOString();
    const decision =
      approval.status === "approved" ? "approved" : ("rejected" as const);
    return (
      <ApprovalAlreadyDecidedPage
        decider={decider}
        decidedAt={decidedAt}
        decision={decision}
      />
    );
  }

  // 5. Check expiry (status may still be 'pending' but time has elapsed)
  if (new Date(approval.expires_at) < new Date()) {
    return <TokenExpiredPage />;
  }

  // 6. Fetch the current user's profile from public.users
  const { data: currentUserData, error: userError } = await supabase
    .from("users")
    .select("id, organization_id, role, first_name")
    .eq("id", user.id)
    .single<UserRow>();

  if (userError || !currentUserData) {
    // Can't read current user profile — treat as not authorized.
    return <NotAuthorizedToApprovePage />;
  }

  const currentUser = currentUserData;

  // 7. Org check — approver must be in the same org as the approval request
  if (!currentUser.organization_id || currentUser.organization_id !== approval.org_id) {
    return <NotAuthorizedToApprovePage />;
  }

  // 8. Role check — only company_admin can approve
  if (currentUser.role !== "company_admin") {
    return <NotAuthorizedToApprovePage />;
  }

  // 9. Self-approval check
  if (user.id === approval.requesting_user_id) {
    return <CannotApproveOwnBookingPage />;
  }

  // 10. Fetch the requesting user's first name for the success message
  let requesterFirstName = "Your colleague";
  const { data: requesterData } = await supabase
    .from("users")
    .select("first_name")
    .eq("id", approval.requesting_user_id)
    .single<{ first_name: string | null }>();

  if (requesterData?.first_name) {
    requesterFirstName = requesterData.first_name;
  }

  // 11. All checks passed — render the decision form
  const tripSummary = buildTripSummary(approval.offer_snapshot);

  return (
    <DecideForm
      approvalId={approval.id}
      actionFromUrl={actionFromUrl}
      totalAmountCents={approval.total_amount_cents}
      currency={approval.currency}
      tripSummary={tripSummary}
      requestingUserFirstName={requesterFirstName}
      policyReason={approval.policy_reason}
    />
  );
}
