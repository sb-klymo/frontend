"use client";

/**
 * ChatRoot — client wrapper for the chat page.
 *
 * Owns the single `useChatStream` instance and forks its outputs to:
 *   - `<DevPanel>` (left, dev-only) for one-click test prompts, a
 *     policy preset selector, and a state inspector
 *   - `<ChatWindow>` (right) for the actual conversation
 *
 * The single-hook contract is critical — running two `useChatStream`
 * instances in parallel would split message state and break the
 * conversation.
 *
 * Policy preset state lives here (not in the hook) so that swapping
 * presets is just a state update at the React layer; the hook reads
 * the current value via a ref at send-time.
 */

import { useState } from "react";

import { useChatStream } from "@/hooks/useChatStream";
import { DEV_BUILD } from "@/lib/build-mode";
import { findPreset, type PolicyPresetId } from "@/lib/policy-presets";
import { useChatStore } from "@/stores/chatStore";

import { ChatWindow } from "./ChatWindow";
import { DevPanel } from "./DevPanel";

export function ChatRoot() {
  const [policyPreset, setPolicyPreset] = useState<PolicyPresetId>("none");
  const stream = useChatStream({
    devPolicyOverride: findPreset(policyPreset).config,
  });
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
          policyPreset={policyPreset}
          onPolicyPresetChange={setPolicyPreset}
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
