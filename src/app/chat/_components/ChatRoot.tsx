"use client";

/**
 * ChatRoot — client wrapper for the chat page.
 *
 * Owns the single `useChatStream` instance and forks its outputs to:
 *   - `<DevPanel>` (left, dev-only) for one-click test prompts and
 *     a state inspector
 *   - `<ChatWindow>` (right) for the actual conversation
 *
 * The single-hook contract is critical — running two `useChatStream`
 * instances in parallel would split message state and break the
 * conversation.
 */

import { DEV_BUILD } from "@/lib/build-mode";
import { useChatStream } from "@/hooks/useChatStream";
import { useChatStore } from "@/stores/chatStore";

import { ChatWindow } from "./ChatWindow";
import { DevPanel } from "./DevPanel";

export function ChatRoot() {
  const stream = useChatStream();
  const conversationId = useChatStore((s) => s.conversationId);

  return (
    <div className="flex flex-1 overflow-hidden">
      {DEV_BUILD && (
        <DevPanel
          send={stream.send}
          reset={stream.reset}
          isStreaming={stream.isStreaming}
          language={stream.language}
          workflowStage={stream.workflowStage}
          conversationId={conversationId}
          messageCount={stream.messages.length}
          error={stream.error}
        />
      )}
      <ChatWindow
        messages={stream.messages}
        error={stream.error}
        isStreaming={stream.isStreaming}
        language={stream.language}
        send={stream.send}
        stop={stream.stop}
        reset={stream.reset}
      />
    </div>
  );
}
