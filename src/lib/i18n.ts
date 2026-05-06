/**
 * Lightweight UI string localisation for the chat surface.
 *
 * The bot's *conversational* messages are localised by the backend's
 * `phrase()` helper (see `backend/src/agent/prompts/klymo_personality.py`).
 * But static React-rendered labels (OptionList header/footer, OptionCard
 * status badges, etc.) live in the frontend and need their own strings.
 *
 * Detection is heuristic: the most recent human message is scanned for
 * French-specific signals — accented characters or common French function
 * words. Cheap, deterministic, and good enough for FR/EN. When neither
 * signal fires, defaults to English.
 *
 * For richer localisation (more languages, plural rules, dates) move to
 * `next-intl` or `react-intl` — flagged as a Phase 3 polish item in
 * `docs/MVP_PLAN.md`. The shape of `STRINGS` below is meant to map
 * cleanly onto an i18n library when that day comes.
 */

export type SupportedLanguage = "fr" | "en";

const FRENCH_DIACRITICS = /[àâäéèêëîïôöùûüÿçœæ]/i;

// Common French function words. The word boundaries (`\b`) keep us from
// matching e.g. "je" inside "subject". Order/casing handled by the regex
// flags. We only need ONE hit to flip to French.
//
// MUST be kept in sync with backend
// `src/agent/prompts/klymo_personality.py::_FRENCH_FUNCTION_WORDS`.
// Only words with no realistic English overlap go in here, otherwise an
// English sentence containing the word would be mis-classified. "mars"
// is deliberately excluded (overlaps with the planet); diacritic months
// are caught by FRENCH_DIACRITICS instead of being duplicated here.
const FRENCH_FUNCTION_WORDS =
  /\b(je|tu|nous|vous|pour|avec|dans|partir|aller|veux|voudrais|combien|quand|aujourd'hui|demain|moins|plus|aéroport|aeroport|comment|merci|annule|change|en fait|ça|cela|c'est|fait|premier|première|deuxième|troisième|semaine|semaines|mois|jour|jours|soir|soirs|matin|matins|nuit|nuits|midi|minuit|prochain|prochaine|prochains|prochaines|dernier|derniers|du|des|au|aux|lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche|janvier|avril|mai|juin|juillet|septembre|octobre|novembre)\b/i;

export function detectLanguage(text: string | null | undefined): SupportedLanguage {
  if (!text) return "en";
  if (FRENCH_DIACRITICS.test(text)) return "fr";
  if (FRENCH_FUNCTION_WORDS.test(text)) return "fr";
  return "en";
}

type Strings = {
  optionList: {
    header: (count: number) => string;
    footerLeading: string;
    footerExampleRank: string;
    footerExampleCheapest: string;
    footerByAirline: string;
  };
  optionCard: {
    optionLabel: string;
    badgeApproved: string;
    badgeManagerApproval: string;
    badgeFinanceApproval: string;
    badgeBlocked: string;
  };
  bookingCard: {
    title: string;
    bookingReferenceLabel: string;
    passengerLabel: string;
    flightLabel: string;
    totalLabel: string;
    downloadLabel: string;
    emailNote: string;
  };
  checkoutCard: {
    title: string;
    amountLabel: string;
    payNowLabel: string;
    payNoteLabel: string;
    paidTitle: string;
    paidStatusLabel: string;
    paidStatusValue: string;
    paidNote: string;
  };
  paymentSuccess: {
    title: string;
    subtitle: string;
    amountLabel: string;
    statusLabel: string;
    bookingReferenceLabel: string;
    bookingPendingNote: string;
    returnToChatNote: string;
    notFoundTitle: string;
    notFoundSubtitle: string;
  };
  paymentCanceled: {
    title: string;
    subtitle: string;
    returnToChatNote: string;
  };
};

const EN: Strings = {
  optionList: {
    header: (n) =>
      n === 1 ? "Here is 1 option for your trip:" : `Here are ${n} options for your trip:`,
    footerLeading: "Reply with the one you want:",
    footerExampleRank: "option 1",
    footerExampleCheapest: "the cheapest",
    footerByAirline: "or describe by airline.",
  },
  optionCard: {
    optionLabel: "Option",
    badgeApproved: "✓ approved",
    badgeManagerApproval: "⚠ requires manager approval",
    badgeFinanceApproval: "⚠ requires finance approval",
    badgeBlocked: "✗ blocked",
  },
  bookingCard: {
    title: "Booking confirmed",
    bookingReferenceLabel: "Booking reference",
    passengerLabel: "Passenger",
    flightLabel: "Flight",
    totalLabel: "Total charged",
    downloadLabel: "↓ Download ticket",
    emailNote: "A copy is on its way to your inbox.",
  },
  checkoutCard: {
    title: "Complete your booking",
    amountLabel: "Amount",
    payNowLabel: "↗ Pay now",
    payNoteLabel: "Once paid, we'll email your ticket.",
    paidTitle: "Payment received",
    paidStatusLabel: "Status",
    paidStatusValue: "Paid",
    paidNote:
      "We're finalizing your booking. The reference will land in your inbox shortly.",
  },
  paymentSuccess: {
    title: "Payment received",
    subtitle: "Thanks — we've got your payment.",
    amountLabel: "Amount paid",
    statusLabel: "Status",
    bookingReferenceLabel: "Booking reference",
    bookingPendingNote:
      "We're finalizing your booking. The reference will land in your inbox shortly.",
    returnToChatNote:
      "You can close this tab — your chat is still open in the original window.",
    notFoundTitle: "Transaction not found",
    notFoundSubtitle:
      "We couldn't find this transaction. If you just paid, give it a moment and refresh.",
  },
  paymentCanceled: {
    title: "Payment canceled",
    subtitle:
      "No charge was made. You can try again from your chat at any time.",
    returnToChatNote:
      "You can close this tab — your chat is still open in the original window.",
  },
};

const FR: Strings = {
  optionList: {
    header: (n) =>
      n === 1 ? "Voici 1 option pour votre voyage :" : `Voici ${n} options pour votre voyage :`,
    footerLeading: "Répondez avec celle que vous voulez :",
    footerExampleRank: "option 1",
    footerExampleCheapest: "la moins chère",
    footerByAirline: "ou décrivez par compagnie.",
  },
  optionCard: {
    optionLabel: "Option",
    badgeApproved: "✓ approuvé",
    badgeManagerApproval: "⚠ approbation manager requise",
    badgeFinanceApproval: "⚠ approbation finance requise",
    badgeBlocked: "✗ bloqué",
  },
  bookingCard: {
    title: "Réservation confirmée",
    bookingReferenceLabel: "Référence",
    passengerLabel: "Passager",
    flightLabel: "Vol",
    totalLabel: "Total prélevé",
    downloadLabel: "↓ Télécharger le billet",
    emailNote: "Une copie arrive dans votre boîte mail.",
  },
  checkoutCard: {
    title: "Finalisez votre réservation",
    amountLabel: "Montant",
    payNowLabel: "↗ Payer maintenant",
    payNoteLabel: "Une fois le paiement effectué, nous vous enverrons votre billet.",
    paidTitle: "Paiement reçu",
    paidStatusLabel: "Statut",
    paidStatusValue: "Payé",
    paidNote:
      "Nous finalisons votre réservation. La référence vous sera envoyée par email sous peu.",
  },
  paymentSuccess: {
    title: "Paiement reçu",
    subtitle: "Merci — votre paiement est bien arrivé.",
    amountLabel: "Montant payé",
    statusLabel: "Statut",
    bookingReferenceLabel: "Référence",
    bookingPendingNote:
      "Nous finalisons votre réservation. La référence vous sera envoyée par email sous peu.",
    returnToChatNote:
      "Vous pouvez fermer cet onglet — votre chat est toujours ouvert dans la fenêtre d'origine.",
    notFoundTitle: "Transaction introuvable",
    notFoundSubtitle:
      "Nous n'avons pas trouvé cette transaction. Si vous venez de payer, patientez un instant et rafraîchissez.",
  },
  paymentCanceled: {
    title: "Paiement annulé",
    subtitle: "Aucun montant n'a été prélevé. Vous pouvez réessayer depuis le chat.",
    returnToChatNote:
      "Vous pouvez fermer cet onglet — votre chat est toujours ouvert dans la fenêtre d'origine.",
  },
};

const DICTIONARY: Record<SupportedLanguage, Strings> = { en: EN, fr: FR };

export function strings(language: SupportedLanguage): Strings {
  return DICTIONARY[language];
}
