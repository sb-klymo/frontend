"use client";

/**
 * DecideForm — Client Component for /approvals/decide.
 *
 * Renders the trip summary and Approve/Reject buttons. On submission, POSTs to
 * the Next.js Route Handler proxy at /api/approvals/decide, which forwards the
 * decision to the backend internal endpoint with the shared secret.
 *
 * After a successful decision the form morphs in-place to a success state. On
 * 4xx the form morphs to the appropriate error state from error-states.tsx.
 */

import { useState } from "react";

import {
  ApprovalAlreadyDecidedPage,
  CannotApproveOwnBookingPage,
  InvalidTokenPage,
  NotAuthorizedToApprovePage,
  TokenExpiredPage,
} from "./error-states";

export type DecideFormProps = {
  approvalId: string;
  /** Pre-selected action from the email URL (?action=approve|reject). */
  actionFromUrl: "approve" | "reject" | null;
  totalAmountCents: number;
  currency: string;
  /** Human-readable trip summary line, e.g. "CDG → JFK · 15 Jun 2026". */
  tripSummary: string;
  requestingUserFirstName: string;
  /** Reason the policy engine raised the approval (shown read-only). */
  policyReason: string;
};

type UIState =
  | { phase: "idle" }
  | { phase: "submitting" }
  | { phase: "success"; decision: "approve" | "reject" }
  | {
      phase: "error";
      code:
        | "invalid_token"
        | "token_expired"
        | "already_decided"
        | "not_authorized"
        | "cannot_self_approve"
        | "unknown";
      alreadyDecidedMeta?: { decider: string; decidedAt: string; decision: "approved" | "rejected" };
    };

function formatAmount(cents: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency || "USD",
      maximumFractionDigits: 2,
    }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency}`;
  }
}

export function DecideForm({
  approvalId,
  actionFromUrl,
  totalAmountCents,
  currency,
  tripSummary,
  requestingUserFirstName,
  policyReason,
}: DecideFormProps) {
  const [reason, setReason] = useState("");
  const [ui, setUi] = useState<UIState>({ phase: "idle" });

  // ── error state renders ──────────────────────────────────────────────────

  if (ui.phase === "error") {
    switch (ui.code) {
      case "invalid_token":
        return <InvalidTokenPage />;
      case "token_expired":
        return <TokenExpiredPage />;
      case "already_decided":
        return (
          <ApprovalAlreadyDecidedPage
            decider={ui.alreadyDecidedMeta?.decider ?? "another approver"}
            decidedAt={ui.alreadyDecidedMeta?.decidedAt}
            decision={ui.alreadyDecidedMeta?.decision ?? "approved"}
          />
        );
      case "not_authorized":
        return <NotAuthorizedToApprovePage />;
      case "cannot_self_approve":
        return <CannotApproveOwnBookingPage />;
      default:
        return <InvalidTokenPage />;
    }
  }

  // ── success state ─────────────────────────────────────────────────────────

  if (ui.phase === "success") {
    const approved = ui.decision === "approve";
    return (
      <main className="flex min-h-screen items-center justify-center bg-gray-50 px-4 py-12">
        <div className="w-full max-w-sm space-y-4 rounded-lg border border-gray-200 bg-white p-6 shadow-sm text-center">
          <span className="text-4xl" aria-hidden="true">
            {approved ? "✅" : "❌"}
          </span>
          <h1 className="text-lg font-semibold text-gray-900">
            {approved ? "Approved." : "Rejected."}
          </h1>
          <p className="text-sm text-gray-600">
            {requestingUserFirstName} has been notified.
          </p>
        </div>
      </main>
    );
  }

  // ── decision handler ──────────────────────────────────────────────────────

  async function handleDecision(action: "approve" | "reject") {
    setUi({ phase: "submitting" });

    let responseBody: unknown;
    let responseStatus: number;

    try {
      const res = await fetch("/api/approvals/decide", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          approval_id: approvalId,
          action,
          decision_reason: reason.trim() || undefined,
        }),
      });

      responseStatus = res.status;

      try {
        responseBody = await res.json();
      } catch {
        responseBody = null;
      }

      if (res.ok) {
        setUi({ phase: "success", decision: action });
        return;
      }
    } catch {
      // Network error
      setUi({ phase: "error", code: "unknown" });
      return;
    }

    // Map backend error codes to UI error states
    const code =
      typeof responseBody === "object" &&
      responseBody !== null &&
      "code" in responseBody
        ? (responseBody as { code: string }).code
        : "";

    if (responseStatus === 410 || code === "approval_expired") {
      setUi({ phase: "error", code: "token_expired" });
    } else if (responseStatus === 409 || code === "approval_already_decided") {
      // Try to extract meta from the backend response
      const meta =
        typeof responseBody === "object" &&
        responseBody !== null &&
        "decided_by" in responseBody &&
        "decided_at" in responseBody &&
        "decision" in responseBody
          ? {
              decider: String((responseBody as Record<string, unknown>).decided_by),
              decidedAt: String((responseBody as Record<string, unknown>).decided_at),
              decision: (responseBody as Record<string, unknown>).decision as
                | "approved"
                | "rejected",
            }
          : undefined;
      setUi({ phase: "error", code: "already_decided", alreadyDecidedMeta: meta });
    } else if (responseStatus === 403 && code === "cannot_approve_own_booking") {
      setUi({ phase: "error", code: "cannot_self_approve" });
    } else if (responseStatus === 403) {
      setUi({ phase: "error", code: "not_authorized" });
    } else if (responseStatus === 401 || responseStatus === 404) {
      setUi({ phase: "error", code: "invalid_token" });
    } else {
      setUi({ phase: "error", code: "unknown" });
    }
  }

  // ── form render ───────────────────────────────────────────────────────────

  const isSubmitting = ui.phase === "submitting";

  return (
    <main className="flex min-h-screen items-center justify-center bg-gray-50 px-4 py-12">
      <div className="w-full max-w-md space-y-6 rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        <header>
          <h1 className="text-xl font-bold text-gray-900">Approve travel request</h1>
          <p className="mt-1 text-sm text-gray-500">
            {requestingUserFirstName} is requesting approval for the following trip.
          </p>
        </header>

        {/* Trip summary */}
        <section
          className="rounded-lg border border-gray-200 bg-gray-50 p-4 space-y-2"
          data-testid="trip-summary"
        >
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="text-gray-500 shrink-0">Trip</span>
            <span className="font-medium text-gray-800 truncate">{tripSummary}</span>
          </div>
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="text-gray-500 shrink-0">Total</span>
            <span className="font-semibold text-gray-900">
              {formatAmount(totalAmountCents, currency)}
            </span>
          </div>
          <div className="flex items-start gap-3 text-sm">
            <span className="text-gray-500 shrink-0">Policy note</span>
            <span className="text-gray-700 text-right">{policyReason}</span>
          </div>
        </section>

        {/* Optional reason textarea */}
        <div>
          <label
            htmlFor="decision_reason"
            className="block text-sm font-medium text-gray-700 mb-1"
          >
            Reason{" "}
            <span className="font-normal text-gray-400">(optional, max 500 chars)</span>
          </label>
          <textarea
            id="decision_reason"
            name="decision_reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={500}
            rows={3}
            disabled={isSubmitting}
            placeholder="Add a comment for the requester (optional)…"
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none disabled:bg-gray-50 disabled:text-gray-400"
            data-testid="decision-reason-textarea"
          />
        </div>

        {/* Action buttons */}
        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => handleDecision("approve")}
            disabled={isSubmitting}
            className="flex-1 rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2"
            data-testid="approve-button"
          >
            {isSubmitting ? "Submitting…" : "Approve"}
          </button>
          <button
            type="button"
            onClick={() => handleDecision("reject")}
            disabled={isSubmitting}
            className="flex-1 rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2"
            data-testid="reject-button"
          >
            {isSubmitting ? "Submitting…" : "Reject"}
          </button>
        </div>

        {actionFromUrl && (
          <p className="text-xs text-gray-400 text-center" data-testid="action-hint">
            The email link suggested:{" "}
            <strong>{actionFromUrl === "approve" ? "Approve" : "Reject"}</strong> — you
            can still choose either action above.
          </p>
        )}
      </div>
    </main>
  );
}
