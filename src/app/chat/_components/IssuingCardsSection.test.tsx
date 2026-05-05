import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { IssuingCardsSection } from "./IssuingCardsSection";

type CardRow = {
  booking_ref: string;
  stripe_issuing_card_id: string;
  last4: string | null;
  amount_cents: number;
  currency: string;
  outcome: "paid" | "canceled" | "pending";
  created_at: string;
};

function mockFetch(payload: { cards: CardRow[] } | { error: string }, status = 200) {
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
  return render(
    <QueryClientProvider client={client}>{ui}</QueryClientProvider>,
  );
}

function defaultProps() {
  return {
    language: "fr" as const,
    open: true,
    onToggle: vi.fn(),
  };
}

describe("IssuingCardsSection", () => {
  afterEach(() => {
    // @ts-expect-error — restore the global; jsdom recreates it next test.
    delete globalThis.fetch;
  });

  it("auto-fetches when open and renders rows", async () => {
    mockFetch({
      cards: [
        {
          booking_ref: "trip_a",
          stripe_issuing_card_id: "ic_1abc",
          last4: "4242",
          amount_cents: 45000,
          currency: "USD",
          outcome: "paid",
          created_at: "2026-05-05T18:00:00Z",
        },
      ],
    });

    renderWithClient(<IssuingCardsSection {...defaultProps()} />);

    await waitFor(() => {
      expect(screen.getByTestId("dev-issuing-cards-list")).toBeInTheDocument();
    });

    expect(screen.getByTestId("dev-issuing-card-last4").textContent).toContain("4242");
    expect(screen.getByTestId("dev-issuing-card-outcome").textContent).toMatch(
      /payé/i,
    );
    expect(screen.getByTestId("dev-issuing-card-stripe-link")).toHaveAttribute(
      "href",
      "https://dashboard.stripe.com/test/issuing/cards/ic_1abc",
    );
  });

  it("shows the empty state when the list is empty", async () => {
    mockFetch({ cards: [] });
    renderWithClient(<IssuingCardsSection {...defaultProps()} />);

    await waitFor(() => {
      expect(screen.getByTestId("dev-issuing-cards-empty")).toBeInTheDocument();
    });
  });

  it("renders '—' for last4 when the card hasn't reached J5 yet", async () => {
    mockFetch({
      cards: [
        {
          booking_ref: "trip_pending",
          stripe_issuing_card_id: "ic_pending",
          last4: null,
          amount_cents: 12345,
          currency: "USD",
          outcome: "pending",
          created_at: "2026-05-05T18:00:00Z",
        },
      ],
    });

    renderWithClient(<IssuingCardsSection {...defaultProps()} />);

    await waitFor(() => {
      expect(screen.getByTestId("dev-issuing-card-last4").textContent).toContain("—");
    });
  });

  it("does NOT fetch when collapsed", () => {
    const fetchSpy = mockFetch({ cards: [] });
    renderWithClient(<IssuingCardsSection {...defaultProps()} open={false} />);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("Refresh button stays present and clickable after the first fetch", async () => {
    mockFetch({ cards: [] });
    renderWithClient(<IssuingCardsSection {...defaultProps()} />);

    // Wait for the initial query to settle.
    await waitFor(() => {
      expect(screen.getByTestId("dev-issuing-cards-empty")).toBeInTheDocument();
    });

    // After settle, the refresh button is enabled (not stuck in loading).
    const refreshButton = screen.getByTestId("dev-issuing-cards-refresh");
    expect(refreshButton).not.toBeDisabled();

    // Clicking it should not throw and the empty state should still be visible.
    fireEvent.click(refreshButton);
    expect(screen.getByTestId("dev-issuing-cards-empty")).toBeInTheDocument();
  });

  it("surfaces an error banner on non-2xx", async () => {
    mockFetch({ error: "boom" }, 500);
    renderWithClient(<IssuingCardsSection {...defaultProps()} />);

    await waitFor(() => {
      expect(screen.getByTestId("dev-issuing-cards-error")).toBeInTheDocument();
    });
  });

  it("never renders PAN or CVC fields", async () => {
    mockFetch({
      cards: [
        {
          booking_ref: "trip_a",
          stripe_issuing_card_id: "ic_1abc",
          last4: "4242",
          amount_cents: 45000,
          currency: "USD",
          outcome: "paid",
          created_at: "2026-05-05T18:00:00Z",
        },
      ],
    });

    const { container } = renderWithClient(
      <IssuingCardsSection {...defaultProps()} />,
    );

    await waitFor(() => {
      expect(screen.getByTestId("dev-issuing-cards-list")).toBeInTheDocument();
    });

    const html = container.innerHTML.toLowerCase();
    // The 16-digit PAN form must never appear in the rendered output.
    expect(html).not.toMatch(/4242\s*4242\s*4242\s*4242/);
    // CVC labels likewise.
    expect(html).not.toContain("cvc");
  });

  it("uses English labels when language is en", async () => {
    mockFetch({ cards: [] });
    renderWithClient(<IssuingCardsSection {...defaultProps()} language="en" />);

    expect(screen.getByRole("heading", { name: /Issuing Cards/i })).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByTestId("dev-issuing-cards-empty").textContent).toMatch(
        /no virtual cards/i,
      );
    });
  });

  it("clicking the heading toggles via onToggle", () => {
    const onToggle = vi.fn();
    mockFetch({ cards: [] });
    renderWithClient(
      <IssuingCardsSection {...defaultProps()} onToggle={onToggle} />,
    );

    fireEvent.click(
      screen.getByRole("heading", { name: /Cartes Issuing/i }).parentElement!,
    );
    expect(onToggle).toHaveBeenCalledOnce();
  });
});
