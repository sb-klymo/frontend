import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { OrgRulesSection } from "./OrgRulesSection";

type PolicyRules = { max_amount_per_trip_eur?: number | null };

function mockFetchSequence(...responses: ({ status?: number; body: unknown })[]) {
  let i = 0;
  // Typed as `typeof fetch` so `fetchSpy.mock.calls[k]` is a
  // `[RequestInfo | URL, RequestInit | undefined]` tuple, not `[]`.
  // Without this `spy.mock.calls[0]![0]` reads as type `never`.
  const fetchSpy = vi.fn<typeof fetch>(async () => {
    const r = responses[i++] ?? responses[responses.length - 1]!;
    const status = r.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => r.body,
      text: async () => JSON.stringify(r.body),
    } as Response;
  });
  globalThis.fetch = fetchSpy;
  return fetchSpy;
}

function renderWithClient(ui: ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

function defaultProps() {
  return {
    language: "en" as const,
    open: true,
    onToggle: vi.fn(),
  };
}

describe("OrgRulesSection", () => {
  afterEach(() => {
    // @ts-expect-error — restore global; jsdom recreates it next test.
    delete globalThis.fetch;
  });

  // -------------------------------------------------------------------------
  // Fetch + render
  // -------------------------------------------------------------------------

  it("fetches on open and pre-fills the input with the current cap", async () => {
    const spy = mockFetchSequence({
      body: { max_amount_per_trip_eur: 500 } satisfies PolicyRules,
    });

    renderWithClient(<OrgRulesSection {...defaultProps()} />);

    const input = await waitFor(() =>
      screen.getByTestId<HTMLInputElement>("dev-org-rules-cap-input"),
    );
    await waitFor(() => expect(input.value).toBe("500"));
    // BFF proxy is the URL — not the upstream backend directly.
    expect(spy.mock.calls[0]![0]).toBe("/api/dev/org/policy-rules");
    expect(spy.mock.calls[0]![1]?.method).toBe("GET");
  });

  it("renders empty input when policy_rules has no cap configured", async () => {
    mockFetchSequence({ body: { max_amount_per_trip_eur: null } });

    renderWithClient(<OrgRulesSection {...defaultProps()} />);

    const input = await waitFor(() =>
      screen.getByTestId<HTMLInputElement>("dev-org-rules-cap-input"),
    );
    expect(input.value).toBe("");
  });

  it("shows Active badge when a cap is configured, hides it when null", async () => {
    mockFetchSequence({ body: { max_amount_per_trip_eur: 500 } });
    const { unmount } = renderWithClient(<OrgRulesSection {...defaultProps()} />);
    await waitFor(() =>
      expect(screen.getByTestId("dev-org-rules-active-badge")).toBeInTheDocument(),
    );
    unmount();

    mockFetchSequence({ body: { max_amount_per_trip_eur: null } });
    renderWithClient(<OrgRulesSection {...defaultProps()} />);
    await waitFor(() => {
      // Wait until query resolved by checking the input is rendered.
      screen.getByTestId("dev-org-rules-cap-input");
    });
    expect(screen.queryByTestId("dev-org-rules-active-badge")).toBeNull();
  });

  it("does not fetch when closed", () => {
    const spy = mockFetchSequence({ body: { max_amount_per_trip_eur: 500 } });
    renderWithClient(<OrgRulesSection {...defaultProps()} open={false} />);
    expect(spy).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Save (PATCH)
  // -------------------------------------------------------------------------

  it("saves a typed value: PATCH with the new cap and reflects the server-returned value", async () => {
    const spy = mockFetchSequence(
      { body: { max_amount_per_trip_eur: 500 } }, // initial GET
      { body: { max_amount_per_trip_eur: 1000 } }, // PATCH response
    );

    renderWithClient(<OrgRulesSection {...defaultProps()} />);
    const input = await waitFor(() =>
      screen.getByTestId<HTMLInputElement>("dev-org-rules-cap-input"),
    );
    await waitFor(() => expect(input.value).toBe("500"));

    fireEvent.change(input, { target: { value: "1000" } });
    fireEvent.click(screen.getByTestId("dev-org-rules-save"));

    await waitFor(() => expect(spy).toHaveBeenCalledTimes(2));

    // PATCH was correctly shaped.
    const patchCall = spy.mock.calls[1]!;
    expect(patchCall[0]).toBe("/api/dev/org/policy-rules");
    expect(patchCall[1]?.method).toBe("PATCH");
    const sentBody = JSON.parse((patchCall[1]?.body as string) ?? "{}");
    expect(sentBody).toEqual({ max_amount_per_trip_eur: 1000 });

    // UI re-flows from server-returned canonical value.
    await waitFor(() => expect(input.value).toBe("1000"));
  });

  it("treats empty input as null cap (clear the rule)", async () => {
    const spy = mockFetchSequence(
      { body: { max_amount_per_trip_eur: 500 } },
      { body: { max_amount_per_trip_eur: null } },
    );

    renderWithClient(<OrgRulesSection {...defaultProps()} />);
    const input = await waitFor(() =>
      screen.getByTestId<HTMLInputElement>("dev-org-rules-cap-input"),
    );
    await waitFor(() => expect(input.value).toBe("500"));

    fireEvent.change(input, { target: { value: "" } });
    fireEvent.click(screen.getByTestId("dev-org-rules-save"));

    await waitFor(() => expect(spy).toHaveBeenCalledTimes(2));
    const sentBody = JSON.parse((spy.mock.calls[1]![1]?.body as string) ?? "{}");
    expect(sentBody).toEqual({ max_amount_per_trip_eur: null });
  });

  // -------------------------------------------------------------------------
  // Quick-set
  // -------------------------------------------------------------------------

  it("quick-set 500 triggers PATCH with 500 and updates input", async () => {
    const spy = mockFetchSequence(
      { body: { max_amount_per_trip_eur: null } },
      { body: { max_amount_per_trip_eur: 500 } },
    );

    renderWithClient(<OrgRulesSection {...defaultProps()} />);
    await waitFor(() =>
      expect(screen.getByTestId("dev-org-rules-cap-input")).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByTestId("dev-org-rules-quick-500"));

    await waitFor(() => expect(spy).toHaveBeenCalledTimes(2));
    const sentBody = JSON.parse((spy.mock.calls[1]![1]?.body as string) ?? "{}");
    expect(sentBody).toEqual({ max_amount_per_trip_eur: 500 });

    // Input re-flows from server response.
    const input = screen.getByTestId<HTMLInputElement>("dev-org-rules-cap-input");
    await waitFor(() => expect(input.value).toBe("500"));
  });

  it("quick-set 'none' clears the cap to null", async () => {
    const spy = mockFetchSequence(
      { body: { max_amount_per_trip_eur: 500 } },
      { body: { max_amount_per_trip_eur: null } },
    );

    renderWithClient(<OrgRulesSection {...defaultProps()} />);
    await waitFor(() =>
      expect(screen.getByTestId("dev-org-rules-cap-input")).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByTestId("dev-org-rules-quick-none"));

    await waitFor(() => expect(spy).toHaveBeenCalledTimes(2));
    const sentBody = JSON.parse((spy.mock.calls[1]![1]?.body as string) ?? "{}");
    expect(sentBody).toEqual({ max_amount_per_trip_eur: null });
  });

  // -------------------------------------------------------------------------
  // Error states
  // -------------------------------------------------------------------------

  it("renders 'not onboarded' hint on 404", async () => {
    mockFetchSequence({ status: 404, body: { code: "not_found", message: "x" } });

    renderWithClient(<OrgRulesSection {...defaultProps()} />);

    await waitFor(() =>
      expect(screen.getByTestId("dev-org-rules-not-onboarded")).toBeInTheDocument(),
    );
    // Distinct from the generic load-error path.
    expect(screen.queryByTestId("dev-org-rules-load-error")).toBeNull();
  });

  it("renders a generic error on 500", async () => {
    mockFetchSequence({ status: 500, body: { code: "internal", message: "x" } });

    renderWithClient(<OrgRulesSection {...defaultProps()} />);

    await waitFor(() =>
      expect(screen.getByTestId("dev-org-rules-load-error")).toBeInTheDocument(),
    );
  });

  it("renders a save error when PATCH returns non-2xx", async () => {
    mockFetchSequence(
      { body: { max_amount_per_trip_eur: 500 } },
      // Server-side rejection — could be a backend crash, RLS issue,
      // etc. The client value (1000) passes the client-side guard
      // (positive integer); the 500 comes from upstream.
      { status: 500, body: { code: "internal", message: "boom" } },
    );

    renderWithClient(<OrgRulesSection {...defaultProps()} />);
    const input = await waitFor(() =>
      screen.getByTestId<HTMLInputElement>("dev-org-rules-cap-input"),
    );
    await waitFor(() => expect(input.value).toBe("500"));

    fireEvent.change(input, { target: { value: "1000" } });
    fireEvent.click(screen.getByTestId("dev-org-rules-save"));

    await waitFor(() =>
      expect(screen.getByTestId("dev-org-rules-save-error")).toBeInTheDocument(),
    );
  });

  // -------------------------------------------------------------------------
  // Spawn-employee stub (PR-5b backend follow-up)
  // -------------------------------------------------------------------------

  it("renders the spawn-employee button as disabled with 'Coming soon'", async () => {
    mockFetchSequence({ body: { max_amount_per_trip_eur: 500 } });

    renderWithClient(<OrgRulesSection {...defaultProps()} />);

    const btn = await waitFor(() =>
      screen.getByTestId("dev-org-rules-spawn-employee"),
    );
    expect(btn).toBeDisabled();
    expect(btn.textContent ?? "").toMatch(/Coming soon/i);
  });

  // -------------------------------------------------------------------------
  // i18n
  // -------------------------------------------------------------------------

  it("renders FR labels when language='fr'", async () => {
    mockFetchSequence({ body: { max_amount_per_trip_eur: 500 } });

    renderWithClient(<OrgRulesSection {...defaultProps()} language="fr" />);

    // Header renders immediately (before query resolves), so the
    // FR heading assertion passes early. We then need to wait for
    // the query to resolve before the editor row (with the save
    // button) mounts — gating on the input ensures that.
    await waitFor(() =>
      expect(screen.getByText(/Règles d'organisation/i)).toBeInTheDocument(),
    );
    await waitFor(() =>
      expect(screen.getByTestId("dev-org-rules-cap-input")).toBeInTheDocument(),
    );
    expect(screen.getByTestId("dev-org-rules-save").textContent).toMatch(
      /Enregistrer/i,
    );
  });

  it("toggling open is wired to onToggle prop", async () => {
    const onToggle = vi.fn();
    mockFetchSequence({ body: { max_amount_per_trip_eur: 500 } });

    renderWithClient(
      <OrgRulesSection {...defaultProps()} onToggle={onToggle} />,
    );

    // The collapsible header is a button — clicking fires onToggle.
    const header = screen.getByRole("button", { name: /Org rules/i });
    await act(async () => {
      fireEvent.click(header);
    });
    expect(onToggle).toHaveBeenCalled();
  });
});
