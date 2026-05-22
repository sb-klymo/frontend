/**
 * ApprovalPendingCard tests.
 *
 * Mock strategy mirrors useChatStream.test.ts: the Supabase browser client
 * is fully mocked at module scope so no real WebSocket is created. The
 * `lastPostgresChangesHandler` variable captures the callback registered
 * with `.on("postgres_changes", …)` so individual tests can fire simulated
 * Realtime UPDATE events synchronously.
 */

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ApprovalRequestDetails } from "@/hooks/useChatStream";

import { ApprovalPendingCard } from "./ApprovalPendingCard";

// ---------------------------------------------------------------------------
// Supabase Realtime mock (same pattern as useChatStream.test.ts)
// ---------------------------------------------------------------------------

const mockOn = vi.fn().mockReturnThis();
const mockSubscribe = vi.fn().mockReturnThis();
const mockChannel = vi.fn(() => ({ on: mockOn, subscribe: mockSubscribe }));
const mockRemoveChannel = vi.fn();
const mockSetAuth = vi.fn();
const mockGetSession = vi.fn(async () => ({
  data: { session: { access_token: "test-jwt-token" } },
}));

let lastPostgresChangesHandler:
  | ((payload: { new: Record<string, unknown> }) => void)
  | null = null;

vi.mock("@/lib/supabase/browser", () => ({
  createSupabaseBrowserClient: () => ({
    channel: mockChannel,
    removeChannel: mockRemoveChannel,
    auth: { getSession: mockGetSession },
    realtime: { setAuth: mockSetAuth },
  }),
}));

// Capture the postgres_changes handler so individual tests can invoke it
// directly to simulate Realtime UPDATE events.
mockOn.mockImplementation(
  (_event: string, _config: unknown, handler: typeof lastPostgresChangesHandler) => {
    lastPostgresChangesHandler = handler;
    return { on: mockOn, subscribe: mockSubscribe };
  },
);

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function _approval(overrides: Partial<ApprovalRequestDetails> = {}): ApprovalRequestDetails {
  return {
    id: "apr-uuid-1",
    total: 450.0,
    currency: "EUR",
    // Expires 1 hour from "now" (tests run fast; using a far-future date
    // so the countdown renders as e.g. "59m 59s" rather than "0s").
    expires_at: new Date(Date.now() + 3_600_000).toISOString(),
    approver_emails: ["manager@company.com"],
    policy_reason: "Exceeds €400 limit",
    status: "pending",
    decision_reason: null,
    decided_at: null,
    decided_by_first_name: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  lastPostgresChangesHandler = null;
  mockOn.mockImplementation(
    (_event: string, _config: unknown, handler: typeof lastPostgresChangesHandler) => {
      lastPostgresChangesHandler = handler;
      return { on: mockOn, subscribe: mockSubscribe };
    },
  );
  mockSubscribe.mockReturnValue({ on: mockOn, subscribe: mockSubscribe });
  mockChannel.mockReturnValue({ on: mockOn, subscribe: mockSubscribe });
  mockGetSession.mockResolvedValue({
    data: { session: { access_token: "test-jwt-token" } },
  });
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(null, { status: 200 }),
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ApprovalPendingCard", () => {
  it("renders pending state with countdown + approver email", async () => {
    render(<ApprovalPendingCard approval={_approval()} language="en" />);

    expect(screen.getByTestId("approval-pending-card")).toBeInTheDocument();
    // Status pill
    expect(screen.getByTestId("approval-status-pill").textContent).toBe(
      "Awaiting approval",
    );
    // At least one approver email
    expect(screen.getByTestId("approval-approver-email").textContent).toBe(
      "manager@company.com",
    );
    // Policy reason
    expect(screen.getByTestId("approval-policy-reason").textContent).toBe(
      "Exceeds €400 limit",
    );
    // Amount formatted (EUR, en-US locale: "€450.00")
    const amount = screen.getByTestId("approval-amount").textContent ?? "";
    expect(amount).toMatch(/450/);
    // Countdown present
    expect(screen.getByTestId("approval-countdown")).toBeInTheDocument();
    // Cancel button present
    expect(screen.getByTestId("approval-cancel-button")).toBeInTheDocument();
  });

  it("renders the French status pill when language is fr", () => {
    render(<ApprovalPendingCard approval={_approval()} language="fr" />);

    expect(screen.getByTestId("approval-status-pill").textContent).toBe(
      "En attente de l'approbation",
    );
    expect(screen.getByTestId("approval-cancel-button").textContent).toBe(
      "Annuler cette demande",
    );
  });

  it("morphs to 'approved' state when Realtime row UPDATE arrives", async () => {
    const onDecided = vi.fn();
    render(
      <ApprovalPendingCard
        approval={_approval()}
        language="en"
        onDecided={onDecided}
      />,
    );

    // Wait for the async-IIFE to register the Realtime subscription.
    await waitFor(() => expect(lastPostgresChangesHandler).not.toBeNull());

    // Simulate a Realtime UPDATE: manager approved.
    await act(async () => {
      lastPostgresChangesHandler!({
        new: {
          status: "approved",
          decided_by_first_name: "Alice",
          decided_at: new Date().toISOString(),
        },
      });
    });

    expect(screen.getByTestId("approval-approved-card")).toBeInTheDocument();
    const msg = screen.getByTestId("approval-approved-message").textContent ?? "";
    expect(msg).toMatch(/Approved by Alice/);
    // onDecided callback must fire
    expect(onDecided).toHaveBeenCalledOnce();
    const decidedRow = onDecided.mock.calls[0]?.[0] as ApprovalRequestDetails | undefined;
    expect(decidedRow?.status).toBe("approved");
    expect(decidedRow?.decided_by_first_name).toBe("Alice");
  });

  it("onDecided callback receives the merged row (including intermediate UPDATE fields), not the stale initialRow", async () => {
    const onDecided = vi.fn();
    render(
      <ApprovalPendingCard
        approval={_approval()}
        language="en"
        onDecided={onDecided}
      />,
    );

    await waitFor(() => expect(lastPostgresChangesHandler).not.toBeNull());

    // Intermediate (non-terminal) UPDATE: policy_reason changes mid-flight.
    await act(async () => {
      lastPostgresChangesHandler!({
        new: { policy_reason: "Updated policy reason" },
      });
    });

    // Terminal UPDATE arrives next: approved.
    await act(async () => {
      lastPostgresChangesHandler!({
        new: {
          status: "approved",
          decided_by_first_name: "Dana",
          decided_at: new Date().toISOString(),
        },
      });
    });

    expect(onDecided).toHaveBeenCalledOnce();
    const decidedRow = onDecided.mock.calls[0]?.[0] as ApprovalRequestDetails | undefined;
    // Must carry both the terminal fields AND the intermediate field —
    // not the stale initialRow value ("Exceeds €400 limit").
    expect(decidedRow?.status).toBe("approved");
    expect(decidedRow?.decided_by_first_name).toBe("Dana");
    expect(decidedRow?.policy_reason).toBe("Updated policy reason");
  });

  it("morphs to 'rejected' state and surfaces decision_reason", async () => {
    const onDecided = vi.fn();
    render(
      <ApprovalPendingCard
        approval={_approval()}
        language="en"
        onDecided={onDecided}
      />,
    );

    await waitFor(() => expect(lastPostgresChangesHandler).not.toBeNull());

    await act(async () => {
      lastPostgresChangesHandler!({
        new: {
          status: "rejected",
          decision_reason: "Budget exceeded for Q2",
          decided_by_first_name: "Bob",
          decided_at: new Date().toISOString(),
        },
      });
    });

    expect(screen.getByTestId("approval-rejected-card")).toBeInTheDocument();
    const msg = screen.getByTestId("approval-rejected-message").textContent ?? "";
    expect(msg).toMatch(/Budget exceeded for Q2/);
    expect(onDecided).toHaveBeenCalledOnce();
  });

  it("morphs to 'expired' state", async () => {
    render(<ApprovalPendingCard approval={_approval()} language="en" />);

    await waitFor(() => expect(lastPostgresChangesHandler).not.toBeNull());

    await act(async () => {
      lastPostgresChangesHandler!({
        new: { status: "expired" },
      });
    });

    expect(screen.getByTestId("approval-expired-card")).toBeInTheDocument();
    expect(screen.getByTestId("approval-expired-hint").textContent).toMatch(
      /expired/i,
    );
  });

  it("morphs to 'canceled' state", async () => {
    render(<ApprovalPendingCard approval={_approval()} language="en" />);

    await waitFor(() => expect(lastPostgresChangesHandler).not.toBeNull());

    await act(async () => {
      lastPostgresChangesHandler!({
        new: { status: "canceled" },
      });
    });

    expect(screen.getByTestId("approval-canceled-card")).toBeInTheDocument();
    expect(
      screen.getByTestId("approval-canceled-message").textContent,
    ).toMatch(/withdrawn/i);
  });

  it("cancel button calls POST /api/approvals/{id}/cancel", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, { status: 200 }),
    );

    render(<ApprovalPendingCard approval={_approval({ id: "apr-test-1" })} language="en" />);

    const button = screen.getByTestId("approval-cancel-button");
    await act(async () => {
      fireEvent.click(button);
    });

    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/approvals/apr-test-1/cancel",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("renders 'already-pending' initial state when initialRow.status=pending", () => {
    // Defensive: seeded immediately from initialRow, no flicker.
    render(<ApprovalPendingCard approval={_approval({ status: "pending" })} />);
    expect(screen.getByTestId("approval-pending-card")).toBeInTheDocument();
  });

  it("renders approved card immediately when initialRow.status=approved", () => {
    // The SSE consumer (Task 14) may send an already-decided row.
    render(
      <ApprovalPendingCard
        approval={_approval({
          status: "approved",
          decided_by_first_name: "Charlie",
        })}
      />,
    );
    expect(screen.getByTestId("approval-approved-card")).toBeInTheDocument();
  });
});
