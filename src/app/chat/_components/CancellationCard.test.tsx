import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { CancellationDetails } from "@/hooks/useChatStream";

import { CancellationCard } from "./CancellationCard";

function _cancellation(
  overrides: Partial<CancellationDetails> = {},
): CancellationDetails {
  return {
    trip_id: "trip-uuid-1",
    booking_reference: "STUBABC123",
    refund_id: "re_test_demo",
    amount_cents: 45_000,
    currency: "EUR",
    ...overrides,
  };
}

describe("CancellationCard", () => {
  it("renders the booking reference, refund amount, and refund ID", () => {
    render(<CancellationCard cancellation={_cancellation()} language="en" />);

    expect(
      screen.getByTestId("cancellation-booking-reference").textContent,
    ).toBe("STUBABC123");
    // Intl currency formatting in en-US adds a € prefix for EUR.
    expect(
      screen.getByTestId("cancellation-refund-amount").textContent,
    ).toContain("450");
    expect(screen.getByTestId("cancellation-refund-id").textContent).toBe(
      "re_test_demo",
    );
  });

  it("links the refund ID to the Stripe Dashboard refunds page", () => {
    render(<CancellationCard cancellation={_cancellation()} />);

    const link = screen.getByTestId("cancellation-refund-id");
    expect(link.getAttribute("href")).toContain("dashboard.stripe.com");
    expect(link.getAttribute("target")).toBe("_blank");
    // Security: noopener noreferrer when opening third-party domains.
    expect(link.getAttribute("rel")).toContain("noopener");
  });

  it("hides the refund ID row when refund_id is empty", () => {
    /* Backend may emit an empty refund_id when the projection
     * couldn't pull it from payment_audit metadata (defensive path).
     * The card stays usable without it — booking ref + amount + note
     * are still shown. */
    render(<CancellationCard cancellation={_cancellation({ refund_id: "" })} />);

    expect(screen.queryByTestId("cancellation-refund-id")).toBeNull();
    // Other fields still render.
    expect(
      screen.getByTestId("cancellation-booking-reference").textContent,
    ).toBe("STUBABC123");
  });

  it("renders French labels when language='fr'", () => {
    render(<CancellationCard cancellation={_cancellation()} language="fr" />);

    expect(screen.getByText("Réservation annulée")).toBeInTheDocument();
    expect(screen.getByText("Remboursé")).toBeInTheDocument();
    expect(screen.getByText("ID remboursement")).toBeInTheDocument();
  });

  it("formats the refund amount in the user's locale", () => {
    /* USD in en-US → $ prefix. The currency code drives Intl.NumberFormat. */
    render(
      <CancellationCard
        cancellation={_cancellation({ currency: "USD", amount_cents: 54_000 })}
        language="en"
      />,
    );

    const amount = screen.getByTestId("cancellation-refund-amount").textContent ?? "";
    expect(amount).toContain("540");
    expect(amount).toContain("$");
  });
});

describe("CancellationCard - fee breakdown (Phase 18)", () => {
  it("renders original + fee rows when a penalty was withheld", () => {
    render(
      <CancellationCard
        cancellation={_cancellation({
          currency: "USD",
          amount_cents: 46_000,
          penalty_amount_cents: 8_000,
          original_amount_cents: 54_000,
        })}
        language="en"
      />,
    );

    expect(screen.getByText("Cancellation fee")).toBeInTheDocument();
    expect(screen.getByText("Original amount")).toBeInTheDocument();
    expect(
      screen.getByTestId("cancellation-penalty-amount").textContent,
    ).toContain("80.00");
    expect(
      screen.getByTestId("cancellation-original-amount").textContent,
    ).toContain("540.00");
  });

  it("renders FR labels with the typographic apostrophe", () => {
    render(
      <CancellationCard
        cancellation={_cancellation({
          penalty_amount_cents: 8_000,
          original_amount_cents: 54_000,
        })}
        language="fr"
      />,
    );

    expect(screen.getByText("Frais d’annulation")).toBeInTheDocument();
    expect(screen.getByText("Montant initial")).toBeInTheDocument();
  });

  it("hides both rows for a free cancellation (penalty 0)", () => {
    render(
      <CancellationCard
        cancellation={_cancellation({
          penalty_amount_cents: 0,
          original_amount_cents: 45_000,
        })}
      />,
    );

    expect(screen.queryByTestId("cancellation-penalty-amount")).toBeNull();
    expect(screen.queryByTestId("cancellation-original-amount")).toBeNull();
  });

  it("hides both rows on legacy payloads without the fields", () => {
    render(<CancellationCard cancellation={_cancellation()} />);

    expect(screen.queryByTestId("cancellation-penalty-amount")).toBeNull();
    expect(screen.queryByTestId("cancellation-original-amount")).toBeNull();
  });
});
