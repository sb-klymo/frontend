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
        in the same tab so the existing PaymentMethodForm's
        `router.push("/chat?onboarded=1")` post-success redirect lands
        the user back here. Using `next/link` would proxy through the
        Next.js router and lose the standalone-page semantics; a plain
        `<a>` is the right primitive.
      */}
      <a
        href={onboarding.url}
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
