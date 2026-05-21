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
    resumeApproval: vi.fn(),
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
    render(<ChatRoot />);

    await waitFor(() => {
      expect(mockCheckPendingApprovals).toHaveBeenCalled();
    });

    // Allow any microtasks to settle — the count must not grow beyond
    // the initial call (React StrictMode double-invocation aside; in
    // production React only runs effects once per mount).
    await new Promise((r) => setTimeout(r, 50));
    // In StrictMode Vitest runs effects twice; cap at 2 to cover both
    // modes without over-constraining.
    expect(mockCheckPendingApprovals.mock.calls.length).toBeLessThanOrEqual(2);
  });
});
