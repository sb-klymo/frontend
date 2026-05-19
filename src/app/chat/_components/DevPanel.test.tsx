import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { DevPanel } from "./DevPanel";

/**
 * DevPanel renders IssuingCardsSection which uses TanStack Query.
 * In production the QueryClient comes from `<Providers>` in app/layout;
 * tests need their own. Retry disabled so error paths don't burn the
 * test budget.
 */
function renderWithClient(ui: ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>{ui}</QueryClientProvider>,
  );
}

// DevPanel hosts two TanStack-Query-backed sections that auto-fetch when
// open: `IssuingCardsSection` (/api/dev/cards) and `PaymentStatusSection`
// (/api/me). None of the existing DevPanel tests assert on either's
// rendered data — they just need both calls to resolve so React Query
// doesn't sit in a loading state that interferes with other queries.
// The shared mock dispatches per-URL so each section gets its own
// well-shaped empty response.
let originalFetch: typeof fetch;
beforeAll(() => {
  originalFetch = globalThis.fetch;
  globalThis.fetch = vi.fn((input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("/api/me")) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            id: "00000000-0000-0000-0000-000000000000",
            email: "test@klymo.local",
            payment_mode: "checkout_fallback",
            stripe_payment_method_id: null,
          }),
      } as Response);
    }
    return Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ cards: [] }),
    } as Response);
  }) as unknown as typeof fetch;
});
afterAll(() => {
  globalThis.fetch = originalFetch;
});

function defaultProps() {
  return {
    send: vi.fn(),
    reset: vi.fn(),
    isStreaming: false,
    language: "fr" as const,
    workflowStage: "pending_info",
    conversationId: "conv-abc-12345",
    messageCount: 4,
    error: null as string | null,
    policyPreset: "none" as const,
    onPolicyPresetChange: vi.fn(),
    voicePreset: "default" as const,
    onVoicePresetChange: vi.fn(),
  };
}

describe("DevPanel", () => {
  it("renders all category headings", () => {
    renderWithClient(<DevPanel {...defaultProps()} />);
    // FR labels by default. Query at the heading level so we don't
    // collide with prompt-button titles that contain the same words
    // (e.g. "aller-retour Paris ↔ NYC…").
    const headings = screen
      .getAllByRole("heading", { level: 3 })
      .map((h) => h.textContent);
    expect(headings).toContain("Aéroport unique");
    expect(headings).toContain("Aéroports multiples");
    expect(headings).toContain("Aller-retour");
  });

  it("clicking a French prompt button calls send with the FR text", () => {
    const props = defaultProps();
    renderWithClient(<DevPanel {...props} />);
    const button = screen.getByRole("button", {
      name: /j'habite à Marseille et je veux aller à Toulouse demain/i,
    });
    fireEvent.click(button);
    expect(props.send).toHaveBeenCalledWith(
      "j'habite à Marseille et je veux aller à Toulouse demain",
    );
  });

  it("toggling to EN swaps the prompts and category labels", () => {
    renderWithClient(<DevPanel {...defaultProps()} />);

    fireEvent.click(screen.getByRole("radio", { name: /en/i }));

    expect(screen.getByText(/Single-airport/i)).toBeInTheDocument();
    expect(screen.queryByText(/Aéroport unique/i)).toBeNull();
    expect(
      screen.getByRole("button", { name: /flight Nice to Bordeaux/i }),
    ).toBeInTheDocument();
  });

  it("does not call send while streaming (button disabled)", () => {
    const props = { ...defaultProps(), isStreaming: true };
    renderWithClient(<DevPanel {...props} />);
    const button = screen.getByRole("button", {
      name: /j'habite à Marseille/i,
    });
    expect(button).toBeDisabled();
  });

  it("Reset button calls reset()", () => {
    const props = defaultProps();
    renderWithClient(<DevPanel {...props} />);
    fireEvent.click(screen.getByRole("button", { name: /Reset chat/i }));
    expect(props.reset).toHaveBeenCalledOnce();
  });

  it("Random button calls send with one of the prompts in the active language", () => {
    const props = defaultProps();
    renderWithClient(<DevPanel {...props} />);
    fireEvent.click(screen.getByRole("button", { name: /Random/i }));
    expect(props.send).toHaveBeenCalledOnce();
    const text = props.send.mock.calls[0]![0]! as string;
    expect(typeof text).toBe("string");
    expect(text.length).toBeGreaterThan(0);
  });

  it("State inspector shows stage / lang / msgs and a shortened conv_id", () => {
    renderWithClient(<DevPanel {...defaultProps()} />);
    // The inspector defaults to open. Use testIds to avoid colliding with
    // the FR/EN toggle which also renders "fr" / "en" labels.
    expect(screen.getByTestId("state-stage").textContent).toBe("pending_info");
    expect(screen.getByTestId("state-lang").textContent).toBe("fr");
    expect(screen.getByTestId("state-msgs").textContent).toBe("4");
    // conv-abc-12345 is shortened (length > 12 → first 8 + last 4)
    expect(screen.getByTestId("state-conv-id").textContent).toMatch(/conv-abc/);
  });

  it("State inspector surfaces last error when present", () => {
    renderWithClient(<DevPanel {...defaultProps()} error="Chat stream failed: 500" />);
    expect(screen.getByTestId("state-error").textContent).toBe(
      "Chat stream failed: 500",
    );
  });
});

// ---------------------------------------------------------------------------
// Clipboard integration test (separate describe block — needs jsdom mock)
// ---------------------------------------------------------------------------

describe("DevPanel — copy state", () => {
  let writeText: ReturnType<typeof vi.fn>;
  let originalClipboard: typeof navigator.clipboard | undefined;

  beforeEach(() => {
    writeText = vi.fn().mockResolvedValue(undefined);
    // Stash the original (jsdom may or may not provide one) before stubbing.
    originalClipboard = navigator.clipboard;
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
      writable: true,
    });
  });

  afterEach(() => {
    if (originalClipboard !== undefined) {
      Object.defineProperty(navigator, "clipboard", {
        value: originalClipboard,
        configurable: true,
        writable: true,
      });
    }
  });

  it("Copy state writes a JSON snapshot to the clipboard", async () => {
    renderWithClient(<DevPanel {...defaultProps()} />);
    fireEvent.click(
      screen.getByRole("button", { name: /Copy state for bug report/i }),
    );

    // Allow the async clipboard call to settle.
    await Promise.resolve();

    expect(writeText).toHaveBeenCalledOnce();
    const written = writeText.mock.calls[0]![0]! as string;
    const parsed = JSON.parse(written);
    expect(parsed.conversation_id).toBe("conv-abc-12345");
    expect(parsed.workflow_stage).toBe("pending_info");
    expect(parsed.detected_language).toBe("fr");
    expect(parsed.messages).toBe(4);
  });
});

describe("DevPanel — payment shortcut", () => {
  it("renders the payment section with a link to the onboarding page", () => {
    renderWithClient(<DevPanel {...defaultProps()} />);
    const section = screen.getByTestId("dev-payment-section");
    expect(section).toBeInTheDocument();
    const link = screen.getByTestId("dev-payment-setup-link");
    expect(link).toHaveAttribute("href", "/onboarding/payment-method");
  });

  it("uses the FR label when prompt language is French (default)", () => {
    renderWithClient(<DevPanel {...defaultProps()} />);
    expect(screen.getByText(/Enregistrer une carte/i)).toBeInTheDocument();
  });

  it("switches to the EN label when the user toggles to English", () => {
    renderWithClient(<DevPanel {...defaultProps()} />);
    fireEvent.click(screen.getByRole("radio", { name: /en/i }));
    expect(screen.getByText(/Save \/ replace card/i)).toBeInTheDocument();
    expect(screen.queryByText(/Enregistrer une carte/i)).toBeNull();
  });
});

describe("DevPanel — policy presets", () => {
  it("renders the policy section with all preset buttons", () => {
    renderWithClient(<DevPanel {...defaultProps()} />);
    const section = screen.getByTestId("dev-policy-section");
    expect(section).toBeInTheDocument();
    // Pin the five preset ids — adding/removing one should be a
    // deliberate test edit.
    for (const id of [
      "none",
      "mixed_verdict",
      "block_expensive",
      "manager_only",
      "train_preferred",
    ]) {
      expect(screen.getByTestId(`dev-policy-preset-${id}`)).toBeInTheDocument();
    }
  });

  it("does not show the Active badge when preset is 'none'", () => {
    renderWithClient(<DevPanel {...defaultProps()} />);
    expect(
      screen.queryByTestId("dev-policy-active-badge"),
    ).not.toBeInTheDocument();
  });

  it("shows the Active badge when a non-default preset is selected", () => {
    renderWithClient(
      <DevPanel {...defaultProps()} policyPreset="block_expensive" />,
    );
    expect(
      screen.getByTestId("dev-policy-active-badge"),
    ).toBeInTheDocument();
  });

  it("clicking a preset calls onPolicyPresetChange with the id", () => {
    const props = defaultProps();
    renderWithClient(<DevPanel {...props} />);
    fireEvent.click(screen.getByTestId("dev-policy-preset-mixed_verdict"));
    expect(props.onPolicyPresetChange).toHaveBeenCalledWith("mixed_verdict");
  });

  it("the active preset has data-active=true; others false", () => {
    renderWithClient(
      <DevPanel {...defaultProps()} policyPreset="manager_only" />,
    );
    expect(
      screen.getByTestId("dev-policy-preset-manager_only"),
    ).toHaveAttribute("data-active", "true");
    expect(screen.getByTestId("dev-policy-preset-none")).toHaveAttribute(
      "data-active",
      "false",
    );
  });
});

describe("DevPanel — voice presets", () => {
  it("renders the voice section with both preset buttons", () => {
    renderWithClient(<DevPanel {...defaultProps()} />);
    const section = screen.getByTestId("dev-voice-section");
    expect(section).toBeInTheDocument();
    for (const id of ["default", "classic"]) {
      expect(screen.getByTestId(`dev-voice-preset-${id}`)).toBeInTheDocument();
    }
  });

  it("does not show the Active badge when preset is 'default'", () => {
    renderWithClient(<DevPanel {...defaultProps()} />);
    expect(
      screen.queryByTestId("dev-voice-active-badge"),
    ).not.toBeInTheDocument();
  });

  it("shows the Active badge when 'classic' is selected", () => {
    renderWithClient(
      <DevPanel {...defaultProps()} voicePreset="classic" />,
    );
    expect(screen.getByTestId("dev-voice-active-badge")).toBeInTheDocument();
  });

  it("clicking a preset calls onVoicePresetChange with the id", () => {
    const props = defaultProps();
    renderWithClient(<DevPanel {...props} />);
    fireEvent.click(screen.getByTestId("dev-voice-preset-classic"));
    expect(props.onVoicePresetChange).toHaveBeenCalledWith("classic");
  });

  it("the active preset has data-active=true; the other false", () => {
    renderWithClient(
      <DevPanel {...defaultProps()} voicePreset="classic" />,
    );
    expect(screen.getByTestId("dev-voice-preset-classic")).toHaveAttribute(
      "data-active",
      "true",
    );
    expect(screen.getByTestId("dev-voice-preset-default")).toHaveAttribute(
      "data-active",
      "false",
    );
  });
});

// ---------------------------------------------------------------------------
// Collapsible sections + localStorage persistence
// ---------------------------------------------------------------------------

describe("DevPanel — collapsible sections", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    window.localStorage.clear();
  });

  it("clicking a section heading hides its body", () => {
    renderWithClient(<DevPanel {...defaultProps()} />);
    // The "Aller-retour" body has buttons titled with prompt text.
    const promptBefore = screen.queryByRole("button", {
      name: /aller-retour Paris/i,
    });
    expect(promptBefore).toBeInTheDocument();

    // The heading is wrapped in a button (disclosure pattern).
    const heading = screen.getByRole("heading", { name: "Aller-retour" });
    fireEvent.click(heading.parentElement!);

    expect(
      screen.queryByRole("button", { name: /aller-retour Paris/i }),
    ).toBeNull();
  });

  it("aria-expanded reflects collapsed state on the heading button", () => {
    renderWithClient(<DevPanel {...defaultProps()} />);
    const heading = screen.getByRole("heading", { name: "Aller-retour" });
    const button = heading.parentElement!;
    expect(button).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(button);
    expect(button).toHaveAttribute("aria-expanded", "false");
  });

  it("collapsed state persists across remount via localStorage", () => {
    const { unmount } = renderWithClient(<DevPanel {...defaultProps()} />);
    const heading = screen.getByRole("heading", { name: "Aller-retour" });
    fireEvent.click(heading.parentElement!);
    unmount();

    // localStorage should now hold the collapse record. Remount and
    // check the section comes up collapsed.
    renderWithClient(<DevPanel {...defaultProps()} />);
    const button = screen.getByRole("heading", { name: "Aller-retour" })
      .parentElement!;
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(
      screen.queryByRole("button", { name: /aller-retour Paris/i }),
    ).toBeNull();
  });

  it("policy Active badge stays visible when the policy section is collapsed", () => {
    renderWithClient(<DevPanel {...defaultProps()} policyPreset="block_expensive" />);
    const heading = screen.getByRole("heading", { name: "Politique" });
    fireEvent.click(heading.parentElement!);
    // Body collapsed (preset buttons gone) but the badge stays.
    expect(
      screen.queryByTestId("dev-policy-preset-block_expensive"),
    ).toBeNull();
    expect(screen.getByTestId("dev-policy-active-badge")).toBeInTheDocument();
  });
});
