/**
 * Policy presets for the dev panel.
 *
 * The chat backend accepts an optional `dev_policy_override` on each
 * request which is honored only outside production. Presets here are
 * one-click configurations the developer can swap mid-conversation to
 * exercise the policy engine's hard / soft / auto branches in the
 * actual chat UI — without spinning up a real org or DB row.
 *
 * Stub Duffel returns three offers at 45_000 / 54_000 / 62_000 cents
 * (450 / 540 / 620 EUR). Preset thresholds are tuned around those
 * amounts so each preset produces a visibly different mix on screen.
 */
import type { OrgPolicySettings } from "@/lib/api/generated/types.gen";

export type PolicyPresetId =
  | "none"
  | "mixed_verdict"
  | "block_expensive"
  | "manager_only"
  | "train_preferred";

export type PolicyPreset = {
  id: PolicyPresetId;
  label: { fr: string; en: string };
  hint: { fr: string; en: string };
  /**
   * `null` means "no override" — the backend leaves the empty
   * OrgPolicySettings default in place and every offer auto-approves.
   * Distinct from `{}` which the backend would honor as an explicit
   * override (and produce the same effect, but pollute the request
   * body and logs unnecessarily).
   */
  config: OrgPolicySettings | null;
};

export const POLICY_PRESETS: PolicyPreset[] = [
  {
    id: "none",
    label: { fr: "Aucune", en: "None" },
    hint: {
      fr: "Pas de politique : tout est auto-approuvé",
      en: "No policy: everything auto-approved",
    },
    config: null,
  },
  {
    id: "mixed_verdict",
    label: { fr: "Verdict mixte", en: "Mixed verdict" },
    hint: {
      fr: "Manager 400 € · Finance 600 € — chaque vol a un verdict différent",
      en: "Manager 400€ · Finance 600€ — every offer gets a different verdict",
    },
    config: {
      manager_approval_threshold_cents: 40_000,
      finance_approval_threshold_cents: 60_000,
    },
  },
  {
    id: "block_expensive",
    label: { fr: "Bloquer > 500 €", en: "Block above 500€" },
    hint: {
      fr: "Plafond 500 € — seul le vol le moins cher passe",
      en: "Cap 500€ — only the cheapest passes",
    },
    config: {
      spend_cap_cents: 50_000,
    },
  },
  {
    id: "manager_only",
    label: { fr: "Approbation manager", en: "Manager approval" },
    hint: {
      fr: "Seuil 300 € — tous les vols passent en validation manager",
      en: "300€ threshold — every offer routes to manager approval",
    },
    config: {
      manager_approval_threshold_cents: 30_000,
    },
  },
  {
    id: "train_preferred",
    label: { fr: "Train préféré < 3h", en: "Train preferred < 3h" },
    hint: {
      fr: "Vols courts → validation manager (règle soft warn_train_preferred)",
      en: "Short flights → manager approval (warn_train_preferred soft rule)",
    },
    config: {
      prefer_train_under_hours: 3,
    },
  },
];

export function findPreset(id: PolicyPresetId): PolicyPreset {
  // Static lookup — every id in the type is in the array.
  const preset = POLICY_PRESETS.find((p) => p.id === id);
  if (!preset) throw new Error(`Unknown policy preset: ${id}`);
  return preset;
}
