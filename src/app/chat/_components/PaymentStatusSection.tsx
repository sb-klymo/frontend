"use client";

/**
 * PaymentStatusSection — dev-only "who am I, payment-wise" snapshot.
 *
 * Shows the current authenticated user's payment_mode (auto_charge /
 * checkout_opt_in / checkout_fallback) and saved-card status (via the
 * `stripe_payment_method_id` field on the /me response — non-null
 * implies a saved card).
 *
 * Why no last4 / brand: keeping this fetch behind /me means zero new
 * backend endpoints. last4 + brand would require a live Stripe call
 * (paid path) or a migration to cache them on `users` (Phase 4 work).
 * The PM ID alone is enough for a dev panel — paste it into the
 * Stripe Dashboard search to find the full card record.
 *
 * Server state lives in TanStack Query per `frontend/CLAUDE.md`
 * invariant #1; the section is `enabled: open` so an unexpanded
 * section never fetches. The fetch hits the BFF proxy at /api/me
 * (rather than the generated SDK) so this component is robust to the
 * order in which docs/openapi.json + frontend gen:api land in CI —
 * same pattern as IssuingCardsSection.
 */

import { useQuery } from "@tanstack/react-query";

import type { SupportedLanguage } from "@/lib/i18n";

// Mirrors backend `CurrentUser` shape exactly. Inline to avoid a hard
// dependency on the regenerated openapi types — this section is
// dev-only and the four fields are stable enough to duplicate here.
type PaymentMode = "auto_charge" | "checkout_opt_in" | "checkout_fallback";

type CurrentUser = {
  id: string;
  email?: string | null;
  payment_mode?: PaymentMode;
  stripe_payment_method_id?: string | null;
};

const STRIPE_CUSTOMER_DEEPLINK = "https://dashboard.stripe.com/test/customers";

async function fetchMe(): Promise<CurrentUser> {
  const res = await fetch("/api/me", { method: "GET" });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  return (await res.json()) as CurrentUser;
}

const PAYMENT_MODE_LABELS: Record<PaymentMode, { fr: string; en: string }> = {
  auto_charge: { fr: "Prélèvement auto", en: "Auto-charge" },
  checkout_opt_in: { fr: "Checkout (opt-in)", en: "Checkout (opt-in)" },
  checkout_fallback: { fr: "Checkout (sans carte)", en: "Checkout (no card)" },
};

export function PaymentStatusSection({
  language,
  open,
  onToggle,
}: {
  language: SupportedLanguage;
  open: boolean;
  onToggle: () => void;
}) {
  const query = useQuery({
    queryKey: ["dev", "me"],
    queryFn: fetchMe,
    // Only fetch when the section is expanded — collapsed sections
    // shouldn't hit the network just to show a closed disclosure.
    enabled: open,
    // 30s mirrors IssuingCardsSection — fast-stale acceptable for
    // a dev panel.
    staleTime: 30_000,
  });

  const labels =
    language === "fr"
      ? {
          heading: "État paiement",
          refresh: "Actualiser",
          loading: "Chargement…",
          error: "Erreur de chargement",
          mode: "Mode",
          savedCard: "Carte enregistrée",
          pmId: "PM ID",
          yes: "✓ Oui",
          no: "✗ Non",
          openInStripe: "Voir dans Stripe",
          unknown: "—",
        }
      : {
          heading: "Payment Status",
          refresh: "Refresh",
          loading: "Loading…",
          error: "Failed to load",
          mode: "Mode",
          savedCard: "Saved card",
          pmId: "PM ID",
          yes: "✓ Yes",
          no: "✗ No",
          openInStripe: "Open in Stripe",
          unknown: "—",
        };

  const data = query.data;
  const mode = data?.payment_mode;
  const hasCard = Boolean(data?.stripe_payment_method_id);
  const pmId = data?.stripe_payment_method_id ?? null;
  const modeLabel = mode
    ? PAYMENT_MODE_LABELS[mode][language]
    : labels.unknown;

  // Trailing badge on the heading — at-a-glance signal even when the
  // section is collapsed. Mirrors PolicySection's active-preset badge
  // pattern in DevPanel.
  const badge = data ? (
    <span
      className={`rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${
        hasCard
          ? "bg-green-100 text-green-800"
          : "bg-gray-100 text-gray-600"
      }`}
      data-testid="dev-payment-status-badge"
    >
      {hasCard ? labels.yes : labels.no}
    </span>
  ) : null;

  return (
    <section data-testid="dev-payment-status-section">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="mb-1.5 flex w-full items-center justify-between gap-2 text-left"
      >
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
          {labels.heading}
        </h3>
        <span className="flex items-center gap-2">
          {badge}
          <span aria-hidden="true" className="text-xs text-gray-400">
            {open ? "▾" : "▸"}
          </span>
        </span>
      </button>

      {open && (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={() => void query.refetch()}
              disabled={query.isFetching}
              data-testid="dev-payment-status-refresh"
              className="rounded border border-gray-300 bg-white px-2 py-1 text-[10px] font-medium uppercase tracking-wide text-gray-600 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {query.isFetching ? labels.loading : `↻ ${labels.refresh}`}
            </button>
          </div>

          {query.isError && (
            <p
              className="rounded border border-red-200 bg-red-50 px-2 py-1.5 text-[11px] text-red-700"
              data-testid="dev-payment-status-error"
            >
              {labels.error} —{" "}
              {query.error instanceof Error ? query.error.message : "Network error"}
            </p>
          )}

          {query.isSuccess && data && (
            <dl
              className="space-y-1 rounded border border-gray-200 bg-white px-2 py-1.5 text-[11px]"
              data-testid="dev-payment-status-fields"
            >
              <Row
                label={labels.mode}
                value={modeLabel}
                testId="dev-payment-status-mode"
              />
              <Row
                label={labels.savedCard}
                value={hasCard ? labels.yes : labels.no}
                className={
                  hasCard ? "text-green-700" : "text-gray-500"
                }
                testId="dev-payment-status-has-card"
              />
              {pmId && (
                <div className="flex items-baseline justify-between gap-2">
                  <dt className="shrink-0 text-gray-500">{labels.pmId}</dt>
                  <dd className="truncate text-right">
                    <a
                      href={STRIPE_CUSTOMER_DEEPLINK}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-mono text-[10px] text-blue-600 hover:underline"
                      title={pmId}
                      data-testid="dev-payment-status-pm-id"
                    >
                      {pmId}
                    </a>
                  </dd>
                </div>
              )}
            </dl>
          )}
        </div>
      )}
    </section>
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
