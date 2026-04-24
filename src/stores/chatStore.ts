/**
 * UI-only Zustand store for the chat page.
 *
 * Server state (message history, booking options) lives in TanStack Query.
 * This store holds only ephemeral UI concerns: the draft input text, whether
 * a stream is currently in flight, and the current conversation id so new
 * turns are routed to the same LangGraph thread.
 */

import { create } from "zustand";

type ChatState = {
  draft: string;
  setDraft: (draft: string) => void;
  isStreaming: boolean;
  setStreaming: (streaming: boolean) => void;
  conversationId: string | null;
  setConversationId: (id: string | null) => void;
  resetConversation: () => void;
};

export const useChatStore = create<ChatState>((set) => ({
  draft: "",
  setDraft: (draft) => set({ draft }),
  isStreaming: false,
  setStreaming: (isStreaming) => set({ isStreaming }),
  conversationId: null,
  setConversationId: (conversationId) => set({ conversationId }),
  resetConversation: () => set({ conversationId: null, draft: "", isStreaming: false }),
}));
