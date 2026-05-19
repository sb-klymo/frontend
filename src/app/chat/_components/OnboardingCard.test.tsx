import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { OnboardingDetails } from "@/hooks/useChatStream";

import { OnboardingCard } from "./OnboardingCard";

function _onboarding(
  overrides: Partial<OnboardingDetails> = {},
): OnboardingDetails {
  return {
    url: "https://klymo-frontend.vercel.app/onboarding/payment-method",
    company_name: "Acme Inc.",
    ...overrides,
  };
}

describe("OnboardingCard", () => {
  it("renders title + company-aware subtitle + CTA link", () => {
    render(<OnboardingCard onboarding={_onboarding()} />);

    // Title + body text the user sees.
    expect(screen.getByRole("heading", { name: /save a card/i })).toBeInTheDocument();
    expect(screen.getByTestId("onboarding-subtitle").textContent ?? "").toMatch(
      /Acme Inc\./,
    );
    expect(screen.getByTestId("onboarding-subtitle").textContent ?? "").toMatch(
      /policy/i,
    );

    // CTA points at the backend-supplied URL (no hardcoding here).
    const cta = screen.getByTestId("onboarding-cta");
    expect(cta).toHaveAttribute(
      "href",
      "https://klymo-frontend.vercel.app/onboarding/payment-method",
    );
    expect(cta.textContent ?? "").toMatch(/Add payment method/i);
  });

  it("falls back to a generic subtitle when no company_name is present", () => {
    // Backend sends `company_name: None` when the onboarding draft
    // was missing somehow (defensive path). Card must not render
    // "undefined" or a stray "null" — fall back cleanly.
    render(<OnboardingCard onboarding={_onboarding({ company_name: null })} />);
    const subtitle = screen.getByTestId("onboarding-subtitle").textContent ?? "";
    expect(subtitle).not.toMatch(/null|undefined/i);
    expect(subtitle).toMatch(/policy/i);
  });

  it("falls back to generic subtitle when company_name is empty / whitespace", () => {
    render(<OnboardingCard onboarding={_onboarding({ company_name: "   " })} />);
    const subtitle = screen.getByTestId("onboarding-subtitle").textContent ?? "";
    // Whitespace-only must not produce "   is all set on the policy side."
    expect(subtitle).not.toMatch(/^\s+is/);
    expect(subtitle).toMatch(/policy/i);
  });

  it("renders FR labels when language='fr'", () => {
    render(<OnboardingCard onboarding={_onboarding()} language="fr" />);
    expect(
      screen.getByRole("heading", { name: /enregistrer une carte/i }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("onboarding-cta").textContent ?? "").toMatch(
      /Ajouter un moyen de paiement/i,
    );
    // Subtitle in FR weaves the company name in too.
    expect(screen.getByTestId("onboarding-subtitle").textContent ?? "").toMatch(
      /Acme Inc\./,
    );
  });

  it("renders the security / round-trip note", () => {
    render(<OnboardingCard onboarding={_onboarding()} />);
    const note = screen.getByTestId("onboarding-note").textContent ?? "";
    // The note must mention Stripe (security signal) AND the return
    // expectation ("you'll come back here") — both load-bearing for
    // user trust during the redirect.
    expect(note).toMatch(/Stripe/i);
    expect(note).toMatch(/back/i);
  });
});
