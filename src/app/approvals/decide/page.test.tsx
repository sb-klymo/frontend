/**
 * page.test.tsx — Vitest tests for the /approvals/decide Client Component.
 *
 * NOTE: The Server Component (page.tsx) is an async Server Component and
 * cannot be tested with Vitest (CLAUDE.md line 5). It is covered by Playwright
 * E2E tests in Task 15. This file tests the DecideForm Client Component and
 * the error-states renderers.
 */

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, afterEach } from "vitest";

import { DecideForm, type DecideFormProps } from "./DecideForm";
import {
  InvalidTokenPage,
  TokenExpiredPage,
  ApprovalAlreadyDecidedPage,
  ApprovalCanceledPage,
  NotAuthorizedToApprovePage,
  CannotApproveOwnBookingPage,
} from "./error-states";

// ── helpers ───────────────────────────────────────────────────────────────────

function defaultProps(overrides: Partial<DecideFormProps> = {}): DecideFormProps {
  return {
    approvalId: "aaaa-bbbb-cccc-dddd",
    actionFromUrl: "approve",
    totalAmountCents: 45000,
    currency: "EUR",
    tripSummary: "CDG → JFK · 2026-06-15",
    requestingUserFirstName: "Alice",
    policyReason: "Amount exceeds soft cap",
    ...overrides,
  };
}

function mockFetch(status: number, body: unknown) {
  const spy = vi.fn<typeof fetch>().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response);
  globalThis.fetch = spy;
  return spy;
}

// ── error-states unit tests ───────────────────────────────────────────────────

describe("error-states renderers", () => {
  it("InvalidTokenPage renders the broken-link message", () => {
    render(<InvalidTokenPage />);
    expect(screen.getByText(/broken or has been tampered/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /back to klymo/i })).toHaveAttribute(
      "href",
      "/chat",
    );
  });

  it("TokenExpiredPage renders the expired message", () => {
    render(<TokenExpiredPage />);
    expect(screen.getByText(/no longer valid/i)).toBeInTheDocument();
  });

  it("ApprovalAlreadyDecidedPage renders decision details", () => {
    render(
      <ApprovalAlreadyDecidedPage
        decider="Bob"
        decidedAt="2026-06-01T10:00:00.000Z"
        decision="approved"
      />,
    );
    expect(screen.getByText(/already approved/i)).toBeInTheDocument();
    expect(screen.getByText(/Bob/)).toBeInTheDocument();
  });

  it("ApprovalAlreadyDecidedPage shows 'rejected' for rejected decisions", () => {
    render(
      <ApprovalAlreadyDecidedPage
        decider="Carol"
        decidedAt="2026-06-01T10:00:00.000Z"
        decision="rejected"
      />,
    );
    expect(screen.getByText(/already rejected/i)).toBeInTheDocument();
  });

  it("NotAuthorizedToApprovePage renders access-denied message", () => {
    render(<NotAuthorizedToApprovePage />);
    expect(screen.getByText(/don't have access/i)).toBeInTheDocument();
  });

  it("CannotApproveOwnBookingPage renders self-approval message", () => {
    render(<CannotApproveOwnBookingPage />);
    expect(screen.getByText(/can't approve your own booking/i)).toBeInTheDocument();
  });

  it("ApprovalCanceledPage renders canceled message with requester first name", () => {
    render(<ApprovalCanceledPage requesterFirstName="Alice" />);
    expect(screen.getByText(/This request was canceled/i)).toBeInTheDocument();
    expect(screen.getByText(/Alice canceled this request/i)).toBeInTheDocument();
  });

  it("ApprovalCanceledPage renders generic canceled message when no name is provided", () => {
    render(<ApprovalCanceledPage />);
    expect(screen.getByText(/This request was canceled/i)).toBeInTheDocument();
    expect(screen.getByText(/The requester canceled this request/i)).toBeInTheDocument();
  });
});

// ── DecideForm rendering ───────────────────────────────────────────────────────

describe("DecideForm rendering", () => {
  afterEach(() => {
    // @ts-expect-error — restore global
    delete globalThis.fetch;
  });

  it("renders the trip summary, amount, and policy reason", () => {
    render(<DecideForm {...defaultProps()} />);

    expect(screen.getByTestId("trip-summary")).toBeInTheDocument();
    expect(screen.getByText("CDG → JFK · 2026-06-15")).toBeInTheDocument();
    expect(screen.getByText(/Amount exceeds soft cap/i)).toBeInTheDocument();
    // Amount: 45000 cents = €450.00
    expect(screen.getByText(/450/)).toBeInTheDocument();
  });

  it("renders Approve and Reject buttons", () => {
    render(<DecideForm {...defaultProps()} />);

    expect(screen.getByTestId("approve-button")).toBeInTheDocument();
    expect(screen.getByTestId("reject-button")).toBeInTheDocument();
  });

  it("renders the reason textarea", () => {
    render(<DecideForm {...defaultProps()} />);
    expect(screen.getByTestId("decision-reason-textarea")).toBeInTheDocument();
  });

  it("shows the action hint when actionFromUrl is set", () => {
    render(<DecideForm {...defaultProps({ actionFromUrl: "reject" })} />);
    expect(screen.getByTestId("action-hint")).toBeInTheDocument();
    expect(screen.getByTestId("action-hint").textContent).toMatch(/Reject/);
  });

  it("does not show action hint when actionFromUrl is null", () => {
    render(<DecideForm {...defaultProps({ actionFromUrl: null })} />);
    expect(screen.queryByTestId("action-hint")).toBeNull();
  });
});

// ── DecideForm submit — success ────────────────────────────────────────────────

describe("DecideForm submit success", () => {
  afterEach(() => {
    // @ts-expect-error — restore global
    delete globalThis.fetch;
  });

  it("morphs to success state after approve", async () => {
    mockFetch(200, { id: "aaaa-bbbb", status: "approved" });
    render(<DecideForm {...defaultProps()} />);

    await act(async () => {
      fireEvent.click(screen.getByTestId("approve-button"));
    });

    await waitFor(() =>
      expect(screen.getByText(/Approved\./i)).toBeInTheDocument(),
    );
    expect(screen.getByText(/Alice has been notified/i)).toBeInTheDocument();
  });

  it("morphs to success state after reject", async () => {
    mockFetch(200, { id: "aaaa-bbbb", status: "rejected" });
    render(<DecideForm {...defaultProps()} />);

    await act(async () => {
      fireEvent.click(screen.getByTestId("reject-button"));
    });

    await waitFor(() =>
      expect(screen.getByText(/Rejected\./i)).toBeInTheDocument(),
    );
    expect(screen.getByText(/Alice has been notified/i)).toBeInTheDocument();
  });

  it("sends the correct approval_id and action to /api/approvals/decide", async () => {
    const spy = mockFetch(200, { status: "approved" });
    render(<DecideForm {...defaultProps({ approvalId: "test-approval-uuid" })} />);

    await act(async () => {
      fireEvent.click(screen.getByTestId("approve-button"));
    });

    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));

    const [url, init] = spy.mock.calls[0]!;
    expect(url).toBe("/api/approvals/decide");
    expect((init as RequestInit).method).toBe("POST");
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.approval_id).toBe("test-approval-uuid");
    expect(body.action).toBe("approve");
  });

  it("includes decision_reason in POST body when typed", async () => {
    const spy = mockFetch(200, { status: "rejected" });
    render(<DecideForm {...defaultProps()} />);

    fireEvent.change(screen.getByTestId("decision-reason-textarea"), {
      target: { value: "Over budget" },
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId("reject-button"));
    });

    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    const body = JSON.parse((spy.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.decision_reason).toBe("Over budget");
  });

  it("does not send decision_reason when textarea is empty", async () => {
    const spy = mockFetch(200, { status: "approved" });
    render(<DecideForm {...defaultProps()} />);

    await act(async () => {
      fireEvent.click(screen.getByTestId("approve-button"));
    });

    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    const body = JSON.parse((spy.mock.calls[0]![1] as RequestInit).body as string);
    expect("decision_reason" in body).toBe(false);
  });
});

// ── DecideForm submit — error states ──────────────────────────────────────────

describe("DecideForm submit error states", () => {
  afterEach(() => {
    // @ts-expect-error — restore global
    delete globalThis.fetch;
  });

  it("shows TokenExpiredPage on 410", async () => {
    mockFetch(410, { code: "approval_expired" });
    render(<DecideForm {...defaultProps()} />);

    await act(async () => {
      fireEvent.click(screen.getByTestId("approve-button"));
    });

    await waitFor(() =>
      expect(screen.getByText(/no longer valid/i)).toBeInTheDocument(),
    );
  });

  it("shows ApprovalAlreadyDecidedPage on 409 with no meta (race condition)", async () => {
    mockFetch(409, { code: "approval_already_decided" });
    render(<DecideForm {...defaultProps()} />);

    await act(async () => {
      fireEvent.click(screen.getByTestId("approve-button"));
    });

    // When meta is absent, shows a neutral "already decided" page — not an
    // invalid-token page. A 409 is a race condition, not a broken link.
    await waitFor(() =>
      expect(screen.getByText(/already approved/i)).toBeInTheDocument(),
    );
    expect(screen.getByText(/another approver/i)).toBeInTheDocument();
  });

  it("shows CannotApproveOwnBookingPage on 403 + cannot_approve_own_booking code", async () => {
    mockFetch(403, { code: "cannot_approve_own_booking" });
    render(<DecideForm {...defaultProps()} />);

    await act(async () => {
      fireEvent.click(screen.getByTestId("approve-button"));
    });

    await waitFor(() =>
      expect(screen.getByText(/can't approve your own booking/i)).toBeInTheDocument(),
    );
  });

  it("shows NotAuthorizedToApprovePage on 403 without specific code", async () => {
    mockFetch(403, { code: "not_authorized" });
    render(<DecideForm {...defaultProps()} />);

    await act(async () => {
      fireEvent.click(screen.getByTestId("approve-button"));
    });

    await waitFor(() =>
      expect(screen.getByText(/don't have access/i)).toBeInTheDocument(),
    );
  });

  it("shows InvalidTokenPage on 401", async () => {
    mockFetch(401, { code: "unauthorized" });
    render(<DecideForm {...defaultProps()} />);

    await act(async () => {
      fireEvent.click(screen.getByTestId("approve-button"));
    });

    await waitFor(() =>
      expect(screen.getByText(/broken or has been tampered/i)).toBeInTheDocument(),
    );
  });

  it("shows InvalidTokenPage on 404", async () => {
    mockFetch(404, { code: "not_found" });
    render(<DecideForm {...defaultProps()} />);

    await act(async () => {
      fireEvent.click(screen.getByTestId("approve-button"));
    });

    await waitFor(() =>
      expect(screen.getByText(/broken or has been tampered/i)).toBeInTheDocument(),
    );
  });
});

// ── DecideForm disabled state during submission ───────────────────────────────

describe("DecideForm disabled state during submission", () => {
  afterEach(() => {
    // @ts-expect-error — restore global
    delete globalThis.fetch;
  });

  it("disables both buttons and the textarea while submitting", async () => {
    // Use a promise that we resolve manually so we can inspect the in-flight state.
    let resolveSubmit!: (value: Response) => void;
    const pendingFetch = new Promise<Response>((res) => {
      resolveSubmit = res;
    });
    globalThis.fetch = vi.fn<typeof fetch>().mockReturnValue(pendingFetch);

    render(<DecideForm {...defaultProps()} />);

    fireEvent.click(screen.getByTestId("approve-button"));

    // While the fetch is pending, buttons should be disabled
    await waitFor(() =>
      expect(screen.getByTestId("approve-button")).toBeDisabled(),
    );
    expect(screen.getByTestId("reject-button")).toBeDisabled();
    expect(screen.getByTestId("decision-reason-textarea")).toBeDisabled();

    // Resolve to clean up pending state
    resolveSubmit(
      new Response(JSON.stringify({ status: "approved" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
  });
});
