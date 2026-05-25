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
    // Phase 10 — direct flight default fixture (no stops).
    segments: [],
    stops_count: 0,
    intermediate_airports: [],
    layover_durations_iso: [],
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
            segments: [],
            stops_count: 0,
            intermediate_airports: [],
            layover_durations_iso: [],
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

  it("renders the date in EN format ('Jun 1') above the slice line", () => {
    // User feedback 2026-05-21: live Duffel offers carry a real
    // departure date, the card should surface it so the user can spot
    // a wrong-day pick before clicking through. EN locale formats day
    // after month.
    render(<OptionCard offer={baseOffer} language="en" />);
    expect(screen.getByText(/Jun 1/)).toBeInTheDocument();
  });

  it("renders the date in FR format ('1 juin') above the slice line", () => {
    render(<OptionCard offer={baseOffer} language="fr" />);
    expect(screen.getByText(/1 juin/)).toBeInTheDocument();
  });

  it("renders per-slice dates for round-trip when outbound/return differ", () => {
    // Round-trip with outbound Jun 1, return Jun 8 — both dates must
    // surface so the user can verify the return-leg booking.
    render(
      <OptionCard
        offer={{
          ...baseOffer,
          return_leg: {
            origin_iata: "JFK",
            destination_iata: "CDG",
            departure_datetime: "2026-06-08T18:30:00",
            arrival_datetime: "2026-06-09T08:45:00",
            duration_iso: "PT8H15M",
            segments: [],
            stops_count: 0,
            intermediate_airports: [],
            layover_durations_iso: [],
          },
        }}
        language="en"
      />,
    );
    expect(screen.getByText(/Jun 1/)).toBeInTheDocument();
    expect(screen.getByText(/Jun 8/)).toBeInTheDocument();
  });
});

describe("OptionCard — Phase 10 duration + stops + layover", () => {
  it("renders 'Direct' in green for stops_count=0", () => {
    // Direct flight (8h 21min, no stops). Expect: "Direct" rendered in a
    // green Tailwind class so the user can spot zero-stop offers instantly.
    render(
      <OptionCard
        offer={{
          ...baseOffer,
          outbound: {
            ...baseOffer.outbound,
            duration_iso: "PT8H21M",
            stops_count: 0,
            intermediate_airports: [],
            layover_durations_iso: [],
          },
        }}
        language="en"
      />,
    );
    const directNode = screen.getByText("Direct");
    expect(directNode).toBeInTheDocument();
    expect(directNode.className).toMatch(/text-green-/);
  });

  it("renders '1 stop · 2h 15min in MAD' for normal layover", () => {
    // 1 stop, 2h 15min layover in MAD — within normal range, gray text.
    render(
      <OptionCard
        offer={{
          ...baseOffer,
          outbound: {
            ...baseOffer.outbound,
            duration_iso: "PT11H15M",
            stops_count: 1,
            intermediate_airports: ["MAD"],
            layover_durations_iso: ["PT2H15M"],
          },
        }}
        language="en"
      />,
    );
    expect(screen.getByText(/1 stop/)).toBeInTheDocument();
    expect(screen.getByText(/MAD/)).toBeInTheDocument();
    expect(screen.getByText(/2h 15min/)).toBeInTheDocument();
  });

  it("applies orange class for tight layover (<60min)", () => {
    // 45min layover — risky connection, orange warning.
    render(
      <OptionCard
        offer={{
          ...baseOffer,
          outbound: {
            ...baseOffer.outbound,
            duration_iso: "PT11H30M",
            stops_count: 1,
            intermediate_airports: ["AMS"],
            layover_durations_iso: ["PT45M"],
          },
        }}
        language="en"
      />,
    );
    const layoverNode = screen.getByTestId("layover-detail");
    expect(layoverNode.className).toMatch(/orange/);
  });

  it("applies orange class for long layover (>5h)", () => {
    // 6h 30min layover — boring layover, orange warning.
    render(
      <OptionCard
        offer={{
          ...baseOffer,
          outbound: {
            ...baseOffer.outbound,
            duration_iso: "PT16H30M",
            stops_count: 1,
            intermediate_airports: ["FRA"],
            layover_durations_iso: ["PT6H30M"],
          },
        }}
        language="en"
      />,
    );
    const layoverNode = screen.getByTestId("layover-detail");
    expect(layoverNode.className).toMatch(/orange/);
  });

  it("renders '2 stops · IST, FRA' for two stops (no individual layover durations)", () => {
    // 2 stops — we don't surface individual layover lengths, just the IATAs
    // comma-joined.
    render(
      <OptionCard
        offer={{
          ...baseOffer,
          outbound: {
            ...baseOffer.outbound,
            duration_iso: "PT19H40M",
            stops_count: 2,
            intermediate_airports: ["IST", "FRA"],
            layover_durations_iso: [],
          },
        }}
        language="en"
      />,
    );
    expect(screen.getByText(/2 stops/)).toBeInTheDocument();
    expect(screen.getByText(/IST/)).toBeInTheDocument();
    expect(screen.getByText(/FRA/)).toBeInTheDocument();
  });

  it("renders '+1' suffix when arrival date differs from departure", () => {
    // Red-eye flight: departs Jun 2 22:50 UTC, arrives Jun 3 18:30 UTC.
    // The arrival time must carry a "+1" suffix so the user notices the
    // day rollover.
    render(
      <OptionCard
        offer={{
          ...baseOffer,
          outbound: {
            ...baseOffer.outbound,
            departure_datetime: "2026-06-02T22:50:00+00:00",
            arrival_datetime: "2026-06-03T18:30:00+00:00",
            duration_iso: "PT19H40M",
          },
        }}
        language="en"
      />,
    );
    expect(screen.getByText(/\+1/)).toBeInTheDocument();
  });
});

describe("OptionCard — policy_blocked localized reason", () => {
  const blockedOffer: DisplayedOffer = {
    ...baseOffer,
    policy_status: "policy_blocked",
    policy_reason: "Amount 484.40 EUR exceeds the spend cap of 5.00 EUR",
  };

  it("shows the red blocked badge for policy_blocked in EN", () => {
    render(<OptionCard offer={blockedOffer} language="en" />);
    expect(screen.getByText(/✗ blocked/)).toBeInTheDocument();
  });

  it("shows the red blocked badge for policy_blocked in FR", () => {
    render(<OptionCard offer={blockedOffer} language="fr" />);
    expect(screen.getByText(/✗ bloqué/)).toBeInTheDocument();
  });

  it("renders a localized EN reason (NOT the raw engine string) for policy_blocked", () => {
    render(<OptionCard offer={blockedOffer} language="en" />);
    // Must show a localized phrase — not the raw backend engine string
    expect(screen.queryByText("Amount 484.40 EUR exceeds the spend cap of 5.00 EUR")).toBeNull();
    // Must show something about policy cap in English
    const card = screen.getByText(/cap|policy/i);
    expect(card).toBeInTheDocument();
  });

  it("renders a localized FR reason (NOT the raw engine string) for policy_blocked", () => {
    render(<OptionCard offer={blockedOffer} language="fr" />);
    // Must show a localized phrase — not the raw backend engine string
    expect(screen.queryByText("Amount 484.40 EUR exceeds the spend cap of 5.00 EUR")).toBeNull();
    // Must show something about plafond in French
    const card = screen.getByText(/plafond/i);
    expect(card).toBeInTheDocument();
  });

  it("amber manager-approval card still shows the raw policy_reason (unchanged behavior)", () => {
    render(
      <OptionCard
        offer={{
          ...baseOffer,
          policy_status: "manager_approval_required",
          policy_reason: "Amount exceeds threshold of €300.",
        }}
        language="en"
      />,
    );
    // Amber cards continue to display the raw reason as before
    expect(screen.getByText("Amount exceeds threshold of €300.")).toBeInTheDocument();
  });
});

describe("OptionCard — Phase 10 French language", () => {
  it("renders FR singular '1 escale' and 'à MAD' layover preposition", () => {
    // Regression guard for B-FE1 (PR #49 review): SliceInfoRow previously
    // hard-coded "1 stop · 2h 15min in MAD". A French user must see fully
    // French copy on the new row — singular "escale" + "à" preposition.
    render(
      <OptionCard
        offer={{
          ...baseOffer,
          outbound: {
            ...baseOffer.outbound,
            duration_iso: "PT11H15M",
            stops_count: 1,
            intermediate_airports: ["MAD"],
            layover_durations_iso: ["PT2H15M"],
          },
        }}
        language="fr"
      />,
    );
    expect(screen.getByText(/1 escale/)).toBeInTheDocument();
    expect(screen.getByText(/à MAD/)).toBeInTheDocument();
    // No English residue:
    expect(screen.queryByText(/1 stop/)).toBeNull();
    expect(screen.queryByText(/ in MAD/)).toBeNull();
  });

  it("renders FR plural 'escales' for 2+ stops", () => {
    render(
      <OptionCard
        offer={{
          ...baseOffer,
          outbound: {
            ...baseOffer.outbound,
            duration_iso: "PT19H40M",
            stops_count: 2,
            intermediate_airports: ["IST", "FRA"],
            layover_durations_iso: [],
          },
        }}
        language="fr"
      />,
    );
    expect(screen.getByText(/2 escales/)).toBeInTheDocument();
    expect(screen.queryByText(/2 stops/)).toBeNull();
  });

  it("renders FR leg labels 'Aller' / 'Retour' on a round-trip", () => {
    // Direct (same word EN+FR) on both legs — but the leg labels must
    // localise. Two "Direct" instances expected (one per slice).
    render(
      <OptionCard
        offer={{
          ...baseOffer,
          outbound: {
            ...baseOffer.outbound,
            duration_iso: "PT8H21M",
            stops_count: 0,
            intermediate_airports: [],
            layover_durations_iso: [],
          },
          return_leg: {
            origin_iata: "JFK",
            destination_iata: "CDG",
            departure_datetime: "2026-06-08T14:30:00",
            arrival_datetime: "2026-06-08T21:45:00",
            duration_iso: "PT7H15M",
            segments: [],
            stops_count: 0,
            intermediate_airports: [],
            layover_durations_iso: [],
          },
        }}
        language="fr"
      />,
    );
    expect(screen.getByText(/Aller/)).toBeInTheDocument();
    expect(screen.getByText(/Retour/)).toBeInTheDocument();
    expect(screen.getAllByText("Direct").length).toBeGreaterThanOrEqual(2);
    // No English residue:
    expect(screen.queryByText(/Outbound/)).toBeNull();
    expect(screen.queryByText("Return")).toBeNull();
  });
});
