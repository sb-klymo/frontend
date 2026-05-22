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

import { useEffect, useState } from "react";

import { useChatStream } from "@/hooks/useChatStream";
import { DEV_BUILD } from "@/lib/build-mode";
import { findPreset, type PolicyPresetId } from "@/lib/policy-presets";
import { findVoicePreset, type VoicePresetId } from "@/lib/voice-presets";
import { useChatStore } from "@/stores/chatStore";

import { ChatWindow } from "./ChatWindow";
import { DevPanel } from "./DevPanel";

/**
 * `isTeam` is server-derived from the `TEAM_EMAILS` allowlist on the
 * backend — the frontend never decides "team-ness" on its own. When
 * true in a production build the dev panel renders alongside the
 * chat (same as in dev). When false, the panel is hidden. Local dev
 * builds always show it (`DEV_BUILD === true`) so the flag is only
 * load-bearing for the deployed app.
 */
export function ChatRoot({ isTeam = false }: { isTeam?: boolean }) {
  const [policyPreset, setPolicyPreset] = useState<PolicyPresetId>("none");
  const [voicePreset, setVoicePreset] = useState<VoicePresetId>("default");
  const stream = useChatStream({
    devPolicyOverride: findPreset(policyPreset).config,
    devVibeOverride: findVoicePreset(voicePreset).config,
  });
  const { checkPendingApprovals } = stream;
  const conversationId = useChatStore((s) => s.conversationId);

  // Task 14 — on mount, poll /me/pending-approvals and auto-resume any
  // approval conversation where the manager decided while the user was
  // offline (Realtime never delivered the UPDATE in that case).
  // `checkPendingApprovals` is stable across renders (useCallback in
  // useChatStream) but React lint still requires it in the dep array.
  useEffect(() => {
    void checkPendingApprovals();
  }, [checkPendingApprovals]);

  const showDevPanel = DEV_BUILD || isTeam;

  return (
    <div className="flex flex-1 overflow-hidden">
      {showDevPanel && (
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
          voicePreset={voicePreset}
          onVoicePresetChange={setVoicePreset}
        />
      )}
      <ChatWindow
        messages={stream.messages}
        error={stream.error}
        isStreaming={stream.isStreaming}
        isBubblePending={stream.isBubblePending}
        language={stream.language}
        workflowStage={stream.workflowStage}
        send={stream.send}
        stop={stream.stop}
        reset={stream.reset}
      />
    </div>
  );
}
