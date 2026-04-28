/**
 * OptionList — visual replacement for the assistant's text bubble when a
 * Step 5 (`present_options`) result arrives via the `event: options` SSE
 * frame. Renders the OptionCards stacked, with a header counting them and
 * a footer hinting at valid selection phrasings.
 *
 * The bot still emits the full formatted text via `event: message`, but
 * the chat UI suppresses that bubble for this turn — the cards present
 * the same information more cleanly.
 */

import type { DisplayedOffer } from "@/types/chat";

import { OptionCard } from "./OptionCard";

export type OptionListProps = {
  offers: DisplayedOffer[];
};

export function OptionList({ offers }: OptionListProps) {
  if (offers.length === 0) return null;

  return (
    <div className="flex justify-start">
      <div className="w-full max-w-[85%] space-y-2">
        <p className="text-sm text-gray-700">
          {offers.length === 1
            ? "Here is 1 option for your trip:"
            : `Here are ${offers.length} options for your trip:`}
        </p>
        <div className="space-y-2">
          {offers.map((offer) => (
            <OptionCard key={offer.offer_id} offer={offer} />
          ))}
        </div>
        <p className="text-xs text-gray-500">
          Reply with the one you want —{" "}
          <span className="font-mono">&ldquo;option 1&rdquo;</span>,{" "}
          <span className="font-mono">&ldquo;the cheapest&rdquo;</span>, or
          describe by airline.
        </p>
      </div>
    </div>
  );
}
