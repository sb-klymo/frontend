/**
 * Voice presets for the dev panel.
 *
 * The chat backend accepts an optional `dev_vibe_override` on each
 * request which is honoured outside production (or for team-allowlisted
 * users in production). Presets here let the developer A/B Klymo's
 * "playful" register against the "classic" (neutral) one mid-conversation
 * without restarting anything.
 *
 * Failure and reassure situations on the backend always force neutral
 * regardless of this override — a card decline never gets the playful
 * register. So the toggle's effect is visible on routine + success
 * turns (asks, options, confirmations), not on errors or restarts.
 */

/**
 * Mirror of `backend/src/agent/prompts/klymo_personality.py::Vibe`.
 * Keep in sync. The generated OpenAPI types will pick this up after the
 * next `npm run gen:api` — until then, declare it explicitly here.
 */
export type Vibe = "neutral" | "playful";

export type VoicePresetId = "default" | "classic";

export type VoicePreset = {
  id: VoicePresetId;
  label: { fr: string; en: string };
  hint: { fr: string; en: string };
  /**
   * `null` means "no override" — the backend uses its module-level
   * default (`playful`). Distinct from `"playful"` which would send
   * the same effective behaviour but pollute the request body and logs
   * unnecessarily.
   */
  config: Vibe | null;
};

export const VOICE_PRESETS: VoicePreset[] = [
  {
    id: "default",
    label: { fr: "Par défaut", en: "Default" },
    hint: {
      fr: "Vibe \"playful\" — chaleureuse, légère, ton décontracté",
      en: 'Playful vibe — warm, light, casual register',
    },
    config: null,
  },
  {
    id: "classic",
    label: { fr: "Classique", en: "Classic" },
    hint: {
      fr: "Vibe \"neutral\" — concierge poli, sans humour",
      en: "Neutral vibe — polished concierge, no wit",
    },
    config: "neutral",
  },
];

export function findVoicePreset(id: VoicePresetId): VoicePreset {
  const preset = VOICE_PRESETS.find((p) => p.id === id);
  if (!preset) throw new Error(`Unknown voice preset: ${id}`);
  return preset;
}
