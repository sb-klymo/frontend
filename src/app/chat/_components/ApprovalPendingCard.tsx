"use client";

/**
 * ApprovalPendingCard — rendered in chat when the user picks a flagged offer
 * that requires manager/finance approval (Phase 6).
 *
 * Starts in "pending" state (status pill + countdown + approver list +
 * cancel button). Subscribes via `useApprovalRealtime` to `approval_requests`
 * Realtime UPDATEs and morphs in-place to one of four terminal states:
 *   • approved  → green check + "Approved by {name}. Continuing…"
 *   • rejected  → red × + "Rejected. Reason: …"
 *   • expired   → grey clock + "This request expired."
 *   • canceled  → strikethrough + "Request withdrawn."
 *
 * Visual treatment mirrors `BookingConfirmationCard`: rounded border,
 * structured DL rows, small shadow.
 *
 * The cancel button POSTs to `/api/approvals/{id}/cancel`. That Next.js
 * Route Handler proxy is NOT yet built — see TODO below. The button renders
 * and calls fetch; the 404/501 in dev is caught and surfaced as a card-level
 * error message. Tests mock fetch.
 *
 * TODO (spec gap — not in the 16-task plan): add the backend cancel endpoint
 * `POST /api/approvals/{id}/cancel` (Route Handler + backend handler). Track
 * as a follow-up in Phase 6 or Phase 7 docs.
 */

import { useState, useEffect, useCallback } from "react";
import type { ApprovalRequestDetails } from "@/hooks/useChatStream";
import { useApprovalRealtime } from "@/hooks/useApprovalRealtime";
import { strings, type SupportedLanguage } from "@/lib/i18n";

export type ApprovalPendingCardProps = {
  approval: ApprovalRequestDetails;
  language?: SupportedLanguage;
  /** Injected by parent for testing (Task 14 wires the real SSE resume). */
  onDecided?: (row: ApprovalRequestDetails) => void;
};

export function ApprovalPendingCard({
  approval,
  language = "en",
  onDecided,
}: ApprovalPendingCardProps) {
  const realtimeResult = useApprovalRealtime(approval, { onDecided });
  const row = realtimeResult.status === "ready" ? realtimeResult.row : approval;
  const t = strings(language).approvalCard;

  const [cancelError, setCancelError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);

  const handleCancel = useCallback(async () => {
    setCancelError(null);
    setCancelling(true);
    try {
      const res = await fetch(`/api/approvals/${encodeURIComponent(row.id)}/cancel`, {
        method: "POST",
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        setCancelError(
          body.trim() ||
            `Cancel failed (${res.status}). The backend cancel endpoint may not be built yet.`,
        );
      }
    } catch (err) {
      setCancelError(err instanceof Error ? err.message : "Network error.");
    } finally {
      setCancelling(false);
    }
  }, [row.id]);

  if (row.status === "approved") {
    return (
      <ApprovedBanner
        row={row}
        language={language}
        t={t}
      />
    );
  }
  if (row.status === "rejected") {
    return (
      <RejectedBanner
        row={row}
        t={t}
      />
    );
  }
  if (row.status === "expired") {
    return <ExpiredBanner t={t} />;
  }
  if (row.status === "canceled") {
    return <CanceledBanner t={t} />;
  }

  // pending state
  return (
    <div
      className="rounded-lg border border-amber-200 bg-amber-50 p-4 shadow-sm"
      data-testid="approval-pending-card"
    >
      {realtimeResult.status === "error" && (
        <p
          className="mb-2 text-xs text-red-600"
          data-testid="approval-realtime-error"
        >
          {realtimeResult.error}
        </p>
      )}

      {/* Status pill */}
      <div className="flex items-center gap-2">
        <span aria-hidden="true">⏳</span>
        <span
          className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800"
          data-testid="approval-status-pill"
        >
          {t.pendingStatus}
        </span>
      </div>

      <dl className="mt-3 space-y-2 text-xs text-gray-800">
        {/* Amount */}
        <div className="flex items-baseline justify-between gap-3">
          <dt className="shrink-0 text-gray-500">{t.amountLabel}</dt>
          <dd className="font-semibold" data-testid="approval-amount">
            {formatAmount(row.total, row.currency, language)}
          </dd>
        </div>

        {/* Countdown */}
        <div className="flex items-baseline justify-between gap-3">
          <dt className="shrink-0 text-gray-500">{t.expiresInLabel}</dt>
          <dd
            className="font-medium text-amber-700"
            data-testid="approval-countdown"
            aria-hidden="true"
          >
            <Countdown expiresAt={row.expires_at} t={t} />
          </dd>
        </div>

        {/* Policy reason */}
        {row.policy_reason ? (
          <div className="flex items-baseline justify-between gap-3">
            <dt className="shrink-0 text-gray-500">{t.policyReasonLabel}</dt>
            <dd
              className="truncate text-right"
              data-testid="approval-policy-reason"
            >
              {row.policy_reason}
            </dd>
          </div>
        ) : null}

        {/* Approvers */}
        {row.approver_emails.length > 0 ? (
          <div className="flex flex-col gap-0.5 border-t border-amber-200 pt-2">
            <dt className="text-gray-500">{t.approversLabel}</dt>
            {row.approver_emails.map((email) => (
              <dd
                key={email}
                className="truncate font-mono text-[11px] text-gray-700"
                data-testid="approval-approver-email"
              >
                {email}
              </dd>
            ))}
          </div>
        ) : null}
      </dl>

      {cancelError ? (
        <p
          className="mt-2 text-xs text-red-600"
          data-testid="approval-cancel-error"
        >
          {cancelError}
        </p>
      ) : null}

      <button
        type="button"
        onClick={() => void handleCancel()}
        disabled={cancelling}
        className="mt-3 rounded-md border border-amber-300 bg-white px-3 py-1.5 text-xs font-medium text-amber-800 hover:bg-amber-50 disabled:opacity-50"
        data-testid="approval-cancel-button"
      >
        {cancelling ? t.cancellingLabel : t.cancelButtonLabel}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Terminal state sub-renderers
// ---------------------------------------------------------------------------

type ApprovalCardStrings = ReturnType<typeof strings>["approvalCard"];

function ApprovedBanner({
  row,
  language,
  t,
}: {
  row: ApprovalRequestDetails;
  language: SupportedLanguage;
  t: ApprovalCardStrings;
}) {
  return (
    <div
      className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 shadow-sm"
      data-testid="approval-approved-card"
      role="status"
      aria-live="polite"
    >
      <div className="flex items-center gap-2">
        <span aria-hidden="true">✅</span>
        <h3 className="text-sm font-semibold text-emerald-900">{t.approvedTitle}</h3>
      </div>
      <p className="mt-2 text-xs text-gray-700" data-testid="approval-approved-message">
        {row.decided_by_first_name
          ? t.approvedBy(row.decided_by_first_name)
          : t.approvedTitle}
      </p>
      <p className="mt-1 text-xs text-gray-500" data-testid="approval-approved-amount">
        {formatAmount(row.total, row.currency, language)}
      </p>
    </div>
  );
}

function RejectedBanner({
  row,
  t,
}: {
  row: ApprovalRequestDetails;
  t: ApprovalCardStrings;
}) {
  return (
    <div
      className="rounded-lg border border-red-200 bg-red-50 p-4 shadow-sm"
      data-testid="approval-rejected-card"
      role="status"
      aria-live="polite"
    >
      <div className="flex items-center gap-2">
        <span aria-hidden="true">❌</span>
        <h3 className="text-sm font-semibold text-red-900">{t.rejectedTitle}</h3>
      </div>
      <p className="mt-2 text-xs text-gray-700" data-testid="approval-rejected-message">
        {row.decision_reason
          ? t.rejectedReason(row.decision_reason)
          : t.rejectedTitle}
      </p>
    </div>
  );
}

function ExpiredBanner({ t }: { t: ApprovalCardStrings }) {
  return (
    <div
      className="rounded-lg border border-gray-200 bg-gray-50 p-4 shadow-sm"
      data-testid="approval-expired-card"
      role="status"
      aria-live="polite"
    >
      <div className="flex items-center gap-2">
        <span aria-hidden="true">⌛</span>
        <h3 className="text-sm font-semibold text-gray-700">{t.expiredTitle}</h3>
      </div>
      <p className="mt-2 text-xs text-gray-500" data-testid="approval-expired-hint">
        {t.expiredHint}
      </p>
    </div>
  );
}

function CanceledBanner({ t }: { t: ApprovalCardStrings }) {
  return (
    <div
      className="rounded-lg border border-gray-200 bg-gray-50 p-4 shadow-sm"
      data-testid="approval-canceled-card"
      role="status"
      aria-live="polite"
    >
      <div className="flex items-center gap-2">
        <span aria-hidden="true">🚫</span>
        <h3 className="text-sm font-semibold text-gray-600">{t.canceledHeading}</h3>
      </div>
      <p
        className="mt-2 text-xs text-gray-500 line-through"
        data-testid="approval-canceled-message"
      >
        {t.canceledTitle}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Countdown sub-component (live, updates every second)
// ---------------------------------------------------------------------------

function Countdown({
  expiresAt,
  t,
}: {
  expiresAt: string;
  t: ApprovalCardStrings;
}) {
  const [remaining, setRemaining] = useState(() => getRemainingSeconds(expiresAt));

  useEffect(() => {
    const id = setInterval(() => {
      const next = getRemainingSeconds(expiresAt);
      setRemaining(next);
      if (next <= 0) clearInterval(id);
    }, 1000);
    return () => clearInterval(id);
  }, [expiresAt]);

  if (remaining <= 0) return <span>{t.expiresInLessThanMinute}</span>;
  return <span>{formatCountdown(remaining)}</span>;
}

function getRemainingSeconds(expiresAt: string): number {
  const ms = new Date(expiresAt).getTime();
  if (Number.isNaN(ms)) return 0;
  return Math.max(0, Math.floor((ms - Date.now()) / 1000));
}

function formatCountdown(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

// ---------------------------------------------------------------------------
// Amount formatter (shared with BookingConfirmationCard pattern)
// ---------------------------------------------------------------------------

function formatAmount(total: number, currency: string, language: SupportedLanguage): string {
  const locale = language === "fr" ? "fr-FR" : "en-US";
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency: currency || "USD",
      maximumFractionDigits: 2,
    }).format(total);
  } catch {
    return `${total.toFixed(2)} ${currency}`;
  }
}
