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
   * When `false`, all offers are blocked by policy and the list is read-only:
   * the interactive "reply option N" booking footer is suppressed, and the
   * backend-provided `footer` (adjust-criteria hint) is always shown.
   * Defaults to `true` (happy path, backward compatible when omitted).
   */
  selectable?: boolean;
};

export function OptionList({
  offers,
  language = "en",
  header,
  footer,
  selectable = true,
}: OptionListProps) {
  if (offers.length === 0) return null;

  const t = strings(language).optionList;

  return (
    <div className="flex justify-start">
      <div className="w-full max-w-[85%] space-y-2">
        <TextBubble>
          <p className="text-sm" data-testid="option-list-header">
            {header ?? t.header(offers.length)}
          </p>
        </TextBubble>
        <div className="space-y-2">
          {offers.map((offer) => (
            <OptionCard key={offer.offer_id} offer={offer} language={language} />
          ))}
        </div>
        {!selectable ? (
          // Read-only mode: show backend adjust-criteria hint (always present
          // when selectable=false), never the interactive booking footer.
          footer ? (
            <TextBubble>
              <p className="text-xs" data-testid="option-list-footer">
                {footer}
              </p>
            </TextBubble>
          ) : null
        ) : footer ? (
          <TextBubble>
            <p className="text-xs" data-testid="option-list-footer">
              {footer}
            </p>
          </TextBubble>
        ) : (
          <TextBubble>
            <p className="text-xs" data-testid="option-list-footer">
              {t.footerLeading}{" "}
              <span className="font-mono">&ldquo;{t.footerExampleRank}&rdquo;</span>,{" "}
              <span className="font-mono">&ldquo;{t.footerExampleCheapest}&rdquo;</span>,{" "}
              {t.footerByAirline}
            </p>
          </TextBubble>
        )}
      </div>
    </div>
  );
}

/**
 * Wraps option-list header/footer text in the same grey rounded bubble as
 * ChatWindow's assistant `Bubble`, so they read like other bot messages
 * (QA report 2026-05-25, bug #3). Left-aligned, hugs its content.
 */
function TextBubble({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex justify-start">
      <div className="max-w-[85%] rounded-2xl bg-gray-100 px-4 py-2 text-gray-900">
        {children}
      </div>
    </div>
  );
}
