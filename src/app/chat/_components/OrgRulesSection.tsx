"use client";

/**
 * OrgRulesSection — dev-only live editor for the authenticated user's
 * organization policy rules.
 *
 * Reads + writes the same `organizations.policy_rules` JSONB the
 * policy engine consults in production. So changing the cap here
 * changes how the next chat search filters offers — the dev panel
 * doubles as a manual integration test for the rules.
 *
 * Lives behind the same dev gate as the rest of the panel
 * (`DEV_BUILD || isTeam`) and behind the BFF proxy at
 * `/api/dev/org/policy-rules` which forwards to the backend's
 * `_require_dev_env_or_team`-gated endpoints.
 *
 * Server state lives in TanStack Query per `frontend/CLAUDE.md`
 * invariant #1; the section is `enabled: open` so an unexpanded
 * section never fetches. The PATCH mutation invalidates the read
 * cache so the form re-flows from the server-returned canonical
 * value, catching any server-side clamping.
 *
 * Two affordances inside the section:
 *
 *   1. **Spend-cap editor** — number input + Save button + the four
 *      quick-set buttons (none / 200 / 500 / 1000). All paths hit
 *      the same PATCH endpoint; quick-sets are an ergonomic
 *      shortcut, not a separate UI mode.
 *
 *   2. **Spawn employee** — stubbed in PR-6 (the
 *      `POST /dev/org/employee` backend endpoint is deferred to a
 *      follow-up that needs the Supabase admin client + magic-link
 *      generation). Button reads "Coming soon" and is disabled.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import type { SupportedLanguage } from "@/lib/i18n";

// On-disk shape of `organizations.policy_rules`. Mirrors the backend
// `PolicyRules` Pydantic model — duplicated here (rather than imported
// from the generated SDK) so this section is robust to the order in
// which docs/openapi.json + frontend gen:api land in CI, same pattern
// as `IssuingCardsSection`.
type PolicyRules = {
  max_amount_per_trip_eur?: number | null;
};

// Quick-set buttons. `null` means "no cap configured" — the
// 'Aucun' / 'None' option clears the field entirely.
const QUICK_SET_AMOUNTS: { id: string; label: string; value: number | null }[] = [
  { id: "none", label: "—", value: null },
  { id: "200", label: "200 €", value: 200 },
  { id: "500", label: "500 €", value: 500 },
  { id: "1000", label: "1000 €", value: 1000 },
];

async function fetchPolicyRules(): Promise<PolicyRules> {
  const res = await fetch("/api/dev/org/policy-rules", { method: "GET" });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  return (await res.json()) as PolicyRules;
}

async function patchPolicyRules(rules: PolicyRules): Promise<PolicyRules> {
  const res = await fetch("/api/dev/org/policy-rules", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(rules),
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  return (await res.json()) as PolicyRules;
}

export function OrgRulesSection({
  language,
  open,
  onToggle,
}: {
  language: SupportedLanguage;
  open: boolean;
  onToggle: () => void;
}) {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ["dev", "org-policy-rules"],
    queryFn: fetchPolicyRules,
    enabled: open,
    // Dev panel — stale-fast. 30s avoids spamming when the user
    // clicks open/close repeatedly during debugging.
    staleTime: 30_000,
  });

  const mutation = useMutation({
    mutationFn: patchPolicyRules,
    onSuccess: (updated) => {
      // Echo the server-returned canonical value back into the cache
      // so the form re-renders from it. Don't optimistic-update — the
      // backend may clamp / coerce (e.g. integer truncation) and we
      // want the UI to reflect the real stored value.
      queryClient.setQueryData(["dev", "org-policy-rules"], updated);
    },
  });

  // Local draft state — populated from the server on first fetch,
  // edited freely by the user, committed on Save / quick-set.
  // Tracked separately from the query data so the user can type and
  // then either commit or abandon (re-fetch). Re-sync the draft
  // whenever the underlying query data changes (refetch, mutation
  // success, another tab editing concurrently) so a stale draft
  // doesn't shadow the canonical server value.
  //
  // The set-during-render pattern (vs `useEffect`) is the React-19
  // idiomatic way to derive state from an external store:
  // https://react.dev/reference/react/useState#storing-information-from-previous-renders.
  // The lint rule `react-hooks/set-state-in-effect` actively prefers
  // this shape.
  const [lastSeenData, setLastSeenData] = useState<PolicyRules | undefined>(undefined);
  const [draft, setDraft] = useState<string>("");
  if (query.data && query.data !== lastSeenData) {
    const cap = query.data.max_amount_per_trip_eur;
    setLastSeenData(query.data);
    setDraft(cap === null || cap === undefined ? "" : String(cap));
  }

  const labels =
    language === "fr"
      ? {
          heading: "Règles d'organisation",
          loading: "Chargement…",
          loadError: "Erreur de chargement",
          notOnboarded: "Aucune org configurée. Onboardez-vous d'abord.",
          capLabel: "Plafond par voyage",
          capPlaceholder: "Aucun plafond",
          save: "Enregistrer",
          saving: "…",
          quickSet: "Préréglages",
          spawnEmployee: "Créer un employé",
          spawnComingSoon: "Bientôt disponible",
          activeBadge: "Actif",
          saveError: "Erreur d'enregistrement",
          eurSuffix: "€",
        }
      : {
          heading: "Org rules",
          loading: "Loading…",
          loadError: "Failed to load",
          notOnboarded: "No organization configured. Onboard first.",
          capLabel: "Cap per trip",
          capPlaceholder: "No cap",
          save: "Save",
          saving: "…",
          quickSet: "Quick set",
          spawnEmployee: "Spawn employee",
          spawnComingSoon: "Coming soon",
          activeBadge: "Active",
          saveError: "Save failed",
          eurSuffix: "€",
        };

  // Active-badge logic: cap configured (not null) → section is
  // actively shaping the policy decisions. Same visual cue as
  // PolicySection's "Actif" pill.
  const activeBadge =
    query.data?.max_amount_per_trip_eur != null ? (
      <span
        className="rounded bg-violet-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-violet-800"
        data-testid="dev-org-rules-active-badge"
      >
        {labels.activeBadge}
      </span>
    ) : null;

  // 404 → user has no org. Distinct from other errors so we can render
  // an "onboard first" hint rather than a scary error message.
  const isNotOnboardedError =
    query.error instanceof Error && query.error.message.includes("404");

  function handleSave() {
    const parsed = draft.trim() === "" ? null : Number(draft.trim());
    if (parsed !== null && (!Number.isFinite(parsed) || parsed < 0)) {
      // Invalid input — bail. The native `<input type="number" min="0">`
      // already blocks most of this; the guard catches edge cases like
      // "1.5e-5" that parse but make no business sense.
      return;
    }
    mutation.mutate({ max_amount_per_trip_eur: parsed });
  }

  function handleQuickSet(value: number | null) {
    setDraft(value === null ? "" : String(value));
    mutation.mutate({ max_amount_per_trip_eur: value });
  }

  return (
    <section data-testid="dev-org-rules-section">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="mb-1.5 flex w-full items-center justify-between gap-2 text-left"
      >
        <span className="flex items-center gap-2">
          <h3 className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
            {labels.heading}
          </h3>
          {activeBadge}
        </span>
        <span aria-hidden="true" className="text-xs text-gray-400">
          {open ? "▾" : "▸"}
        </span>
      </button>

      {open && (
        <div className="space-y-2.5">
          {query.isPending && (
            <p
              className="text-[11px] italic text-gray-500"
              data-testid="dev-org-rules-loading"
            >
              {labels.loading}
            </p>
          )}

          {isNotOnboardedError && (
            <p
              className="rounded border border-amber-200 bg-amber-50 px-2 py-1.5 text-[11px] text-amber-800"
              data-testid="dev-org-rules-not-onboarded"
            >
              {labels.notOnboarded}
            </p>
          )}

          {query.isError && !isNotOnboardedError && (
            <p
              className="rounded border border-red-200 bg-red-50 px-2 py-1.5 text-[11px] text-red-700"
              data-testid="dev-org-rules-load-error"
            >
              {labels.loadError} —{" "}
              {query.error instanceof Error ? query.error.message : "Network error"}
            </p>
          )}

          {query.isSuccess && (
            <>
              {/* Editor row — number input + suffix + Save */}
              <div>
                <label
                  className="block text-[10px] uppercase tracking-wide text-gray-500"
                  htmlFor="dev-org-rules-cap-input"
                >
                  {labels.capLabel}
                </label>
                <div className="mt-0.5 flex items-center gap-1.5">
                  <div className="relative flex-1">
                    <input
                      id="dev-org-rules-cap-input"
                      type="number"
                      min="0"
                      inputMode="numeric"
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      placeholder={labels.capPlaceholder}
                      data-testid="dev-org-rules-cap-input"
                      className="w-full rounded border border-gray-300 bg-white px-2 py-1 pr-6 text-xs text-gray-900 focus:border-violet-400 focus:outline-none focus:ring-1 focus:ring-violet-400"
                    />
                    <span
                      aria-hidden="true"
                      className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-gray-400"
                    >
                      {labels.eurSuffix}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={handleSave}
                    disabled={mutation.isPending}
                    data-testid="dev-org-rules-save"
                    className="shrink-0 rounded border border-violet-500 bg-violet-50 px-2 py-1 text-[11px] font-medium text-violet-900 hover:bg-violet-100 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {mutation.isPending ? labels.saving : labels.save}
                  </button>
                </div>
              </div>

              {/* Quick-set row */}
              <div>
                <span className="block text-[10px] uppercase tracking-wide text-gray-500">
                  {labels.quickSet}
                </span>
                <div className="mt-0.5 grid grid-cols-4 gap-1">
                  {QUICK_SET_AMOUNTS.map((qs) => (
                    <button
                      key={qs.id}
                      type="button"
                      onClick={() => handleQuickSet(qs.value)}
                      disabled={mutation.isPending}
                      data-testid={`dev-org-rules-quick-${qs.id}`}
                      className="rounded border border-gray-300 bg-white px-1.5 py-1 text-[10px] text-gray-700 hover:border-violet-400 hover:bg-violet-50 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {qs.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Save error (mutation failure path, distinct from load error) */}
              {mutation.isError && (
                <p
                  className="rounded border border-red-200 bg-red-50 px-2 py-1.5 text-[11px] text-red-700"
                  data-testid="dev-org-rules-save-error"
                >
                  {labels.saveError} —{" "}
                  {mutation.error instanceof Error
                    ? mutation.error.message
                    : "Network error"}
                </p>
              )}
            </>
          )}

          {/* Spawn employee — disabled stub until PR-5b backend lands */}
          <div className="border-t border-gray-200 pt-2">
            <button
              type="button"
              disabled
              title={labels.spawnComingSoon}
              data-testid="dev-org-rules-spawn-employee"
              className="w-full cursor-not-allowed rounded border border-gray-200 bg-gray-50 px-2 py-1.5 text-[11px] text-gray-400"
            >
              {labels.spawnEmployee} · {labels.spawnComingSoon}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
