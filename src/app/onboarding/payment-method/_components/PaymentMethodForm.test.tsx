import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";

import { PaymentMethodForm } from "./PaymentMethodForm";

// Stub the SetupIntent fetch + the preference call.
const setPaymentPreference = vi
  .fn()
  .mockResolvedValue({ payment_mode: "auto_charge" });
vi.mock("@/lib/api/payment", () => ({
  createSetupIntent: vi.fn().mockResolvedValue({
    client_secret: "seti_secret",
    publishable_key: "pk_test_x",
    setup_intent_id: "seti_stub_1",
  }),
  setPaymentPreference: (...a: unknown[]) => setPaymentPreference(...a),
  PaymentApiError: class extends Error {},
}));

// Stub the Stripe card component: expose a button that fires onSuccess.
vi.mock("@/components/features/StripeCardSetup", () => ({
  StripeCardSetup: ({ onSuccess }: { onSuccess: () => void }) => (
    <button onClick={() => onSuccess()}>mock-save-card</button>
  ),
}));

function renderForm(initialAutoCharge: boolean) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <PaymentMethodForm initialAutoCharge={initialAutoCharge} language="en" />
    </QueryClientProvider>,
  );
}

afterEach(() => setPaymentPreference.mockClear());

it("persists the auto-charge choice via the endpoint on card-save success", async () => {
  renderForm(true);
  const saveBtn = await screen.findByText("mock-save-card");
  fireEvent.click(saveBtn);
  await waitFor(() => expect(setPaymentPreference).toHaveBeenCalledWith(true));
});
