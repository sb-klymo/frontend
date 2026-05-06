import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { BookingDetails } from "@/hooks/useChatStream";

import { BookingConfirmationCard } from "./BookingConfirmationCard";

function _booking(overrides: Partial<BookingDetails> = {}): BookingDetails {
  return {
    trip_id: "tr-abc-123",
    booking_reference: "STUBABC123",
    passenger_name: "Jean Dupont",
    amount_cents: 45_000,
    currency: "USD",
    legs: [
      {
        origin_iata: "CDG",
        destination_iata: "JFK",
        departure_iso: "2026-06-01T08:00:00Z",
        arrival_iso: "2026-06-01T10:15:00Z",
        airline_name: "Air Stub",
      },
    ],
    ...overrides,
  };
}

describe("BookingConfirmationCard", () => {
  it("renders booking reference, passenger, total and download link", () => {
    render(<BookingConfirmationCard booking={_booking()} />);

    expect(screen.getByTestId("booking-reference").textContent).toBe("STUBABC123");
    expect(screen.getByTestId("booking-passenger").textContent).toBe("Jean Dupont");
    // Total formatted via Intl — exact string differs per locale, just
    // pin that the amount + currency code both appear.
    const totalText = screen.getByTestId("booking-total").textContent ?? "";
    expect(totalText).toMatch(/450/);
    expect(totalText.toUpperCase()).toMatch(/USD|US\$|\$/);
    // Download link points at the BFF proxy, not the backend directly.
    const link = screen.getByTestId("booking-download-link");
    expect(link).toHaveAttribute("href", "/api/trips/tr-abc-123/ticket.pdf");
    expect(link).toHaveAttribute("download", "klymo-ticket-STUBABC123.pdf");
  });

  it("renders one row per flight leg (round-trip)", () => {
    const booking = _booking({
      legs: [
        {
          origin_iata: "CDG",
          destination_iata: "JFK",
          departure_iso: "2026-06-01T08:00:00Z",
          arrival_iso: "2026-06-01T10:15:00Z",
          airline_name: "Air Stub",
        },
        {
          origin_iata: "JFK",
          destination_iata: "CDG",
          departure_iso: "2026-06-08T18:00:00Z",
          arrival_iso: "2026-06-09T07:30:00Z",
          airline_name: "Air Stub",
        },
      ],
    });
    render(<BookingConfirmationCard booking={booking} />);
    const rows = screen.getAllByTestId("booking-leg-row");
    expect(rows).toHaveLength(2);
    // Outbound and inbound IATAs both present.
    const allText = rows.map((r) => r.textContent).join(" | ");
    expect(allText).toMatch(/CDG.*JFK/);
    expect(allText).toMatch(/JFK.*CDG/);
  });

  it("uses French labels when language is fr", () => {
    render(<BookingConfirmationCard booking={_booking()} language="fr" />);
    expect(screen.getByRole("heading", { name: /Réservation confirmée/i })).toBeInTheDocument();
    expect(screen.getByText(/Référence/)).toBeInTheDocument();
    expect(screen.getByText(/Télécharger le billet/i)).toBeInTheDocument();
  });

  it("encodes trip_id in the download URL to handle special characters", () => {
    const booking = _booking({ trip_id: "weird/id with space" });
    render(<BookingConfirmationCard booking={booking} />);
    const link = screen.getByTestId("booking-download-link");
    // encodeURIComponent: '/' → %2F, ' ' → %20.
    expect(link).toHaveAttribute(
      "href",
      "/api/trips/weird%2Fid%20with%20space/ticket.pdf",
    );
  });

  it("falls back gracefully when currency is non-ISO", () => {
    const booking = _booking({ currency: "ZZZ" });
    render(<BookingConfirmationCard booking={booking} />);
    // No throw; total still rendered with the unknown code appended.
    const total = screen.getByTestId("booking-total").textContent ?? "";
    expect(total).toMatch(/450/);
  });
});
