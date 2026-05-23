/**
 * OptionList — visual replacement for the assistant's text bubble when a
 * Step 5 (`present_options`) result arrives via the `event: options` SSE
 * frame. Renders the OptionCards stacked, with a header counting them and
 * a footer hinting at valid selection phrasings.
 *
 * Header / footer prefer the rephrased text from the backend `phrase()`
 * helper (passed via SSE on the `event: options` frame and threaded
 * through `useChatStream::attachOffers`). When that's absent (no API
 * key in dev, LLM error, older backend), the static i18n strings from
 * `lib/i18n` take over so the chat stays usable.
 *
 * Why backend-rephrased: the static i18n header was the same exact
 * string for every user on every turn ("Voici 3 options pour votre
 * voyage :"), which contributed to the chatbot's robotic feel. The
 * rephraser sees the user's actual request + the bot's recent turns
 * and produces contextual, varied output ("MRS → TLS demain en éco,
 * voici 3 vols :", "Pour ton trajet à Toulouse :", etc.).
 */

import { strings, type SupportedLanguage } from "@/lib/i18n";
import type { DisplayedOffer } from "@/types/chat";

import { OptionCard } from "./OptionCard";

export type OptionListProps = {
  offers: DisplayedOffer[];
  language?: SupportedLanguage;
  /** Backend-rephrased header text. Falls back to i18n when absent. */
  header?: string;
  /** Backend-rephrased footer text. Falls back to i18n when absent. */
  footer?: string;
  /**
   * One-way default opt-in (phase 10e). Rendered as a distinct paragraph
   * ABOVE the header when `state.trip_type_inferred` is True on the
   * backend (extract_node defaulted trip_type to one_way because the LLM
   * left it unresolved). Absent on user-explicit trip-type paths and on
   * non-options turns.
   */
  disclaimer?: string;
};

export function OptionList({
  offers,
  language = "en",
  header,
  footer,
  disclaimer,
}: OptionListProps) {
  if (offers.length === 0) return null;

  const t = strings(language).optionList;

  return (
    <div className="flex justify-start">
      <div className="w-full max-w-[85%] space-y-2">
        {disclaimer ? (
          <p
            className="text-sm text-gray-700"
            data-testid="option-list-disclaimer"
          >
            {disclaimer}
          </p>
        ) : null}
        <p className="text-sm text-gray-700" data-testid="option-list-header">
          {header ?? t.header(offers.length)}
        </p>
        <div className="space-y-2">
          {offers.map((offer) => (
            <OptionCard key={offer.offer_id} offer={offer} language={language} />
          ))}
        </div>
        {footer ? (
          <p className="text-xs text-gray-500" data-testid="option-list-footer">
            {footer}
          </p>
        ) : (
          <p className="text-xs text-gray-500" data-testid="option-list-footer">
            {t.footerLeading}{" "}
            <span className="font-mono">&ldquo;{t.footerExampleRank}&rdquo;</span>,{" "}
            <span className="font-mono">&ldquo;{t.footerExampleCheapest}&rdquo;</span>,{" "}
            {t.footerByAirline}
          </p>
        )}
      </div>
    </div>
  );
}
