import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { PaymentConfirmationCard } from "./PaymentConfirmationCard";

const details = { trip_id: "t1", amount_cents: 34581, currency: "eur" };

describe("PaymentConfirmationCard", () => {
  it("shows the amount and fires onDecision('confirmed')", () => {
    const onDecision = vi.fn();
    render(<PaymentConfirmationCard paymentConfirmation={details} language="fr" onDecision={onDecision} />);
    expect(screen.getByText(/345[.,]81/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /vérifier & payer|pay/i }));
    expect(onDecision).toHaveBeenCalledWith("confirmed");
  });

  it("fires onDecision('canceled') on cancel", () => {
    const onDecision = vi.fn();
    render(<PaymentConfirmationCard paymentConfirmation={details} language="fr" onDecision={onDecision} />);
    fireEvent.click(screen.getByRole("button", { name: /annuler|cancel/i }));
    expect(onDecision).toHaveBeenCalledWith("canceled");
  });
});
