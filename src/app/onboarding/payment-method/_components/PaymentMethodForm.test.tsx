import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";

import { PaymentMethodForm } from "./PaymentMethodForm";

// Stub the SetupIntent fetch + the preference call.
const setPaymentPreference = vi
  .fn()
  .mockResolvedValue({ payment_mode: "auto_charge" });
const setOrgPaymentPolicy = vi.fn().mockResolvedValue({ auto_charge: true });
vi.mock("@/lib/api/payment", () => ({
  createSetupIntent: vi.fn().mockResolvedValue({
    client_secret: "seti_secret",
    publishable_key: "pk_test_x",
    setup_intent_id: "seti_stub_1",
  }),
  setPaymentPreference: (...a: unknown[]) => setPaymentPreference(...a),
  setOrgPaymentPolicy: (...a: unknown[]) => setOrgPaymentPolicy(...a),
  PaymentApiError: class extends Error {},
}));

// Stub the Stripe card component: expose a button that fires onSuccess.
vi.mock("@/components/features/StripeCardSetup", () => ({
  StripeCardSetup: ({ onSuccess }: { onSuccess: () => void }) => (
    <button onClick={() => onSuccess()}>mock-save-card</button>
  ),
}));

function renderForm(initialAutoCharge: boolean, scope?: "user" | "org") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <PaymentMethodForm initialAutoCharge={initialAutoCharge} language="en" scope={scope} />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  setPaymentPreference.mockClear();
  setOrgPaymentPolicy.mockClear();
});

it("persists the auto-charge choice via the endpoint on card-save success", async () => {
  renderForm(true);
  const saveBtn = await screen.findByText("mock-save-card");
  fireEvent.click(saveBtn);
  await waitFor(() => expect(setPaymentPreference).toHaveBeenCalledWith(true));
});

it("persists auto_charge=false (opt-out) when the toggle starts off", async () => {
  renderForm(false);
  const saveBtn = await screen.findByText("mock-save-card");
  fireEvent.click(saveBtn);
  await waitFor(() => expect(setPaymentPreference).toHaveBeenCalledWith(false));
});

it("org scope: persists via setOrgPaymentPolicy and shows success on resolve", async () => {
  setOrgPaymentPolicy.mockResolvedValueOnce({ auto_charge: true });
  renderForm(true, "org");
  const saveBtn = await screen.findByText("mock-save-card");
  fireEvent.click(saveBtn);
  await waitFor(() => expect(setOrgPaymentPolicy).toHaveBeenCalledWith(true));
  await waitFor(() =>
    expect(screen.getByTestId("card-setup-success")).toBeInTheDocument(),
  );
});

it("org scope: a persistence failure blocks success and shows an error", async () => {
  setOrgPaymentPolicy.mockRejectedValueOnce(new Error("network error"));
  renderForm(true, "org");
  const saveBtn = await screen.findByText("mock-save-card");
  fireEvent.click(saveBtn);
  await waitFor(() =>
    expect(screen.queryByTestId("card-setup-success")).not.toBeInTheDocument(),
  );
  await waitFor(() =>
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument(),
  );
});
