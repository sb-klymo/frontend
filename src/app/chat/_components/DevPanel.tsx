"use client";

/**
 * DevPanel — left-side scratch pad for manual chat testing.
 *
 * Renders a categorized list of one-click prompts (FR + EN), a state
 * inspector, and convenience buttons (reset, random, copy state).
 *
 * Visibility: gated by `process.env.NODE_ENV !== "production"`. Next.js
 * statically replaces NODE_ENV at build time, so in `npm run build`
 * the entire panel + the dev-prompts catalog get dead-code-eliminated.
 * Search the production bundle for "Marseille" to confirm — none of
 * the prompt text should appear.
 */

import Link from "next/link";
import { useCallback, useState, useSyncExternalStore } from "react";

import {
  DEV_PROMPT_CATEGORIES,
  pickRandomPrompt,
  type DevPromptCategory,
} from "@/lib/dev-prompts";
import type { SupportedLanguage } from "@/lib/i18n";
import {
  POLICY_PRESETS,
  type PolicyPresetId,
} from "@/lib/policy-presets";
import {
  VOICE_PRESETS,
  type VoicePresetId,
} from "@/lib/voice-presets";

import { IssuingCardsSection } from "./IssuingCardsSection";
import { OrgRulesSection } from "./OrgRulesSection";
import { PaymentStatusSection } from "./PaymentStatusSection";

// ---------------------------------------------------------------------------
// Collapsed-section persistence (localStorage).
//
// localStorage key. Stored as Record<sectionId, true> — only collapsed
// sections are present, so an empty record (first visit, cleared storage)
// defaults to all open.
const COLLAPSED_STORAGE_KEY = "klymo-dev-panel-collapsed";
// Same-window writes don't fire a "storage" event (that only fires
// cross-tab), so we dispatch this custom event ourselves to nudge
// `useSyncExternalStore` subscribers in the writing tab.
const COLLAPSED_LOCAL_EVENT = "klymo:dev-panel-collapsed-write";

type CollapsedState = Record<string, boolean>;
const EMPTY_COLLAPSED: CollapsedState = Object.freeze({});

// Snapshot cache — useSyncExternalStore requires a stable reference for
// unchanged state (otherwise it tears in StrictMode and re-renders on
// every read). We memoize on the raw localStorage string.
let cachedRaw: string | null | undefined = undefined;
let cachedSnapshot: CollapsedState = EMPTY_COLLAPSED;

function readCollapsedSnapshot(): CollapsedState {
  if (typeof window === "undefined") return EMPTY_COLLAPSED;
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(COLLAPSED_STORAGE_KEY);
  } catch {
    return EMPTY_COLLAPSED;
  }
  if (raw === cachedRaw) return cachedSnapshot;
  cachedRaw = raw;
  try {
    cachedSnapshot = raw ? (JSON.parse(raw) as CollapsedState) : EMPTY_COLLAPSED;
  } catch {
    cachedSnapshot = EMPTY_COLLAPSED;
  }
  return cachedSnapshot;
}

function subscribeCollapsed(callback: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener("storage", callback);
  window.addEventListener(COLLAPSED_LOCAL_EVENT, callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener(COLLAPSED_LOCAL_EVENT, callback);
  };
}

function writeCollapsed(value: CollapsedState): void {
  try {
    window.localStorage.setItem(COLLAPSED_STORAGE_KEY, JSON.stringify(value));
    window.dispatchEvent(new Event(COLLAPSED_LOCAL_EVENT));
  } catch {
    // Best-effort persistence — quota exceeded / private mode etc.
  }
}

// Server snapshot is always the empty default — no localStorage on the
// server, so the SSR HTML matches the first client render before the
// browser provides the real value.
function getServerCollapsedSnapshot(): CollapsedState {
  return EMPTY_COLLAPSED;
}

export type DevPanelProps = {
  send: (text: string) => void | Promise<void>;
  reset: () => void;
  isStreaming: boolean;
  // State inspector inputs
  language: SupportedLanguage;
  workflowStage: string | null;
  conversationId: string | null;
  messageCount: number;
  error: string | null;
  // Policy preset selector — drives the dev_policy_override forwarded
  // to /chat. The active preset's `config` is read by ChatRoot at send
  // time; the panel's only job is to surface the choice.
  policyPreset: PolicyPresetId;
  onPolicyPresetChange: (id: PolicyPresetId) => void;
  // Voice preset selector — drives the dev_vibe_override forwarded to
  // /chat. Symmetric to policyPreset above. Lets the developer A/B
  // Klymo's playful vs neutral register mid-conversation without
  // restarting anything.
  voicePreset: VoicePresetId;
  onVoicePresetChange: (id: VoicePresetId) => void;
};

export function DevPanel({
  send,
  reset,
  isStreaming,
  language,
  workflowStage,
  conversationId,
  messageCount,
  error,
  policyPreset,
  onPolicyPresetChange,
  voicePreset,
  onVoicePresetChange,
}: DevPanelProps) {
  // Local toggle for which language's prompts to show. Independent of
  // the auto-detected `language` so the developer can visually scan
  // both sets.
  const [promptLang, setPromptLang] = useState<SupportedLanguage>("fr");
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null);

  // Per-section collapsed state, synced with localStorage via
  // `useSyncExternalStore` — the React 19 idiomatic way to subscribe
  // to a non-React store. SSR returns the empty default so the first
  // client render matches before the browser provides the real value.
  const collapsed = useSyncExternalStore(
    subscribeCollapsed,
    readCollapsedSnapshot,
    getServerCollapsedSnapshot,
  );
  const isOpen = (id: string) => !collapsed[id];
  const toggle = useCallback((id: string) => {
    const current = readCollapsedSnapshot();
    writeCollapsed({ ...current, [id]: !current[id] });
  }, []);

  function handleSend(text: string) {
    if (isStreaming) return;
    void send(text);
  }

  function handleRandom() {
    const text = pickRandomPrompt(DEV_PROMPT_CATEGORIES, promptLang);
    if (text) handleSend(text);
  }

  async function handleCopyState() {
    const snapshot = JSON.stringify(
      {
        conversation_id: conversationId,
        workflow_stage: workflowStage,
        detected_language: language,
        messages: messageCount,
        last_error: error,
      },
      null,
      2,
    );
    try {
      await navigator.clipboard.writeText(snapshot);
      setCopyFeedback("copied!");
    } catch {
      setCopyFeedback("copy failed");
    }
    setTimeout(() => setCopyFeedback(null), 1500);
  }

  return (
    <aside
      className="hidden w-72 shrink-0 flex-col border-r border-gray-200 bg-gray-50 lg:flex"
      data-testid="dev-panel"
    >
      <div className="border-b border-gray-200 px-4 py-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
            Dev
          </span>
          <span className="rounded bg-amber-100 px-2 py-0.5 text-[10px] font-medium uppercase text-amber-800">
            local-only
          </span>
        </div>
        <LangToggle value={promptLang} onChange={setPromptLang} />
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto px-4 py-3">
        <ActionButtons
          onRandom={handleRandom}
          onReset={reset}
          isStreaming={isStreaming}
        />

        <PaymentStatusSection
          language={promptLang}
          open={isOpen("payment-status")}
          onToggle={() => toggle("payment-status")}
        />

        <PaymentSection
          language={promptLang}
          open={isOpen("payment")}
          onToggle={() => toggle("payment")}
        />

        <PolicySection
          activeId={policyPreset}
          onChange={onPolicyPresetChange}
          language={promptLang}
          open={isOpen("policy")}
          onToggle={() => toggle("policy")}
        />

        <OrgRulesSection
          language={promptLang}
          open={isOpen("org-rules")}
          onToggle={() => toggle("org-rules")}
        />

        <VoiceSection
          activeId={voicePreset}
          onChange={onVoicePresetChange}
          language={promptLang}
          open={isOpen("voice")}
          onToggle={() => toggle("voice")}
        />

        <IssuingCardsSection
          language={promptLang}
          open={isOpen("issuing-cards")}
          onToggle={() => toggle("issuing-cards")}
        />

        {DEV_PROMPT_CATEGORIES.map((cat) => (
          <CategorySection
            key={cat.key}
            category={cat}
            language={promptLang}
            disabled={isStreaming}
            onSelect={handleSend}
            open={isOpen(cat.key)}
            onToggle={() => toggle(cat.key)}
          />
        ))}
      </div>

      <StateInspector
        open={isOpen("state")}
        onToggle={() => toggle("state")}
        conversationId={conversationId}
        workflowStage={workflowStage}
        language={language}
        messageCount={messageCount}
        error={error}
        onCopy={handleCopyState}
        copyFeedback={copyFeedback}
      />
    </aside>
  );
}

function LangToggle({
  value,
  onChange,
}: {
  value: SupportedLanguage;
  onChange: (lang: SupportedLanguage) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Prompt language"
      className="mt-2 inline-flex rounded-md border border-gray-300 bg-white p-0.5"
    >
      {(["fr", "en"] as const).map((lang) => {
        const active = value === lang;
        return (
          <button
            key={lang}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(lang)}
            className={`rounded px-3 py-1 text-xs font-medium uppercase tracking-wide ${
              active
                ? "bg-blue-600 text-white"
                : "text-gray-600 hover:text-gray-900"
            }`}
          >
            {lang}
          </button>
        );
      })}
    </div>
  );
}

function ActionButtons({
  onRandom,
  onReset,
  isStreaming,
}: {
  onRandom: () => void;
  onReset: () => void;
  isStreaming: boolean;
}) {
  return (
    <div className="grid grid-cols-2 gap-2">
      <button
        type="button"
        onClick={onRandom}
        disabled={isStreaming}
        className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
      >
        🎲 Random
      </button>
      <button
        type="button"
        onClick={onReset}
        className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-100"
      >
        ↻ Reset chat
      </button>
    </div>
  );
}

/**
 * Shared collapsible-section header. Click anywhere on the row to toggle.
 *
 * Click target wraps the `<h3>` (technically a heading-inside-button — the
 * W3C ARIA Authoring Practices Guide recommends this exact disclosure
 * pattern) so the textContent of the heading stays equal to the title
 * (the chevron is a sibling span, marked aria-hidden). Tests that query
 * `getAllByRole("heading")` continue to see the bare title.
 */
function CollapsibleHeader({
  title,
  open,
  onToggle,
  trailing,
}: {
  title: string;
  open: boolean;
  onToggle: () => void;
  /** Optional badge/indicator rendered between the title and the chevron. */
  trailing?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      className="mb-1.5 flex w-full items-center justify-between gap-2 text-left"
    >
      <h3 className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
        {title}
      </h3>
      <span className="flex items-center gap-2">
        {trailing}
        <span aria-hidden="true" className="text-xs text-gray-400">
          {open ? "▾" : "▸"}
        </span>
      </span>
    </button>
  );
}

function PaymentSection({
  language,
  open,
  onToggle,
}: {
  language: SupportedLanguage;
  open: boolean;
  onToggle: () => void;
}) {
  const labels =
    language === "fr"
      ? { heading: "Paiement", action: "Enregistrer une carte" }
      : { heading: "Payment", action: "Save / replace card" };

  return (
    <section data-testid="dev-payment-section">
      <CollapsibleHeader title={labels.heading} open={open} onToggle={onToggle} />
      {open && (
        <Link
          href="/onboarding/payment-method"
          data-testid="dev-payment-setup-link"
          className="block w-full rounded border border-gray-200 bg-white px-2 py-1.5 text-left text-xs text-gray-800 hover:border-blue-400 hover:bg-blue-50"
        >
          💳 {labels.action}
        </Link>
      )}
    </section>
  );
}

function PolicySection({
  activeId,
  onChange,
  language,
  open,
  onToggle,
}: {
  activeId: PolicyPresetId;
  onChange: (id: PolicyPresetId) => void;
  language: SupportedLanguage;
  open: boolean;
  onToggle: () => void;
}) {
  // Active-preset badge stays visible whether the section is collapsed
  // or expanded — at-a-glance indication that a non-default policy is in
  // effect even when the body is hidden.
  const activeBadge =
    activeId !== "none" ? (
      <span
        className="rounded bg-violet-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-violet-800"
        data-testid="dev-policy-active-badge"
      >
        {language === "fr" ? "Actif" : "Active"}
      </span>
    ) : null;

  return (
    <section data-testid="dev-policy-section">
      <CollapsibleHeader
        title={language === "fr" ? "Politique" : "Policy"}
        open={open}
        onToggle={onToggle}
        trailing={activeBadge}
      />
      {open && (
        <div className="space-y-1">
          {POLICY_PRESETS.map((p) => {
            const active = p.id === activeId;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => onChange(p.id)}
                title={p.hint[language]}
                data-testid={`dev-policy-preset-${p.id}`}
                data-active={active ? "true" : "false"}
                className={`block w-full truncate rounded border px-2 py-1.5 text-left text-xs ${
                  active
                    ? "border-violet-500 bg-violet-50 font-medium text-violet-900"
                    : "border-gray-200 bg-white text-gray-800 hover:border-violet-400 hover:bg-violet-50"
                }`}
              >
                {p.label[language]}
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}

function VoiceSection({
  activeId,
  onChange,
  language,
  open,
  onToggle,
}: {
  activeId: VoicePresetId;
  onChange: (id: VoicePresetId) => void;
  language: SupportedLanguage;
  open: boolean;
  onToggle: () => void;
}) {
  // "Active" badge only when the user picked a non-default preset. Mirrors
  // PolicySection's "Actif" pill so the at-a-glance signal is consistent
  // across dev-panel toggles.
  const activeBadge =
    activeId !== "default" ? (
      <span
        className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-800"
        data-testid="dev-voice-active-badge"
      >
        {language === "fr" ? "Actif" : "Active"}
      </span>
    ) : null;

  return (
    <section data-testid="dev-voice-section">
      <CollapsibleHeader
        title={language === "fr" ? "Voix" : "Voice"}
        open={open}
        onToggle={onToggle}
        trailing={activeBadge}
      />
      {open && (
        <div className="space-y-1">
          {VOICE_PRESETS.map((p) => {
            const active = p.id === activeId;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => onChange(p.id)}
                title={p.hint[language]}
                data-testid={`dev-voice-preset-${p.id}`}
                data-active={active ? "true" : "false"}
                className={`block w-full truncate rounded border px-2 py-1.5 text-left text-xs ${
                  active
                    ? "border-amber-500 bg-amber-50 font-medium text-amber-900"
                    : "border-gray-200 bg-white text-gray-800 hover:border-amber-400 hover:bg-amber-50"
                }`}
              >
                {p.label[language]}
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}


function CategorySection({
  category,
  language,
  disabled,
  onSelect,
  open,
  onToggle,
}: {
  category: DevPromptCategory;
  language: SupportedLanguage;
  disabled: boolean;
  onSelect: (text: string) => void;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <section>
      <CollapsibleHeader
        title={category.label[language]}
        open={open}
        onToggle={onToggle}
      />
      {open && (
        <div className="space-y-1">
          {category.prompts.map((p) => {
            const text = p[language];
            return (
              <button
                key={text}
                type="button"
                onClick={() => onSelect(text)}
                disabled={disabled}
                title={text}
                className="block w-full truncate rounded border border-gray-200 bg-white px-2 py-1.5 text-left text-xs text-gray-800 hover:border-blue-400 hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {text}
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}

function StateInspector({
  open,
  onToggle,
  conversationId,
  workflowStage,
  language,
  messageCount,
  error,
  onCopy,
  copyFeedback,
}: {
  open: boolean;
  onToggle: () => void;
  conversationId: string | null;
  workflowStage: string | null;
  language: SupportedLanguage;
  messageCount: number;
  error: string | null;
  onCopy: () => void;
  copyFeedback: string | null;
}) {
  return (
    <div className="border-t border-gray-200 bg-white">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide text-gray-500 hover:bg-gray-50"
        aria-expanded={open}
      >
        <span>State</span>
        <span aria-hidden="true">{open ? "▾" : "▸"}</span>
      </button>
      {open && (
        <dl
          className="space-y-1 px-4 pb-3 text-[11px] font-mono text-gray-700"
          data-testid="dev-state-inspector"
        >
          <Row label="conv_id" value={shortId(conversationId)} testId="state-conv-id" />
          <Row label="stage" value={workflowStage ?? "—"} testId="state-stage" />
          <Row label="lang" value={language} testId="state-lang" />
          <Row label="msgs" value={String(messageCount)} testId="state-msgs" />
          {error && (
            <Row
              label="error"
              value={error}
              className="text-red-700"
              testId="state-error"
            />
          )}
          <button
            type="button"
            onClick={onCopy}
            className="mt-2 w-full rounded border border-gray-200 bg-gray-50 px-2 py-1 text-left text-[10px] uppercase tracking-wide text-gray-600 hover:bg-gray-100"
          >
            {copyFeedback ?? "📋 Copy state for bug report"}
          </button>
        </dl>
      )}
    </div>
  );
}

function Row({
  label,
  value,
  className,
  testId,
}: {
  label: string;
  value: string;
  className?: string;
  testId?: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="shrink-0 text-gray-500">{label}</dt>
      <dd
        className={`truncate text-right ${className ?? ""}`}
        title={value}
        data-testid={testId}
      >
        {value}
      </dd>
    </div>
  );
}

function shortId(id: string | null): string {
  if (!id) return "—";
  return id.length > 12 ? `${id.slice(0, 8)}…${id.slice(-4)}` : id;
}
