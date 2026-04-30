/**
 * StripeCardSetup wiring test.
 *
 * Mocks @stripe/react-stripe-js so the test stays in-process and doesn't
 * actually load Stripe.js. The value here is narrow: verify that the
 * component routes the user's submit through `confirmCardSetup` with the
 * right `clientSecret` and calls `onSuccess` only on a clean Stripe
 * response. The "real" iframe behavior (3DS, network, decline UX) is
 * Stripe's surface — covered by Playwright in Stripe test mode, not here.
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const confirmCardSetup = vi.fn();
const cardElement = { type: "card-element-stub" };

vi.mock("@stripe/react-stripe-js", () => {
  return {
    Elements: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    CardElement: () => <div data-testid="card-element" />,
    useStripe: () => ({ confirmCardSetup }),
    useElements: () => ({ getElement: () => cardElement }),
  };
});

import { StripeCardSetup } from "./StripeCardSetup";

beforeEach(() => {
  confirmCardSetup.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("StripeCardSetup", () => {
  it("calls confirmCardSetup with the client_secret on submit and fires onSuccess on success", async () => {
    confirmCardSetup.mockResolvedValueOnce({ setupIntent: { id: "seti_1" } });
    const onSuccess = vi.fn();

    render(
      <StripeCardSetup
        clientSecret="seti_1_secret_xxx"
        publishableKey="pk_test_xxx"
        onSuccess={onSuccess}
        stripePromise={null}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /save card/i }));

    await waitFor(() => {
      expect(confirmCardSetup).toHaveBeenCalledWith(
        "seti_1_secret_xxx",
        expect.objectContaining({
          payment_method: { card: cardElement },
        }),
      );
    });
    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
  });

  it("surfaces the Stripe error message verbatim and does not call onSuccess", async () => {
    confirmCardSetup.mockResolvedValueOnce({
      error: { message: "Your card was declined." },
    });
    const onSuccess = vi.fn();

    render(
      <StripeCardSetup
        clientSecret="seti_1_secret_xxx"
        publishableKey="pk_test_xxx"
        onSuccess={onSuccess}
        stripePromise={null}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /save card/i }));

    expect(
      await screen.findByText("Your card was declined."),
    ).toBeInTheDocument();
    expect(onSuccess).not.toHaveBeenCalled();
  });
});
