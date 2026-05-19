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

describe("OnboardingCard — pending state (default)", () => {
  it("renders title + subtitle + CTA link", () => {
    render(<OnboardingCard onboarding={_onboarding()} />);

    expect(screen.getByRole("heading", { name: /save a card/i })).toBeInTheDocument();
    // Subtitle is now generic (no company-name interpolation). The
    // 2026-05-19 simplification dropped the policy-side phrasing
    // because it didn't apply to personal users.
    expect(screen.getByTestId("onboarding-subtitle").textContent ?? "").toMatch(
      /payment method/i,
    );

    // CTA points at the backend-supplied URL (no hardcoding here).
    const cta = screen.getByTestId("onboarding-cta");
    expect(cta).toHaveAttribute(
      "href",
      "https://klymo-frontend.vercel.app/onboarding/payment-method",
    );
    expect(cta.textContent ?? "").toMatch(/Add payment method/i);
  });

  it("subtitle does not mention 'policy' (regression: live 2026-05-19)", () => {
    // The old subtitle said '{company} is all set on the policy side'
    // / 'Harold est paré côté politique' which doesn't apply to
    // personal users (no policy). Simplified to a single neutral
    // sentence in both flows.
    render(<OnboardingCard onboarding={_onboarding()} />);
    const subtitle = screen.getByTestId("onboarding-subtitle").textContent ?? "";
    expect(subtitle).not.toMatch(/policy/i);
    expect(subtitle).not.toMatch(/politique/i);
  });

  it("renders FR labels when language='fr'", () => {
    render(<OnboardingCard onboarding={_onboarding()} language="fr" />);
    expect(
      screen.getByRole("heading", { name: /enregistrer une carte/i }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("onboarding-cta").textContent ?? "").toMatch(
      /Ajouter un moyen de paiement/i,
    );
    const subtitle = screen.getByTestId("onboarding-subtitle").textContent ?? "";
    // No reference to 'côté politique' (the live-bug wording).
    expect(subtitle).not.toMatch(/politique/i);
    expect(subtitle).toMatch(/moyen de paiement/i);
  });

  it("opens the CTA link in a new tab with safe rel attributes", () => {
    render(<OnboardingCard onboarding={_onboarding()} />);
    const cta = screen.getByTestId("onboarding-cta");
    expect(cta).toHaveAttribute("target", "_blank");
    expect(cta).toHaveAttribute("rel", expect.stringContaining("noopener"));
    expect(cta).toHaveAttribute("rel", expect.stringContaining("noreferrer"));
  });

  it("renders the security / round-trip note", () => {
    render(<OnboardingCard onboarding={_onboarding()} />);
    const note = screen.getByTestId("onboarding-note").textContent ?? "";
    expect(note).toMatch(/Stripe/i);
    expect(note).toMatch(/back/i);
  });
});

describe("OnboardingCard — saved state (after Realtime morph)", () => {
  it("renders saved title + saved subtitle when completed=true", () => {
    render(<OnboardingCard onboarding={_onboarding({ completed: true })} />);
    expect(
      screen.getByRole("heading", { name: /payment method saved/i }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("onboarding-subtitle").textContent ?? "").toMatch(
      /all set/i,
    );
  });

  it("does NOT render the CTA button in saved state", () => {
    // The card stays in chat history but loses its actionable
    // affordance — the conversation has moved past this step.
    render(<OnboardingCard onboarding={_onboarding({ completed: true })} />);
    expect(screen.queryByTestId("onboarding-cta")).toBeNull();
  });

  it("does NOT render the security note in saved state", () => {
    // The "card details go through Stripe iframe" copy is meaningful
    // only when the user is ABOUT TO enter card details. After save,
    // it's irrelevant noise.
    render(<OnboardingCard onboarding={_onboarding({ completed: true })} />);
    expect(screen.queryByTestId("onboarding-note")).toBeNull();
  });

  it("uses the `data-completed` attribute so morphing can be asserted by callers", () => {
    render(<OnboardingCard onboarding={_onboarding({ completed: true })} />);
    expect(screen.getByTestId("onboarding-card")).toHaveAttribute(
      "data-completed",
      "true",
    );
  });

  it("renders FR saved labels when language='fr'", () => {
    render(
      <OnboardingCard
        onboarding={_onboarding({ completed: true })}
        language="fr"
      />,
    );
    expect(
      screen.getByRole("heading", { name: /moyen de paiement enregistré/i }),
    ).toBeInTheDocument();
  });
});
