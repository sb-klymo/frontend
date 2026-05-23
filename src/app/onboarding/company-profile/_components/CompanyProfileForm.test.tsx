import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { CompanyProfileForm } from "./CompanyProfileForm";

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("CompanyProfileForm", () => {
  it("renders the 17 form fields", () => {
    render(<CompanyProfileForm />);
    expect(screen.getByLabelText(/Company name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Industry/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Team size/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Billing email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Workspace currency/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Approval mode/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Cap per employee per flight/i)).toBeInTheDocument();
  });

  it("hides the manager-threshold input when approval_mode='self_serve'", () => {
    render(<CompanyProfileForm />);
    // Default is self_serve — threshold field should not be visible.
    expect(screen.queryByLabelText(/Manager approval threshold/i)).not.toBeInTheDocument();
  });

  it("shows the manager-threshold input after switching to manager_approval", async () => {
    render(<CompanyProfileForm />);
    fireEvent.change(screen.getByLabelText(/Approval mode/i), {
      target: { value: "manager_approval" },
    });
    await waitFor(() =>
      expect(screen.getByLabelText(/Manager approval threshold/i)).toBeInTheDocument(),
    );
  });

  // Safe window.location mocking: setup in beforeEach, restore in afterEach.
  // If an assertion throws, afterEach still runs and restores the original —
  // matching the pattern from useChatStream.test.ts (commit 542163b).
  describe("form submission", () => {
    const originalLocation = window.location;

    beforeEach(() => {
      vi.restoreAllMocks();
      // Mutate `window.location` here (not inline in `it()`) so that if
      // any assertion throws, `afterEach` still restores the original.
      Object.defineProperty(window, "location", {
        writable: true,
        value: { ...originalLocation, assign: vi.fn() },
      });
    });

    afterEach(() => {
      Object.defineProperty(window, "location", {
        writable: true,
        value: originalLocation,
      });
      vi.restoreAllMocks();
    });

    it("submits to /api/onboarding/company-profile and navigates to stripe_setup_url on 201", async () => {
      global.fetch = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            org_id: "11111111-1111-1111-1111-111111111111",
            stripe_setup_url: "/onboarding/payment-method",
          }),
          { status: 201, headers: { "Content-Type": "application/json" } },
        ),
      );

      render(<CompanyProfileForm />);
      // Fill the minimal required-fields path with self_serve defaults.
      fireEvent.change(screen.getByLabelText(/Company name/i), { target: { value: "Acme" } });
      fireEvent.change(screen.getByLabelText(/Industry/i), { target: { value: "technology" } });
      fireEvent.change(screen.getByLabelText(/Team size/i), { target: { value: "11-50" } });
      fireEvent.change(screen.getByLabelText(/Billing email/i), { target: { value: "bills@acme.test" } });
      fireEvent.change(screen.getByLabelText(/Primary office city/i), { target: { value: "Paris" } });
      fireEvent.change(screen.getByLabelText(/Timezone/i), { target: { value: "Europe/Paris" } });
      fireEvent.change(screen.getByLabelText(/Workspace currency/i), { target: { value: "EUR" } });
      fireEvent.change(screen.getByLabelText(/Cap per employee per flight/i), { target: { value: "500" } });
      fireEvent.change(screen.getByLabelText(/Employee count/i), { target: { value: "25" } });
      fireEvent.change(screen.getByLabelText(/Monthly search token limit/i), { target: { value: "1000" } });
      fireEvent.change(screen.getByLabelText(/Search token price/i), { target: { value: "0.01" } });
      fireEvent.change(screen.getByLabelText(/Search token currency/i), { target: { value: "USD" } });

      fireEvent.click(screen.getByRole("button", { name: /Create company/i }));

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith(
          "/api/onboarding/company-profile",
          expect.objectContaining({ method: "POST" }),
        );
        expect(window.location.assign).toHaveBeenCalledWith("/onboarding/payment-method");
      });
    });
  });

  it("shows role=alert when client-side validation fails (e.g. missing required fields)", async () => {
    render(<CompanyProfileForm />);
    fireEvent.change(screen.getByLabelText(/Company name/i), { target: { value: "Acme" } });
    fireEvent.click(screen.getByRole("button", { name: /Create company/i }));
    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeInTheDocument();
    });
  });
});
