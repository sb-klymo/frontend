import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DevPanel } from "./DevPanel";

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
  };
}

describe("DevPanel", () => {
  it("renders all category headings", () => {
    render(<DevPanel {...defaultProps()} />);
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
    render(<DevPanel {...props} />);
    const button = screen.getByRole("button", {
      name: /j'habite à Marseille et je veux aller à Toulouse demain/i,
    });
    fireEvent.click(button);
    expect(props.send).toHaveBeenCalledWith(
      "j'habite à Marseille et je veux aller à Toulouse demain",
    );
  });

  it("toggling to EN swaps the prompts and category labels", () => {
    render(<DevPanel {...defaultProps()} />);

    fireEvent.click(screen.getByRole("radio", { name: /en/i }));

    expect(screen.getByText(/Single-airport/i)).toBeInTheDocument();
    expect(screen.queryByText(/Aéroport unique/i)).toBeNull();
    expect(
      screen.getByRole("button", { name: /flight Nice to Bordeaux/i }),
    ).toBeInTheDocument();
  });

  it("does not call send while streaming (button disabled)", () => {
    const props = { ...defaultProps(), isStreaming: true };
    render(<DevPanel {...props} />);
    const button = screen.getByRole("button", {
      name: /j'habite à Marseille/i,
    });
    expect(button).toBeDisabled();
  });

  it("Reset button calls reset()", () => {
    const props = defaultProps();
    render(<DevPanel {...props} />);
    fireEvent.click(screen.getByRole("button", { name: /Reset chat/i }));
    expect(props.reset).toHaveBeenCalledOnce();
  });

  it("Random button calls send with one of the prompts in the active language", () => {
    const props = defaultProps();
    render(<DevPanel {...props} />);
    fireEvent.click(screen.getByRole("button", { name: /Random/i }));
    expect(props.send).toHaveBeenCalledOnce();
    const text = props.send.mock.calls[0]![0]! as string;
    expect(typeof text).toBe("string");
    expect(text.length).toBeGreaterThan(0);
  });

  it("State inspector shows stage / lang / msgs and a shortened conv_id", () => {
    render(<DevPanel {...defaultProps()} />);
    // The inspector defaults to open. Use testIds to avoid colliding with
    // the FR/EN toggle which also renders "fr" / "en" labels.
    expect(screen.getByTestId("state-stage").textContent).toBe("pending_info");
    expect(screen.getByTestId("state-lang").textContent).toBe("fr");
    expect(screen.getByTestId("state-msgs").textContent).toBe("4");
    // conv-abc-12345 is shortened (length > 12 → first 8 + last 4)
    expect(screen.getByTestId("state-conv-id").textContent).toMatch(/conv-abc/);
  });

  it("State inspector surfaces last error when present", () => {
    render(<DevPanel {...defaultProps()} error="Chat stream failed: 500" />);
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
    render(<DevPanel {...defaultProps()} />);
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

describe("DevPanel — policy presets", () => {
  it("renders the policy section with all preset buttons", () => {
    render(<DevPanel {...defaultProps()} />);
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
    render(<DevPanel {...defaultProps()} />);
    expect(
      screen.queryByTestId("dev-policy-active-badge"),
    ).not.toBeInTheDocument();
  });

  it("shows the Active badge when a non-default preset is selected", () => {
    render(
      <DevPanel {...defaultProps()} policyPreset="block_expensive" />,
    );
    expect(
      screen.getByTestId("dev-policy-active-badge"),
    ).toBeInTheDocument();
  });

  it("clicking a preset calls onPolicyPresetChange with the id", () => {
    const props = defaultProps();
    render(<DevPanel {...props} />);
    fireEvent.click(screen.getByTestId("dev-policy-preset-mixed_verdict"));
    expect(props.onPolicyPresetChange).toHaveBeenCalledWith("mixed_verdict");
  });

  it("the active preset has data-active=true; others false", () => {
    render(
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
