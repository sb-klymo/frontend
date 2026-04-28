/**
 * OptionList — visual replacement for the assistant's text bubble when a
 * Step 5 (`present_options`) result arrives via the `event: options` SSE
 * frame. Renders the OptionCards stacked, with a header counting them and
 * a footer hinting at valid selection phrasings.
 *
 * Header / footer / card-badge text is localised via `lib/i18n` based on
 * the user's most recent message language (FR/EN heuristic). The bot's
 * *conversational* messages are localised by the backend's phrase()
 * helper; this is the static-string side of the same coin.
 */

import { strings, type SupportedLanguage } from "@/lib/i18n";
import type { DisplayedOffer } from "@/types/chat";

import { OptionCard } from "./OptionCard";

export type OptionListProps = {
  offers: DisplayedOffer[];
  language?: SupportedLanguage;
};

export function OptionList({ offers, language = "en" }: OptionListProps) {
  if (offers.length === 0) return null;

  const t = strings(language).optionList;

  return (
    <div className="flex justify-start">
      <div className="w-full max-w-[85%] space-y-2">
        <p className="text-sm text-gray-700">{t.header(offers.length)}</p>
        <div className="space-y-2">
          {offers.map((offer) => (
            <OptionCard key={offer.offer_id} offer={offer} language={language} />
          ))}
        </div>
        <p className="text-xs text-gray-500">
          {t.footerLeading}{" "}
          <span className="font-mono">&ldquo;{t.footerExampleRank}&rdquo;</span>,{" "}
          <span className="font-mono">&ldquo;{t.footerExampleCheapest}&rdquo;</span>,{" "}
          {t.footerByAirline}
        </p>
      </div>
    </div>
  );
}
