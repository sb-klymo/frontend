import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PaymentStatusSection } from "./PaymentStatusSection";

type MeResponse = {
  id: string;
  email?: string | null;
  payment_mode?: "auto_charge" | "checkout_opt_in" | "checkout_fallback";
  stripe_payment_method_id?: string | null;
};

function mockFetch(payload: MeResponse | { error: string }, status = 200) {
  const fetchSpy = vi.fn(() =>
    Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      json: () => Promise.resolve(payload),
    } as Response),
  );
  globalThis.fetch = fetchSpy as unknown as typeof fetch;
  return fetchSpy;
}

/**
 * Each test gets a fresh QueryClient with retry disabled — without
 * `retry: false` an error path triggers up to 4 fetch attempts and the
 * error UI takes seconds to surface, blowing the test budget.
 */
function renderWithClient(ui: ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

function defaultProps() {
  return {
    language: "fr" as const,
    open: true,
    onToggle: vi.fn(),
  };
}

describe("PaymentStatusSection", () => {
  afterEach(() => {
    // @ts-expect-error — restore the global; jsdom recreates it next test.
    delete globalThis.fetch;
  });

  it("renders saved-card ✓ when stripe_payment_method_id is present", async () => {
    mockFetch({
      id: "u-1",
      email: "u@klymo.local",
      payment_mode: "auto_charge",
      stripe_payment_method_id: "pm_test_123",
    });

    renderWithClient(<PaymentStatusSection {...defaultProps()} />);

    await waitFor(() => {
      expect(screen.getByTestId("dev-payment-status-fields")).toBeInTheDocument();
    });

    // Mode label rendered in FR by default props.
    expect(screen.getByTestId("dev-payment-status-mode").textContent).toContain(
      "Prélèvement auto",
    );
    // Saved-card row shows the ✓ Oui marker.
    expect(screen.getByTestId("dev-payment-status-has-card").textContent).toContain(
      "✓",
    );
    // PM ID shows up as a deep-link to Stripe.
    const pmLink = screen.getByTestId("dev-payment-status-pm-id");
    expect(pmLink.textContent).toBe("pm_test_123");
    expect(pmLink.getAttribute("href")).toContain("dashboard.stripe.com");
    // Heading badge mirrors saved-card status.
    expect(screen.getByTestId("dev-payment-status-badge").textContent).toContain(
      "✓",
    );
  });

  it("renders saved-card ✗ when stripe_payment_method_id is null", async () => {
    mockFetch({
      id: "u-2",
      email: "newcomer@klymo.local",
      payment_mode: "checkout_fallback",
      stripe_payment_method_id: null,
    });

    renderWithClient(<PaymentStatusSection {...defaultProps()} />);

    await waitFor(() => {
      expect(screen.getByTestId("dev-payment-status-fields")).toBeInTheDocument();
    });

    expect(screen.getByTestId("dev-payment-status-has-card").textContent).toContain(
      "✗",
    );
    // No PM ID row when the field is null.
    expect(screen.queryByTestId("dev-payment-status-pm-id")).toBeNull();
    expect(screen.getByTestId("dev-payment-status-mode").textContent).toContain(
      "Checkout",
    );
  });

  it("does not fetch when section is collapsed", () => {
    const fetchSpy = mockFetch({ id: "u-3" });

    renderWithClient(
      <PaymentStatusSection language="fr" open={false} onToggle={vi.fn()} />,
    );

    // `enabled: open` keeps the query idle when the section is closed.
    expect(fetchSpy).not.toHaveBeenCalled();
    // Body content not rendered.
    expect(screen.queryByTestId("dev-payment-status-fields")).toBeNull();
  });

  it("surfaces a Failed-to-load error on non-2xx responses", async () => {
    mockFetch({ error: "boom" }, 500);

    renderWithClient(<PaymentStatusSection {...defaultProps()} />);

    await waitFor(() => {
      expect(screen.getByTestId("dev-payment-status-error")).toBeInTheDocument();
    });
    expect(
      screen.getByTestId("dev-payment-status-error").textContent,
    ).toContain("HTTP 500");
  });

  it("renders English labels when language='en'", async () => {
    mockFetch({
      id: "u-4",
      payment_mode: "checkout_opt_in",
      stripe_payment_method_id: null,
    });

    renderWithClient(
      <PaymentStatusSection language="en" open={true} onToggle={vi.fn()} />,
    );

    await waitFor(() => {
      expect(screen.getByTestId("dev-payment-status-fields")).toBeInTheDocument();
    });

    expect(screen.getByTestId("dev-payment-status-has-card").textContent).toContain(
      "No",
    );
    expect(screen.getByTestId("dev-payment-status-mode").textContent).toContain(
      "Checkout (opt-in)",
    );
  });
});
