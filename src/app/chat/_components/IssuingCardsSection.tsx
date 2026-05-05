"use client";

/**
 * IssuingCardsSection — dev-only audit view of recent Stripe Issuing
 * virtual cards minted via the K1 booking chain.
 *
 * Surfaces what the backend's `GET /dev/cards` endpoint returns:
 *   booking_ref, stripe_issuing_card_id, last4, amount_cents, currency,
 *   outcome (paid / canceled / pending), created_at.
 *
 * Why this exists when Stripe Dashboard already shows cards:
 *   - One scroll, no tab-switch, during a debug session in chat.
 *   - The deeplink button still hands you off to Stripe Dashboard for
 *     the full PAN/CVC/authorization history (which we deliberately
 *     don't surface here — PCI scope stays SAQ-A).
 *
 * Server state lives in TanStack Query per `frontend/CLAUDE.md`
 * invariant #1; the section is `enabled: open` so an unexpanded
 * section never fetches. The fetch hits the BFF proxy at /api/dev/cards
 * (rather than the generated SDK) so this component is robust to the
 * order in which docs/openapi.json + frontend gen:api land in CI.
 */

import { useQuery } from "@tanstack/react-query";

import type { SupportedLanguage } from "@/lib/i18n";

// Mirrors backend `DevVirtualCardRow` shape exactly. Inline to avoid a
// hard dependency on the regenerated openapi types — this section is
// dev-only and the contract is stable enough to duplicate the seven
// fields here.
type IssuingCardOutcome = "paid" | "canceled" | "pending";

type IssuingCardRow = {
  booking_ref: string;
  stripe_issuing_card_id: string;
  last4: string | null;
  amount_cents: number;
  currency: string;
  outcome: IssuingCardOutcome;
  created_at: string;
};

type IssuingCardsResponse = { cards: IssuingCardRow[] };

const STRIPE_TEST_CARD_DEEPLINK = "https://dashboard.stripe.com/test/issuing/cards";

async function fetchIssuingCards(): Promise<IssuingCardsResponse> {
  const res = await fetch("/api/dev/cards", { method: "GET" });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  return (await res.json()) as IssuingCardsResponse;
}

export function IssuingCardsSection({
  language,
  open,
  onToggle,
}: {
  language: SupportedLanguage;
  open: boolean;
  onToggle: () => void;
}) {
  const query = useQuery({
    queryKey: ["dev", "issuing-cards"],
    queryFn: fetchIssuingCards,
    // Only fetch when the section is expanded — collapsed sections
    // shouldn't hit the network just to show a closed disclosure.
    enabled: open,
    // Dev panel: stale-fast is fine. 30s avoids spamming the backend
    // when the user clicks open/close repeatedly while debugging.
    staleTime: 30_000,
  });

  const labels =
    language === "fr"
      ? {
          heading: "Cartes Issuing",
          refresh: "Actualiser",
          empty: "Aucune carte virtuelle.",
          loading: "Chargement…",
          error: "Erreur de chargement",
          openInStripe: "Voir dans Stripe",
          outcomes: { paid: "Payé", canceled: "Annulée", pending: "En cours" },
        }
      : {
          heading: "Issuing Cards",
          refresh: "Refresh",
          empty: "No virtual cards yet.",
          loading: "Loading…",
          error: "Failed to load",
          openInStripe: "Open in Stripe",
          outcomes: { paid: "Paid", canceled: "Canceled", pending: "Pending" },
        };

  const cards = query.data?.cards ?? [];

  return (
    <section data-testid="dev-issuing-cards-section">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="mb-1.5 flex w-full items-center justify-between gap-2 text-left"
      >
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
          {labels.heading}
        </h3>
        <span aria-hidden="true" className="text-xs text-gray-400">
          {open ? "▾" : "▸"}
        </span>
      </button>

      {open && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={() => void query.refetch()}
              disabled={query.isFetching}
              data-testid="dev-issuing-cards-refresh"
              className="rounded border border-gray-300 bg-white px-2 py-1 text-[10px] font-medium uppercase tracking-wide text-gray-600 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {query.isFetching ? labels.loading : `↻ ${labels.refresh}`}
            </button>
          </div>

          {query.isError && (
            <p
              className="rounded border border-red-200 bg-red-50 px-2 py-1.5 text-[11px] text-red-700"
              data-testid="dev-issuing-cards-error"
            >
              {labels.error} —{" "}
              {query.error instanceof Error ? query.error.message : "Network error"}
            </p>
          )}

          {query.isSuccess && cards.length === 0 && (
            <p
              className="text-[11px] italic text-gray-500"
              data-testid="dev-issuing-cards-empty"
            >
              {labels.empty}
            </p>
          )}

          {query.isSuccess && cards.length > 0 && (
            <ul
              className="space-y-1.5"
              data-testid="dev-issuing-cards-list"
            >
              {cards.map((card) => (
                <IssuingCardItem
                  key={card.stripe_issuing_card_id}
                  card={card}
                  language={language}
                  outcomeLabels={labels.outcomes}
                  openInStripeLabel={labels.openInStripe}
                />
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

function IssuingCardItem({
  card,
  language,
  outcomeLabels,
  openInStripeLabel,
}: {
  card: IssuingCardRow;
  language: SupportedLanguage;
  outcomeLabels: Record<IssuingCardOutcome, string>;
  openInStripeLabel: string;
}) {
  const formatted = formatAmount(card.amount_cents, card.currency, language);
  const date = formatDate(card.created_at, language);
  const outcomeColor =
    card.outcome === "paid"
      ? "border-green-200 bg-green-50 text-green-800"
      : card.outcome === "canceled"
        ? "border-gray-200 bg-gray-50 text-gray-700"
        : "border-amber-200 bg-amber-50 text-amber-800";

  return (
    <li
      className="rounded border border-gray-200 bg-white px-2 py-1.5 text-[11px]"
      data-testid="dev-issuing-card-row"
      data-card-id={card.stripe_issuing_card_id}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-gray-800" data-testid="dev-issuing-card-last4">
          •••• {card.last4 ?? "—"}
        </span>
        <span
          className={`rounded border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${outcomeColor}`}
          data-testid="dev-issuing-card-outcome"
        >
          {outcomeLabels[card.outcome]}
        </span>
      </div>
      <div className="mt-0.5 flex items-center justify-between gap-2 text-gray-600">
        <span data-testid="dev-issuing-card-amount">{formatted}</span>
        <span className="text-gray-400">{date}</span>
      </div>
      <a
        href={`${STRIPE_TEST_CARD_DEEPLINK}/${card.stripe_issuing_card_id}`}
        target="_blank"
        rel="noopener noreferrer"
        data-testid="dev-issuing-card-stripe-link"
        className="mt-1 block truncate text-[10px] uppercase tracking-wide text-blue-600 hover:underline"
      >
        ↗ {openInStripeLabel}
      </a>
    </li>
  );
}

function formatAmount(cents: number, currency: string, language: SupportedLanguage): string {
  const amount = cents / 100;
  const locale = language === "fr" ? "fr-FR" : "en-US";
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency: currency || "USD",
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    // Unknown ISO currency — fall back to a plain string.
    return `${amount.toFixed(2)} ${currency}`;
  }
}

function formatDate(iso: string, language: SupportedLanguage): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const locale = language === "fr" ? "fr-FR" : "en-US";
  // Compact format for the panel: "5 mai 18:00" / "May 5, 6:00 PM"
  return new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}
