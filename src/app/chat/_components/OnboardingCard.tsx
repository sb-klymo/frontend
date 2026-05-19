/**
 * OnboardingCard — renders the Stripe SetupIntent call-to-action
 * inline in chat at the third stage of the conversational onboarding
 * flow (PR-4 phase-4). Sourced from the `event: onboarding_redirect`
 * SSE frame the backend emits when a turn lands
 * `workflow_stage='onboarding_payment_redirect'`.
 *
 * Visually distinct from `CheckoutPaymentCard` (indigo here vs amber
 * there) so the user reads onboarding as "first-time setup" rather
 * than "complete an in-flight booking". Indigo is also unused by any
 * other card — keeps the visual vocabulary unambiguous (green=done,
 * amber=action-required-on-trip, gray=cancelled, indigo=onboarding).
 *
 * Pure presentational. No hooks, no browser APIs — same Server-
 * Component-friendly contract as the sibling cards even though it
 * only renders inside ChatWindow today.
 */

import type { OnboardingDetails } from "@/hooks/useChatStream";
import { strings, type SupportedLanguage } from "@/lib/i18n";

export type OnboardingCardProps = {
  onboarding: OnboardingDetails;
  language?: SupportedLanguage;
};

export function OnboardingCard({
  onboarding,
  language = "en",
}: OnboardingCardProps) {
  const t = strings(language).onboardingCard;
  const company = onboarding.company_name?.trim() || null;

  return (
    <div
      className="rounded-lg border border-indigo-200 bg-indigo-50 p-4 shadow-sm"
      data-testid="onboarding-card"
    >
      <div className="flex items-center gap-2">
        <span className="text-indigo-700" aria-hidden="true">
          ✦
        </span>
        <h3 className="text-sm font-semibold text-indigo-900">{t.title}</h3>
      </div>

      <p className="mt-2 text-xs text-gray-700" data-testid="onboarding-subtitle">
        {company ? t.subtitleWithCompany(company) : t.subtitleGeneric}
      </p>

      {/*
        External link — opens the Vercel-hosted Stripe SetupIntent page
        in a NEW tab (`target="_blank"`) so the chat conversation stays
        intact in the original tab while the user completes card setup.
        This matters in two scenarios:
          1. Local dev: the chat runs on localhost but the payment page
             is hosted on Vercel — a same-tab redirect to a different
             origin loses the localhost session, bouncing the user to
             /login. Coming back to localhost then drops the chat
             entirely.
          2. Production: even on a single domain, navigating away from
             /chat unmounts the streaming connection. New-tab keeps the
             SSE thread alive so any `setup_intent.succeeded` webhook
             that resumes the LangGraph thread can land back into the
             still-open chat without a refresh.
        `rel="noopener noreferrer"` is the standard hardening for
        `target="_blank"` (prevents the new tab from reverse-navigating
        the opener via `window.opener`).
      */}
      <a
        href={onboarding.url}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-4 inline-flex w-full items-center justify-center gap-1.5 rounded-md bg-indigo-600 px-3 py-2 text-xs font-medium text-white shadow-sm hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
        data-testid="onboarding-cta"
      >
        <span aria-hidden="true">↗</span>
        {t.ctaLabel}
      </a>

      <p
        className="mt-3 text-[11px] text-gray-500"
        data-testid="onboarding-note"
      >
        {t.note}
      </p>
    </div>
  );
}
