/**
 * ChatWindow tests — focused on the TypingIndicator behaviour wired
 * by this PR. The rest of ChatWindow (message rendering, send/stop
 * controls) is exercised through the per-card component tests in
 * sibling files and the Playwright suite.
 */

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { ChatMessage } from "@/hooks/useChatStream";

import { ChatWindow } from "./ChatWindow";

const _noop = () => undefined;

function _renderWindow(overrides: {
  workflowStage?: string | null;
  isStreaming?: boolean;
  messages?: ChatMessage[];
  language?: "en" | "fr";
} = {}) {
  return render(
    <ChatWindow
      messages={overrides.messages ?? []}
      error={null}
      isStreaming={overrides.isStreaming ?? true}
      language={overrides.language ?? "en"}
      workflowStage={overrides.workflowStage ?? null}
      send={_noop}
      stop={_noop}
      reset={_noop}
    />,
  );
}

describe("ChatWindow — TypingIndicator", () => {
  it("renders dots + 'Thinking…' label by default (no stage)", () => {
    _renderWindow({ workflowStage: null });
    expect(screen.getByTestId("typing-indicator")).toBeInTheDocument();
    expect(screen.getByTestId("typing-indicator-label").textContent).toBe(
      "Thinking…",
    );
  });

  it("renders 'Searching flights…' at ready_for_search", () => {
    _renderWindow({ workflowStage: "ready_for_search" });
    expect(screen.getByTestId("typing-indicator-label").textContent).toBe(
      "Searching flights…",
    );
  });

  it("renders 'Pulling the options together…' at options_returned", () => {
    _renderWindow({ workflowStage: "options_returned" });
    expect(screen.getByTestId("typing-indicator-label").textContent).toBe(
      "Pulling the options together…",
    );
  });

  it("renders 'Pulling the options together…' at awaiting_departure_selection", () => {
    // The user picks an option; until the bot replies, we're still in
    // a selection stage. Same label as options_returned — both feel
    // like "consolidating choices" from the user's POV.
    _renderWindow({ workflowStage: "awaiting_departure_selection" });
    expect(screen.getByTestId("typing-indicator-label").textContent).toBe(
      "Pulling the options together…",
    );
  });

  it("renders 'Finalizing your booking…' at checkout_ready", () => {
    _renderWindow({ workflowStage: "checkout_ready" });
    expect(screen.getByTestId("typing-indicator-label").textContent).toBe(
      "Finalizing your booking…",
    );
  });

  it("renders 'Finalizing your booking…' at payment_pending", () => {
    // Plan B users sit at payment_pending while Stripe Checkout +
    // M2-bis runs. If they type during that window, the indicator
    // should reflect what's actually happening.
    _renderWindow({ workflowStage: "payment_pending" });
    expect(screen.getByTestId("typing-indicator-label").textContent).toBe(
      "Finalizing your booking…",
    );
  });

  it("falls back to 'Thinking…' for unknown / draft stages", () => {
    _renderWindow({ workflowStage: "draft" });
    expect(screen.getByTestId("typing-indicator-label").textContent).toBe(
      "Thinking…",
    );
  });

  it("localizes the label to French", () => {
    _renderWindow({ language: "fr", workflowStage: "ready_for_search" });
    expect(screen.getByTestId("typing-indicator-label").textContent).toBe(
      "Recherche des vols…",
    );
  });

  it("indicator is hidden when not streaming", () => {
    _renderWindow({ isStreaming: false });
    expect(screen.queryByTestId("typing-indicator")).not.toBeInTheDocument();
  });

  it("indicator is hidden when the last message is already from the assistant", () => {
    // Token-streaming has started — the cursor on the live bubble
    // (`▍`) takes over from the placeholder dots. Showing both is
    // visually noisy.
    const messages: ChatMessage[] = [
      { id: "m1", role: "user", content: "Hi" },
      { id: "m2", role: "assistant", content: "Hello…" },
    ];
    _renderWindow({ messages, isStreaming: true });
    expect(screen.queryByTestId("typing-indicator")).not.toBeInTheDocument();
  });

  it("uses the label as aria-label for screen readers", () => {
    _renderWindow({ workflowStage: "ready_for_search" });
    const indicator = screen.getByRole("status");
    expect(indicator.getAttribute("aria-label")).toBe("Searching flights…");
  });
});
