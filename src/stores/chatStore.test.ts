import { beforeEach, describe, expect, it } from "vitest";

import { useChatStore } from "./chatStore";

describe("chatStore", () => {
  beforeEach(() => {
    useChatStore.getState().resetConversation();
  });

  it("has sensible initial state", () => {
    const s = useChatStore.getState();
    expect(s.draft).toBe("");
    expect(s.isStreaming).toBe(false);
    expect(s.conversationId).toBe(null);
  });

  it("updates the draft", () => {
    useChatStore.getState().setDraft("hello");
    expect(useChatStore.getState().draft).toBe("hello");
  });

  it("toggles streaming", () => {
    useChatStore.getState().setStreaming(true);
    expect(useChatStore.getState().isStreaming).toBe(true);
    useChatStore.getState().setStreaming(false);
    expect(useChatStore.getState().isStreaming).toBe(false);
  });

  it("persists a conversation id across turns", () => {
    const id = "11111111-1111-1111-1111-111111111111";
    useChatStore.getState().setConversationId(id);
    expect(useChatStore.getState().conversationId).toBe(id);
  });

  it("resetConversation clears draft, streaming and id", () => {
    const s = useChatStore.getState();
    s.setDraft("pending");
    s.setStreaming(true);
    s.setConversationId("abc");

    s.resetConversation();

    const after = useChatStore.getState();
    expect(after.draft).toBe("");
    expect(after.isStreaming).toBe(false);
    expect(after.conversationId).toBe(null);
  });
});
