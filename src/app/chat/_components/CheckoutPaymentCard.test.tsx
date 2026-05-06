import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { CheckoutLinkDetails } from "@/hooks/useChatStream";

import { CheckoutPaymentCard } from "./CheckoutPaymentCard";

function _checkoutLink(
  overrides: Partial<CheckoutLinkDetails> = {},
): CheckoutLinkDetails {
  return {
    trip_id: "tr-mode2-1",
    checkout_url: "https://checkout.stripe.com/c/pay/cs_test_xyz",
    amount_cents: 51_900,
    currency: "EUR",
    ...overrides,
  };
}

describe("CheckoutPaymentCard", () => {
  it("renders amount + currency + Pay now link with target=_blank", () => {
    render(<CheckoutPaymentCard checkoutLink={_checkoutLink()} />);

    const amountText = screen.getByTestId("checkout-amount").textContent ?? "";
    expect(amountText).toMatch(/519/);
    expect(amountText.toUpperCase()).toMatch(/EUR|€/);

    const link = screen.getByTestId("checkout-pay-link");
    expect(link).toHaveAttribute(
      "href",
      "https://checkout.stripe.com/c/pay/cs_test_xyz",
    );
    expect(link).toHaveAttribute("target", "_blank");
    // Defensive — opener could be used for tab-nabbing without rel.
    expect(link.getAttribute("rel") ?? "").toMatch(/noopener/);
    expect(link.getAttribute("rel") ?? "").toMatch(/noreferrer/);
  });

  it("renders FR labels when language='fr'", () => {
    render(
      <CheckoutPaymentCard checkoutLink={_checkoutLink()} language="fr" />,
    );
    // FR title — "Finalisez votre réservation".
    expect(screen.getByText(/Finalisez/i)).toBeInTheDocument();
    // FR Pay-now label.
    expect(screen.getByTestId("checkout-pay-link").textContent ?? "").toMatch(
      /Payer/i,
    );
  });

  it("renders EN labels by default", () => {
    render(<CheckoutPaymentCard checkoutLink={_checkoutLink()} />);
    expect(screen.getByText(/Complete your booking/i)).toBeInTheDocument();
    expect(screen.getByTestId("checkout-pay-link").textContent ?? "").toMatch(
      /Pay now/i,
    );
  });

  it("renders paid-state UI when checkoutLink.paid=true", () => {
    render(<CheckoutPaymentCard checkoutLink={_checkoutLink({ paid: true })} />);

    // The Pay-now button is gone — the user already paid.
    expect(screen.queryByTestId("checkout-pay-link")).toBeNull();

    // Paid title + status badge are visible.
    expect(screen.getByText(/Payment received/i)).toBeInTheDocument();
    expect(screen.getByTestId("checkout-paid-status").textContent ?? "").toMatch(
      /paid/i,
    );

    // Card carries the data-paid="true" hook (CSS / E2E selectors rely
    // on it to distinguish from the pending state).
    expect(screen.getByTestId("checkout-payment-card")).toHaveAttribute(
      "data-paid",
      "true",
    );

    // Amount still rendered (user wants the receipt at a glance).
    const amountText = screen.getByTestId("checkout-amount").textContent ?? "";
    expect(amountText).toMatch(/519/);
  });

  it("renders FR paid-state copy when language='fr' and paid=true", () => {
    render(
      <CheckoutPaymentCard
        checkoutLink={_checkoutLink({ paid: true })}
        language="fr"
      />,
    );
    expect(screen.getByText(/Paiement reçu/i)).toBeInTheDocument();
    expect(screen.getByTestId("checkout-paid-status").textContent ?? "").toMatch(
      /payé/i,
    );
  });

  it("preserves the checkout_url verbatim (no double-encoding of query params)", () => {
    // Stripe Checkout URLs carry signed session params — the href must
    // match byte-for-byte, otherwise the session lookup fails.
    const url =
      "https://checkout.stripe.com/c/pay/cs_test_a1b2?prefilled_email=foo%40bar.com&extra=%7B%22x%22%3A1%7D";
    render(
      <CheckoutPaymentCard
        checkoutLink={_checkoutLink({ checkout_url: url })}
      />,
    );
    const link = screen.getByTestId("checkout-pay-link");
    expect(link).toHaveAttribute("href", url);
  });
});
