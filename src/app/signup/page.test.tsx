import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import SignupPage from "./page";

const signUpMock = vi.fn();
vi.mock("@/lib/supabase/browser", () => ({
  createSupabaseBrowserClient: () => ({
    auth: { signUp: signUpMock },
  }),
}));

const pushMock = vi.fn();
const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, refresh: refreshMock }),
}));

describe("SignupPage", () => {
  beforeEach(() => {
    signUpMock.mockReset();
    pushMock.mockReset();
    refreshMock.mockReset();
  });

  it("renders Company and Personal radio options", () => {
    render(<SignupPage />);
    expect(
      screen.getByRole("radio", { name: /company/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("radio", { name: /personal/i }),
    ).toBeInTheDocument();
  });

  it("defaults to Personal selected", () => {
    render(<SignupPage />);
    const personal = screen.getByRole("radio", { name: /personal/i });
    expect(personal).toBeChecked();
  });

  it("passes account_type='company' to supabase.auth.signUp when Company is selected", async () => {
    // After this push, /chat's Server Component (app/chat/page.tsx) reads
    // /me and redirects company-without-org users to /onboarding/company-profile.
    // This test only verifies the auth.signUp metadata + the immediate push;
    // the form-redirect handoff is covered by tests/e2e/pro-onboarding-form.spec.ts.
    signUpMock.mockResolvedValueOnce({ data: { session: {} }, error: null });
    render(<SignupPage />);

    fireEvent.click(screen.getByRole("radio", { name: /company/i }));
    fireEvent.change(screen.getByLabelText(/email/i), {
      target: { value: "admin@acme.test" },
    });
    fireEvent.change(screen.getByLabelText(/password/i), {
      target: { value: "supersecret" },
    });
    fireEvent.click(screen.getByRole("button", { name: /create account/i }));

    await waitFor(() => {
      expect(signUpMock).toHaveBeenCalledWith({
        email: "admin@acme.test",
        password: "supersecret",
        options: { data: { account_type: "company" } },
      });
    });
  });

  it("passes account_type='individual' when Personal is selected (default)", async () => {
    signUpMock.mockResolvedValueOnce({ data: { session: {} }, error: null });
    render(<SignupPage />);

    fireEvent.change(screen.getByLabelText(/email/i), {
      target: { value: "me@gmail.test" },
    });
    fireEvent.change(screen.getByLabelText(/password/i), {
      target: { value: "supersecret" },
    });
    fireEvent.click(screen.getByRole("button", { name: /create account/i }));

    await waitFor(() => {
      expect(signUpMock).toHaveBeenCalledWith({
        email: "me@gmail.test",
        password: "supersecret",
        options: { data: { account_type: "individual" } },
      });
    });
  });
});
