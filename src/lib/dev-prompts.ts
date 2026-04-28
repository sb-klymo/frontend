/**
 * Catalogue of one-click dev prompts surfaced by `<DevPanel>` for manual
 * chat testing.
 *
 * Each prompt has a French AND English variant — the dev panel shows
 * one or the other based on the FR/EN toggle. Categories map to the
 * conversational paths we care about exercising end-to-end:
 *
 *   - **Single-airport**: cities the extractor resolves directly (Marseille,
 *     Toulouse, Nice…). Skips the disambiguation turn — fastest path to
 *     OptionCards.
 *   - **Multi-airport**: cities flagged in PRODUCT_SPEC.md §6 that trigger
 *     the disambiguation node (Paris, London, NYC, Milan, Tokyo).
 *   - **Round-trip**: explicit return date so the OptionCards show two legs.
 *   - **Cross-pattern**: both endpoints multi-airport — exercises two
 *     consecutive disambiguation turns.
 *   - **Disambiguation answers**: bare IATA codes or city-name picks for
 *     the airport-clarification turn.
 *   - **Selection**: rank/price/airline-based replies after OptionCards
 *     arrive. Tests Tool 6 (`resolve_selection_intent`) live.
 *   - **Edge cases**: criteria changes, off-topic chatter, empty replies.
 *
 * This catalogue is dev-only — `<DevPanel>` is gated by NODE_ENV so the
 * import is dead-code-eliminated in production builds.
 */

import type { SupportedLanguage } from "./i18n";

export type LocalizedPrompt = Record<SupportedLanguage, string>;

export type DevPromptCategory = {
  /** Short stable identifier — used as React key + test selectors. */
  key: string;
  label: Record<SupportedLanguage, string>;
  prompts: LocalizedPrompt[];
};

export const DEV_PROMPT_CATEGORIES: DevPromptCategory[] = [
  {
    key: "single-airport",
    label: { fr: "Aéroport unique", en: "Single-airport" },
    prompts: [
      {
        fr: "j'habite à Marseille et je veux aller à Toulouse demain",
        en: "I live in Marseille and want to fly to Toulouse tomorrow",
      },
      {
        fr: "vol Nice → Bordeaux le 5 juin",
        en: "flight Nice to Bordeaux on June 5",
      },
      {
        fr: "je voudrais partir de Lyon pour Nantes vendredi prochain",
        en: "I'd like to fly from Lyon to Nantes next Friday",
      },
      {
        fr: "Marseille à Toulouse le 12 mai",
        en: "Marseille to Toulouse on May 12",
      },
    ],
  },
  {
    key: "multi-airport",
    label: { fr: "Aéroports multiples", en: "Multi-airport" },
    prompts: [
      {
        fr: "je veux partir de Paris pour aller à Marseille le 2 juin, propose moi des vols",
        en: "I want to fly from Paris to Marseille on June 2, show me flights",
      },
      {
        fr: "vol Londres → Toulouse demain",
        en: "flight London to Toulouse tomorrow",
      },
      {
        fr: "j'habite à Nice et je veux trouver un vol pour Londres",
        en: "I live in Nice and want to find a flight to London",
      },
      {
        fr: "Milan → Marseille la semaine prochaine",
        en: "Milan to Marseille next week",
      },
      {
        fr: "vol Tokyo → Nice le 20 juin",
        en: "flight Tokyo to Nice on June 20",
      },
    ],
  },
  {
    key: "cross-pattern",
    label: { fr: "Double ambiguïté", en: "Cross-pattern" },
    prompts: [
      {
        fr: "je veux aller de Paris à New York le 15 juin",
        en: "I want to go from Paris to New York on June 15",
      },
      {
        fr: "vol Londres → Milan le 10 juillet",
        en: "flight London to Milan on July 10",
      },
      {
        fr: "Paris → Tokyo le 1er août",
        en: "Paris to Tokyo on August 1",
      },
    ],
  },
  {
    key: "round-trip",
    label: { fr: "Aller-retour", en: "Round-trip" },
    prompts: [
      {
        fr: "Marseille → Toulouse le 1er juin, retour le 5 juin",
        en: "Marseille to Toulouse June 1, return June 5",
      },
      {
        fr: "aller-retour Paris ↔ NYC du 10 au 20 juin",
        en: "round trip Paris to NYC from June 10 to June 20",
      },
      {
        fr: "vol Lyon → Nice du 12 au 18 mai",
        en: "Lyon to Nice from May 12 to May 18",
      },
    ],
  },
  {
    key: "disambiguation-answers",
    label: { fr: "Choix d'aéroport", en: "Airport pick" },
    prompts: [
      { fr: "CDG", en: "CDG" },
      { fr: "ORY", en: "ORY" },
      { fr: "BVA", en: "BVA" },
      { fr: "JFK", en: "JFK" },
      { fr: "LHR", en: "LHR" },
      { fr: "MXP", en: "MXP" },
      { fr: "Charles de Gaulle", en: "Charles de Gaulle" },
      { fr: "Heathrow", en: "Heathrow" },
    ],
  },
  {
    key: "selection",
    label: { fr: "Choix d'option", en: "Selection" },
    prompts: [
      { fr: "option 1", en: "option 1" },
      { fr: "option 2", en: "option 2" },
      { fr: "option 3", en: "option 3" },
      { fr: "la moins chère", en: "the cheapest" },
      { fr: "la plus chère", en: "the most expensive" },
      { fr: "celui du matin", en: "the morning one" },
      { fr: "celui du soir", en: "the evening one" },
      { fr: "le vol Air Stub", en: "the Air Stub flight" },
      { fr: "Air Stub ou ByteFly ?", en: "Air Stub or ByteFly?" },
    ],
  },
  {
    key: "edge",
    label: { fr: "Cas limites", en: "Edge cases" },
    prompts: [
      {
        fr: "en fait change la date pour le 5 juin",
        en: "actually change the date to June 5",
      },
      {
        fr: "annule, recommence",
        en: "scratch that, start over",
      },
      {
        fr: "comment ça marche ?",
        en: "how does this work?",
      },
      {
        fr: "merci",
        en: "thanks",
      },
      {
        fr: "qu'est-ce qui est inclus ?",
        en: "what's included?",
      },
    ],
  },
];

/**
 * Pick a random prompt across all categories for the given language.
 * Returns null if the catalogue is somehow empty (defensive — categories
 * are static).
 */
export function pickRandomPrompt(
  categories: DevPromptCategory[],
  language: SupportedLanguage,
): string | null {
  const flat = categories.flatMap((cat) => cat.prompts);
  if (flat.length === 0) return null;
  const pick = flat[Math.floor(Math.random() * flat.length)];
  return pick ? pick[language] : null;
}
