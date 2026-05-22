/**
 * ChatRoot — mount-time behaviour tests.
 *
 * These tests exercise the ChatRoot component itself, not the internals of
 * useChatStream (those live in useChatStream.test.ts). The focus here is the
 * wiring: does ChatRoot call `checkPendingApprovals` on mount?
 *
 * useChatStream is mocked wholesale so this file has no dependency on the
 * Supabase/fetch infrastructure exercised by the hook tests.
 */

import { render, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock useChatStream — return the minimum shape ChatRoot reads.
// ---------------------------------------------------------------------------

const mockCheckPendingApprovals = vi.fn(async () => {});

vi.mock("@/hooks/useChatStream", () => ({
  useChatStream: () => ({
    messages: [],
    error: null,
    isStreaming: false,
    isBubblePending: false,
    language: "en",
    workflowStage: null,
    send: vi.fn(),
    stop: vi.fn(),
    reset: vi.fn(),
    resumeExtras: vi.fn(),
    checkPendingApprovals: mockCheckPendingApprovals,
  }),
}));

// ---------------------------------------------------------------------------
// Mock child components so the test doesn't need their full dependency trees.
// ---------------------------------------------------------------------------

vi.mock("./ChatWindow", () => ({
  ChatWindow: () => <div data-testid="chat-window" />,
}));

vi.mock("./DevPanel", () => ({
  DevPanel: () => <div data-testid="dev-panel" />,
}));

// ---------------------------------------------------------------------------
// Mock stores / build-mode flag so imports resolve cleanly in jsdom.
// ---------------------------------------------------------------------------

vi.mock("@/stores/chatStore", () => ({
  useChatStore: (_selector: (s: { conversationId: null }) => null) =>
    _selector({ conversationId: null }),
}));

vi.mock("@/lib/build-mode", () => ({ DEV_BUILD: false }));

vi.mock("@/lib/policy-presets", () => ({
  findPreset: () => ({ config: null }),
}));

vi.mock("@/lib/voice-presets", () => ({
  findVoicePreset: () => ({ config: null }),
}));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

import { ChatRoot } from "./ChatRoot";

describe("ChatRoot", () => {
  beforeEach(() => {
    mockCheckPendingApprovals.mockClear();
  });

  it("calls checkPendingApprovals on mount", async () => {
    render(<ChatRoot />);

    await waitFor(() => {
      expect(mockCheckPendingApprovals).toHaveBeenCalledTimes(1);
    });
  });

  it("does not call checkPendingApprovals more than once on a stable mount", async () => {
    // Render without React.StrictMode so effects fire exactly once (as in
    // production). toBe(1) would fail if the effect dep became unstable and
    // re-fired on every render — the whole point of this test.
    const { unmount } = render(<ChatRoot />, { wrapper: undefined });

    await waitFor(() => {
      expect(mockCheckPendingApprovals).toHaveBeenCalledTimes(1);
    });

    // Allow any microtasks to settle — count must remain at exactly 1.
    await new Promise((r) => setTimeout(r, 50));
    expect(mockCheckPendingApprovals.mock.calls.length).toBe(1);

    unmount();
  });
});
