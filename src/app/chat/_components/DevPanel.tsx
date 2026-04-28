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

import { useState } from "react";

import {
  DEV_PROMPT_CATEGORIES,
  pickRandomPrompt,
  type DevPromptCategory,
} from "@/lib/dev-prompts";
import type { SupportedLanguage } from "@/lib/i18n";

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
}: DevPanelProps) {
  // Local toggle for which language's prompts to show. Independent of
  // the auto-detected `language` so the developer can visually scan
  // both sets.
  const [promptLang, setPromptLang] = useState<SupportedLanguage>("fr");
  const [stateOpen, setStateOpen] = useState(true);
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null);

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

        {DEV_PROMPT_CATEGORIES.map((cat) => (
          <CategorySection
            key={cat.key}
            category={cat}
            language={promptLang}
            disabled={isStreaming}
            onSelect={handleSend}
          />
        ))}
      </div>

      <StateInspector
        open={stateOpen}
        onToggle={() => setStateOpen((v) => !v)}
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

function CategorySection({
  category,
  language,
  disabled,
  onSelect,
}: {
  category: DevPromptCategory;
  language: SupportedLanguage;
  disabled: boolean;
  onSelect: (text: string) => void;
}) {
  return (
    <section>
      <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
        {category.label[language]}
      </h3>
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
