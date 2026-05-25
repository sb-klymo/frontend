import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { DisplayedOffer } from "@/types/chat";

import { OptionList } from "./OptionList";

function _offer(overrides: Partial<DisplayedOffer> = {}): DisplayedOffer {
  return {
    offer_id: "off_1",
    rank: 1,
    airline_name: "Air Test",
    airline_iata: "AT",
    total_amount_cents: 45_000,
    total_currency: "EUR",
    outbound: {
      origin_iata: "CDG",
      destination_iata: "JFK",
      departure_datetime: "2026-06-01T08:00:00+00:00",
      arrival_datetime: "2026-06-01T17:30:00+00:00",
      duration_iso: "PT9H30M",
      // Phase 10 — direct flight default fixture (no stops).
      segments: [],
      stops_count: 0,
      intermediate_airports: [],
      layover_durations_iso: [],
    },
    return_leg: null,
    policy_status: "auto_approved",
    policy_reason: "Within cap.",
    ...overrides,
  };
}

describe("OptionList", () => {
  it("renders the static i18n header + footer when no backend strings are provided", () => {
    // Pre-LLM-rephrase fallback path: no API key, or LLM error → backend
    // didn't populate header/footer in the SSE event. The i18n defaults
    // keep the chat usable.
    render(<OptionList offers={[_offer()]} language="fr" />);

    expect(screen.getByTestId("option-list-header").textContent).toContain(
      "Voici",
    );
    expect(screen.getByTestId("option-list-footer").textContent).toContain(
      "option 1",
    );
  });

  it("renders the backend-rephrased header when provided", () => {
    // Solution #3 happy path: `phrase()` returned a contextual header
    // varying with the user's specific request. OptionList must show it
    // verbatim instead of the static i18n string.
    render(
      <OptionList
        offers={[_offer()]}
        language="fr"
        header="MRS → TLS demain en éco, voici 3 vols :"
      />,
    );

    expect(screen.getByTestId("option-list-header").textContent).toBe(
      "MRS → TLS demain en éco, voici 3 vols :",
    );
    // Header overrides the i18n version completely — should NOT also
    // emit the default counter text.
    expect(screen.queryByText(/Voici 1 option pour votre voyage/)).toBeNull();
  });

  it("renders the backend-rephrased footer when provided", () => {
    render(
      <OptionList
        offers={[_offer()]}
        language="en"
        footer="Reply by number, by price, or by airline."
      />,
    );

    expect(screen.getByTestId("option-list-footer").textContent).toBe(
      "Reply by number, by price, or by airline.",
    );
    // i18n fallback footer would have included the example tokens
    // ("option 1", "the cheapest"). When the backend supplied a
    // footer, those static fragments must not also leak in.
    const footer = screen.getByTestId("option-list-footer").textContent ?? "";
    expect(footer).not.toContain("the cheapest");
  });

  it("renders both backend header AND footer when both are provided", () => {
    render(
      <OptionList
        offers={[_offer()]}
        header="3 options pour Lyon vendredi :"
        footer="Choisis : numéro, prix, ou compagnie."
      />,
    );

    expect(screen.getByTestId("option-list-header").textContent).toBe(
      "3 options pour Lyon vendredi :",
    );
    expect(screen.getByTestId("option-list-footer").textContent).toBe(
      "Choisis : numéro, prix, ou compagnie.",
    );
  });

  it("returns null when offers is empty", () => {
    const { container } = render(<OptionList offers={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

});

// Helper: walks up the DOM tree to check if an element is inside a grey rounded bubble.
function isInsideGreyBubble(el: HTMLElement | null): boolean {
  let node: Element | null = el;
  while (node) {
    const cls = node.className?.toString() ?? "";
    if (/\brounded(-\w+)?\b/.test(cls) && /\bbg-gray-\d+\b/.test(cls)) return true;
    node = node.parentElement;
  }
  return false;
}

describe("OptionList — grey bubble wrapping (QA bug #3)", () => {
  it("header sits inside a grey rounded bubble", () => {
    render(<OptionList offers={[_offer()]} language="en" />);
    expect(isInsideGreyBubble(screen.getByTestId("option-list-header"))).toBe(true);
  });

  it("i18n fallback footer sits inside a grey rounded bubble (selectable=true, no footer prop)", () => {
    render(<OptionList offers={[_offer()]} language="en" />);
    expect(isInsideGreyBubble(screen.getByTestId("option-list-footer"))).toBe(true);
  });

  it("backend-provided footer (selectable=true) sits inside a grey rounded bubble", () => {
    render(
      <OptionList
        offers={[_offer()]}
        language="en"
        footer="Reply by number, by price, or by airline."
      />,
    );
    expect(isInsideGreyBubble(screen.getByTestId("option-list-footer"))).toBe(true);
  });

  it("backend-provided footer (selectable=false) sits inside a grey rounded bubble", () => {
    render(
      <OptionList
        offers={[_offer({ policy_status: "policy_blocked" })]}
        language="en"
        selectable={false}
        footer="Adjust your criteria or contact your manager."
      />,
    );
    expect(isInsideGreyBubble(screen.getByTestId("option-list-footer"))).toBe(true);
  });
});

describe("OptionList — selectable=false (blocked offers read-only mode)", () => {
  function _blockedOffer(rank: number): DisplayedOffer {
    return _offer({
      offer_id: `off_blocked_${rank}`,
      rank,
      policy_status: "policy_blocked",
      policy_reason: "Amount 484.40 EUR exceeds the spend cap of 5.00 EUR",
    });
  }

  const blockedOffers = [_blockedOffer(1), _blockedOffer(2), _blockedOffer(3)];

  it("renders all 3 blocked offer cards when selectable=false", () => {
    render(
      <OptionList
        offers={blockedOffers}
        language="fr"
        selectable={false}
        footer="Ajustez vos critères ou contactez votre responsable."
      />,
    );
    // All 3 cards should render — user sees the options even if blocked
    expect(screen.getAllByText(/Option/).length).toBeGreaterThanOrEqual(3);
  });

  it("does NOT render the booking footer when selectable=false", () => {
    render(
      <OptionList
        offers={blockedOffers}
        language="fr"
        selectable={false}
        footer="Ajustez vos critères."
      />,
    );
    // The "répondez option 1" interactive hint must not appear
    const footer = screen.getByTestId("option-list-footer").textContent ?? "";
    expect(footer).not.toContain("option 1");
    expect(footer).not.toContain("Répondez");
    expect(footer).not.toContain("répondez");
  });

  it("shows the backend-provided footer (adjust-criteria hint) when selectable=false", () => {
    const adjustHint = "Ajustez vos critères ou contactez votre responsable.";
    render(
      <OptionList
        offers={blockedOffers}
        language="fr"
        selectable={false}
        footer={adjustHint}
      />,
    );
    expect(screen.getByTestId("option-list-footer").textContent).toBe(adjustHint);
  });

  it("renders booking footer when selectable is omitted (backward compat default)", () => {
    // Happy path: selectable omitted → defaults to true → interactive footer shown
    render(
      <OptionList
        offers={[_offer()]}
        language="fr"
      />,
    );
    const footer = screen.getByTestId("option-list-footer").textContent ?? "";
    // The i18n default footer contains the "option 1" example token
    expect(footer).toContain("option 1");
  });

  it("renders booking footer when selectable=true (explicit, backward compat)", () => {
    render(
      <OptionList
        offers={[_offer()]}
        language="en"
        selectable={true}
      />,
    );
    const footer = screen.getByTestId("option-list-footer").textContent ?? "";
    expect(footer).toContain("option 1");
  });
});
