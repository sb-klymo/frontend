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

  it("does not render the email-note or follow-up text in the card (2026-05-12 voice rework moved both lines into the chat bubble emitted by checkout_node)", () => {
    render(<BookingConfirmationCard booking={_booking()} language="en" />);
    // Both lines used to live on the card. As of the voice rework
    // they are emitted by the backend as a chat AIMessage (via the
    // booking-confirmed seed pool in checkout_node), so the card
    // must NOT render them anymore. Same for FR.
    expect(screen.queryByTestId("booking-follow-up")).toBeNull();
    expect(screen.queryByText(/copy is on its way/i)).toBeNull();
    expect(screen.queryByText(/Ready for the next trip/i)).toBeNull();
  });

  it("does not render the email-note or follow-up text in the card (FR)", () => {
    render(<BookingConfirmationCard booking={_booking()} language="fr" />);
    expect(screen.queryByTestId("booking-follow-up")).toBeNull();
    expect(screen.queryByText(/copie arrive/i)).toBeNull();
    expect(screen.queryByText(/Prêt pour le prochain voyage/i)).toBeNull();
  });

  // -------------------------------------------------------------------------
  // 5h — total flight time row
  // -------------------------------------------------------------------------

  it("renders 'Total flight time' row when total_duration_minutes is set", () => {
    // 2h 15m = 135 min.
    render(<BookingConfirmationCard booking={_booking({ total_duration_minutes: 135 })} />);
    expect(screen.getByTestId("booking-total-duration-row")).toBeInTheDocument();
    const duration = screen.getByTestId("booking-total-duration").textContent ?? "";
    expect(duration).toMatch(/2h.*15min/i);
  });

  it("renders the FR label for total flight time", () => {
    render(
      <BookingConfirmationCard
        booking={_booking({ total_duration_minutes: 135 })}
        language="fr"
      />,
    );
    expect(screen.getByText(/Temps de vol total/i)).toBeInTheDocument();
  });

  it("formats whole-hour durations without a stray '0min'", () => {
    // 4h flat — must read as "4h", not "4h 0min".
    render(<BookingConfirmationCard booking={_booking({ total_duration_minutes: 240 })} />);
    const duration = screen.getByTestId("booking-total-duration").textContent ?? "";
    expect(duration).toBe("4h");
  });

  it("handles round-trip total (sums of both legs)", () => {
    // Real-world round-trip: ~9h30 outbound + ~13h30 return = 1380 min.
    render(<BookingConfirmationCard booking={_booking({ total_duration_minutes: 1380 })} />);
    const duration = screen.getByTestId("booking-total-duration").textContent ?? "";
    // 1380 / 60 = 23h, 1380 % 60 = 0.
    expect(duration).toBe("23h");
  });

  it("hides the row when total_duration_minutes is missing (legacy payload)", () => {
    render(<BookingConfirmationCard booking={_booking()} />);
    expect(screen.queryByTestId("booking-total-duration-row")).toBeNull();
  });

  it("hides the row when total_duration_minutes is 0 (zero is meaningless to display)", () => {
    render(<BookingConfirmationCard booking={_booking({ total_duration_minutes: 0 })} />);
    expect(screen.queryByTestId("booking-total-duration-row")).toBeNull();
  });
});
