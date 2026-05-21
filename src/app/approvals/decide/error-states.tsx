/**
 * error-states.tsx — Reusable error page renderers for /approvals/decide.
 *
 * Each export is a standalone page-level component. They are rendered by the
 * Server Component when an authorization or state check fails, and can also be
 * rendered by the DecideForm Client Component when the backend returns a 4xx
 * after the user clicks Approve/Reject.
 *
 * Design mirrors the rest of Klymo's card-based layout (rounded border,
 * centered, max-width-sm). No animations — these are informational pages.
 */

import Link from "next/link";

type ErrorCardProps = {
  title: string;
  body: React.ReactNode;
};

function ErrorCard({ title, body }: ErrorCardProps) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-gray-50 px-4 py-12">
      <div className="w-full max-w-sm space-y-4 rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        <h1 className="text-lg font-semibold text-gray-900">{title}</h1>
        <div className="text-sm text-gray-600">{body}</div>
        <Link
          href="/chat"
          className="inline-block rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
        >
          Back to Klymo
        </Link>
      </div>
    </main>
  );
}

/**
 * Shown when the URL token is missing, malformed, or the approval row was not
 * found — the link is broken or has been tampered with.
 */
export function InvalidTokenPage() {
  return (
    <ErrorCard
      title="This link is broken or has been tampered with"
      body={
        <p>
          The approval link you followed is invalid. Please ask the requester to
          re-send a fresh approval request.
        </p>
      }
    />
  );
}

/**
 * Shown when the approval has expired (status = 'expired', or expires_at in
 * the past). Covers both URL-level token expiry and row-level expiry.
 */
export function TokenExpiredPage() {
  return (
    <ErrorCard
      title="This approval has expired"
      body={
        <p>
          The approval link you followed is no longer valid — the request window
          has closed. The requester will need to start a new booking.
        </p>
      }
    />
  );
}

type AlreadyDecidedProps = {
  /** Display name (or email) of the person who made the decision. */
  decider: string;
  /** ISO-8601 timestamp of when the decision was made. May be undefined when
   *  the decision details are unknown (e.g. race-condition 409 with no meta). */
  decidedAt?: string;
  /** "approved" | "rejected" */
  decision: "approved" | "rejected";
};

/**
 * Shown when approval.status is already 'approved' or 'rejected' — someone
 * else (or the same admin via another device) has already decided.
 */
export function ApprovalAlreadyDecidedPage({
  decider,
  decidedAt,
  decision,
}: AlreadyDecidedProps) {
  const verb = decision === "approved" ? "approved" : "rejected";

  // decidedAt may be absent when the 409 response contains no metadata (race
  // condition). Render a shorter, accurate message in that case.
  if (!decidedAt) {
    return (
      <ErrorCard
        title={`This request was already ${verb}`}
        body={
          <p>
            This approval request was just decided by{" "}
            <strong>{decider}</strong>. No further action is needed.
          </p>
        }
      />
    );
  }

  const formattedDate = new Date(decidedAt).toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  });

  return (
    <ErrorCard
      title={`This request was already ${verb}`}
      body={
        <p>
          This approval request was already <strong>{verb}</strong> by{" "}
          <strong>{decider}</strong> at {formattedDate}. No further action is
          needed.
        </p>
      }
    />
  );
}

type CanceledProps = {
  /** First name of the person who made the booking request, if known. */
  requesterFirstName?: string;
};

/**
 * Shown when approval.status is 'canceled' — the requester withdrew the
 * request before an approver acted on it.
 */
export function ApprovalCanceledPage({ requesterFirstName }: CanceledProps) {
  const name = requesterFirstName ?? "The requester";
  return (
    <ErrorCard
      title="This request was canceled"
      body={
        <p>
          {name} canceled this request. No further action needed.
        </p>
      }
    />
  );
}

/**
 * Shown when the current user is not authorized to approve this booking —
 * either they are not in the same org or they do not have the company_admin
 * role.
 */
export function NotAuthorizedToApprovePage() {
  return (
    <ErrorCard
      title="You don't have access to approve this booking"
      body={
        <p>
          Only company admins in the same organization can approve travel
          requests. If you think this is a mistake, contact your Klymo
          administrator.
        </p>
      }
    />
  );
}

/**
 * Shown when the current user is the same person who made the booking request
 * — self-approval is not permitted.
 */
export function CannotApproveOwnBookingPage() {
  return (
    <ErrorCard
      title="You can't approve your own booking"
      body={
        <p>
          Ask another admin in your organization to approve this travel request.
        </p>
      }
    />
  );
}
