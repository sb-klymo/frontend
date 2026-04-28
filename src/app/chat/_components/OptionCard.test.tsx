import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { DisplayedOffer } from "@/types/chat";

import { OptionCard } from "./OptionCard";

const baseOffer: DisplayedOffer = {
  offer_id: "off_1",
  rank: 1,
  airline_name: "Air Stub",
  airline_iata: "AS",
  total_amount_cents: 45_000,
  total_currency: "EUR",
  outbound: {
    origin_iata: "CDG",
    destination_iata: "JFK",
    // Naive ISO timestamp — what the duffel_stub emits today. Must render
    // as 08:00 regardless of the viewer's local timezone.
    departure_datetime: "2026-06-01T08:00:00",
    arrival_datetime: "2026-06-01T10:15:00",
    duration_iso: "PT2H15M",
  },
  return_leg: null,
  policy_status: "auto_approved",
  policy_reason: "Within cap.",
};

describe("OptionCard", () => {
  it("renders the time as encoded in the ISO string (no TZ shift)", () => {
    // Regression test for the bug where `new Date(naive_iso).toLocaleTimeString({timeZone:"UTC"})`
    // shifted "08:00" by the local UTC offset. The card and the bot's text
    // confirmation must agree on the displayed hour.
    render(<OptionCard offer={baseOffer} />);
    expect(screen.getByText(/08:00/)).toBeInTheDocument();
    expect(screen.getByText(/10:15/)).toBeInTheDocument();
    expect(screen.queryByText(/06:00/)).toBeNull();
  });

  it("renders airline, IATA badge, and price", () => {
    render(<OptionCard offer={baseOffer} />);
    expect(screen.getByText("Air Stub")).toBeInTheDocument();
    expect(screen.getByText("AS")).toBeInTheDocument();
    expect(screen.getByText("€450")).toBeInTheDocument();
  });

  it("formats prices with cents when non-zero", () => {
    render(
      <OptionCard offer={{ ...baseOffer, total_amount_cents: 45_050 }} />,
    );
    expect(screen.getByText("€450.50")).toBeInTheDocument();
  });

  it("shows the approved badge for auto_approved offers", () => {
    render(<OptionCard offer={baseOffer} />);
    expect(screen.getByText(/✓ approved/)).toBeInTheDocument();
  });

  it("shows the manager-approval badge + policy reason when needs approval", () => {
    render(
      <OptionCard
        offer={{
          ...baseOffer,
          policy_status: "manager_approval_required",
          policy_reason: "Amount exceeds threshold of €300.",
        }}
      />,
    );
    expect(
      screen.getByText(/⚠ requires manager approval/),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Amount exceeds threshold of €300."),
    ).toBeInTheDocument();
  });

  it("renders the return leg when present (round-trip)", () => {
    render(
      <OptionCard
        offer={{
          ...baseOffer,
          return_leg: {
            origin_iata: "JFK",
            destination_iata: "CDG",
            departure_datetime: "2026-06-08T14:30:00",
            arrival_datetime: "2026-06-08T16:45:00",
            duration_iso: "PT2H15M",
          },
        }}
      />,
    );
    // Outbound + return both visible
    expect(screen.getByText(/08:00/)).toBeInTheDocument();
    expect(screen.getByText(/14:30/)).toBeInTheDocument();
  });

  it("renders French strings when language='fr'", () => {
    render(<OptionCard offer={baseOffer} language="fr" />);
    // "Option" stays the same in French (cognate); badge changes
    expect(screen.getByText(/✓ approuvé/)).toBeInTheDocument();
    expect(screen.queryByText(/✓ approved/)).toBeNull();
  });

  it("French manager-approval badge is localized", () => {
    render(
      <OptionCard
        offer={{
          ...baseOffer,
          policy_status: "manager_approval_required",
          policy_reason: "Au-delà du seuil.",
        }}
        language="fr"
      />,
    );
    expect(
      screen.getByText(/approbation manager requise/),
    ).toBeInTheDocument();
  });
});
