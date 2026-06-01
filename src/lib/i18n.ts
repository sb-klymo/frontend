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
  /\b(je|tu|nous|vous|pour|avec|dans|partir|aller|veux|voudrais|combien|quand|aujourd'hui|demain|moins|plus|aéroport|aeroport|comment|merci|annule|change|en fait|ça|cela|c'est|fait|premier|première|deuxième|troisième|bonjour|bonsoir|salut|coucou|oui|ouais|semaine|semaines|mois|jour|jours|soir|soirs|matin|matins|nuit|nuits|midi|minuit|prochain|prochaine|prochains|prochaines|dernier|derniers|du|des|au|aux|lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche|janvier|avril|mai|juin|juillet|septembre|octobre|novembre)\b/i;

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
    /** Localized reason shown on policy_blocked cards instead of the raw engine string. */
    blockedReason: string;
    /** Localized reason shown on manager_approval_required cards instead of the raw engine string. */
    managerApprovalReason: string;
    /** Localized reason shown on finance_approval_required cards instead of the raw engine string. */
    financeApprovalReason: string;
    // Twelve short month names used for the per-slice date line, e.g.
    // FR: "21 mai", EN: "May 21". Order: January (index 0) … December (11).
    monthNamesShort: readonly [
      string, string, string, string, string, string,
      string, string, string, string, string, string,
    ];
    // Phase 10 — duration + stops + layover row labels.
    // FR/EN parity for the SliceInfoRow under each flight slice.
    directLabel: string;
    stopsLabel: (n: number) => string;
    layoverIn: (duration: string, airport: string) => string;
    legLabelOutbound: string;
    legLabelReturn: string;
    // Phase 12 — refund/change condition badge labels.
    refundFree: string;
    refundNonRefundable: string;
    conditionUnknown: string;
    refundFee: (amount: string) => string;
  };
  bookingCard: {
    title: string;
    bookingReferenceLabel: string;
    passengerLabel: string;
    flightLabel: string;
    totalLabel: string;
    totalFlightTimeLabel: string;
    downloadLabel: string;
  };
  typingIndicator: {
    thinking: string;
    searching: string;
    presenting: string;
    booking: string;
  };
  cancellationCard: {
    title: string;
    bookingReferenceLabel: string;
    refundLabel: string;
    refundIdLabel: string;
    receiptNote: string;
  };
  onboardingCard: {
    title: string;
    subtitle: string;
    ctaLabel: string;
    note: string;
    // Morphed render state after the Stripe SetupIntent webhook
    // flips users.stripe_payment_method_id (Realtime in
    // useChatStream sets m.onboarding.completed=true). Same card,
    // green styling, no CTA.
    savedTitle: string;
    savedSubtitle: string;
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
    serverErrorTitle: string;
    serverErrorSubtitle: string;
    refundedTitle: string;
    refundedSubtitle: string;
    refundedAmountLabel: string;
  };
  paymentCanceled: {
    title: string;
    subtitle: string;
    returnToChatNote: string;
  };
  cardSetupSuccess: {
    title: string;
    subtitle: string;
    closeTabHint: string;
    fallbackLinkLabel: string;
  };
  approvalCard: {
    /** Status pill copy — pending */
    pendingStatus: string;
    /** Countdown prefix, e.g. "Expires in" */
    expiresInLabel: string;
    expiresInLessThanMinute: string;
    /** Approver list label */
    approversLabel: string;
    /** Policy reason label */
    policyReasonLabel: string;
    /** Amount label */
    amountLabel: string;
    /** Cancel button */
    cancelButtonLabel: string;
    cancellingLabel: string;
    /** Approved state */
    approvedTitle: string;
    approvedBy: (name: string) => string;
    /** Rejected state */
    rejectedTitle: string;
    rejectedReason: (reason: string) => string;
    /** Expired state */
    expiredTitle: string;
    expiredHint: string;
    /** Canceled/withdrawn state */
    canceledHeading: string;
    canceledTitle: string;
    /** Notice shown by the chat input while a booking awaits approval */
    inputBlockedNotice: string;
  };
  chatInput: {
    /** Default textarea placeholder */
    placeholder: string;
    /** Placeholder while a booking awaits manager approval */
    awaitingApprovalPlaceholder: string;
  };
  /**
   * Static onboarding welcome bubbles, shown by the frontend on an empty
   * chat while the user still has identity capture pending
   * (`/me.passenger_profile_complete === false`). Phase 15b moved these
   * out of the backend agent so they appear immediately on arrival,
   * before the user types anything. Markdown (`**bold**`) is rendered
   * the same way as assistant message bubbles.
   */
  onboardingWelcome: {
    /** Greeting / "what Klymo does" intro. */
    intro: string;
    /** "These details can't be edited later" warning. */
    warning: string;
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
    blockedReason: "Over your travel-policy cap",
    managerApprovalReason: "Manager approval required (above threshold)",
    financeApprovalReason: "Finance approval required (above threshold)",
    monthNamesShort: [
      "Jan", "Feb", "Mar", "Apr", "May", "Jun",
      "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
    ],
    directLabel: "Direct",
    stopsLabel: (n: number) => (n === 1 ? "1 stop" : `${n} stops`),
    layoverIn: (duration: string, airport: string) =>
      ` · ${duration} in ${airport}`,
    legLabelOutbound: "Outbound",
    legLabelReturn: "Return",
    refundFree: "Free cancellation",
    refundNonRefundable: "Non-refundable",
    conditionUnknown: "Conditions to confirm",
    refundFee: (amount: string) => `Cancellation fee ${amount}`,
  },
  bookingCard: {
    title: "Booking confirmed",
    bookingReferenceLabel: "Booking reference",
    passengerLabel: "Passenger",
    flightLabel: "Flight",
    totalLabel: "Total charged",
    totalFlightTimeLabel: "Total flight time",
    downloadLabel: "↓ Download ticket",
  },
  cancellationCard: {
    title: "Booking cancelled",
    bookingReferenceLabel: "Booking reference",
    refundLabel: "Refunded",
    refundIdLabel: "Refund ID",
    receiptNote: "The refund will land on your card in 5-10 business days.",
  },
  onboardingCard: {
    title: "Last step: save a card",
    subtitle: "Add a payment method to finish setting up your account.",
    ctaLabel: "Add payment method",
    note:
      "Card details are entered into Stripe's secure iframe — they never touch our server. You'll come straight back here when done.",
    savedTitle: "Payment method saved",
    savedSubtitle: "You're all set. Your conversation will continue here.",
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
    serverErrorTitle: "We couldn't load your receipt",
    serverErrorSubtitle:
      "Your payment may still have gone through — check back in a moment, or your chat tab for the latest status.",
    refundedTitle: "Booking failed — you've been refunded",
    refundedSubtitle:
      "We charged your card but couldn't complete the booking. The full amount has been returned automatically.",
    refundedAmountLabel: "Refunded",
  },
  paymentCanceled: {
    title: "Payment canceled",
    subtitle:
      "No charge was made. You can try again from your chat at any time.",
    returnToChatNote:
      "You can close this tab — your chat is still open in the original window.",
  },
  cardSetupSuccess: {
    title: "Card saved",
    subtitle:
      "Your payment method is ready. We've notified your chat — your conversation continues there.",
    closeTabHint: "You can close this tab.",
    fallbackLinkLabel: "Open the chat in this tab",
  },
  approvalCard: {
    pendingStatus: "Awaiting approval",
    expiresInLabel: "Expires in",
    expiresInLessThanMinute: "less than a minute",
    approversLabel: "Approvers",
    policyReasonLabel: "Policy reason",
    amountLabel: "Amount",
    cancelButtonLabel: "Cancel this request",
    cancellingLabel: "Cancelling…",
    approvedTitle: "Approved",
    approvedBy: (name: string) => `Approved by ${name}. Continuing your booking…`,
    rejectedTitle: "Rejected",
    rejectedReason: (reason: string) => `Rejected. Reason: ${reason}`,
    expiredTitle: "Request expired",
    expiredHint: "This request expired. Want to try a different option?",
    canceledHeading: "Canceled",
    canceledTitle: "Request withdrawn.",
    inputBlockedNotice:
      "Waiting for your manager's approval — you'll be notified as soon as they respond.",
  },
  chatInput: {
    placeholder: "Ask about a trip…",
    awaitingApprovalPlaceholder: "Waiting for manager approval…",
  },
  onboardingWelcome: {
    intro:
      "Four tabs. One personal card. A receipt in the wrong format. That's not a " +
      "booking process — that's your morning gone.\n\n" +
      "Klymo handles your entire business trip from this conversation — flight found, " +
      "hotel booked, card charged, invoice sent to finance before you put your phone down.\n\n" +
      "This is the last trip you'll ever book manually.",
    warning:
      "We'll need a few details to issue your tickets with the airlines. Double-check " +
      "each answer before sending, as they can't be changed afterwards.",
  },
  typingIndicator: {
    thinking: "Thinking…",
    searching: "Searching flights…",
    presenting: "Pulling the options together…",
    booking: "Finalizing your booking…",
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
    blockedReason: "Dépasse votre plafond de voyage",
    managerApprovalReason: "Approbation manager requise (au-dessus du seuil)",
    financeApprovalReason: "Approbation finance requise (au-dessus du seuil)",
    monthNamesShort: [
      "janv.", "févr.", "mars", "avr.", "mai", "juin",
      "juil.", "août", "sept.", "oct.", "nov.", "déc.",
    ],
    directLabel: "Direct",
    stopsLabel: (n: number) => (n === 1 ? "1 escale" : `${n} escales`),
    layoverIn: (duration: string, airport: string) =>
      ` · ${duration} à ${airport}`,
    legLabelOutbound: "Aller",
    legLabelReturn: "Retour",
    refundFree: "Annulation gratuite",
    refundNonRefundable: "Non remboursable",
    conditionUnknown: "Conditions à confirmer",
    refundFee: (amount: string) => `Annulation : ${amount} de frais`,
  },
  bookingCard: {
    title: "Réservation confirmée",
    bookingReferenceLabel: "Référence",
    passengerLabel: "Passager",
    flightLabel: "Vol",
    totalLabel: "Total prélevé",
    totalFlightTimeLabel: "Temps de vol total",
    downloadLabel: "↓ Télécharger le billet",
  },
  cancellationCard: {
    title: "Réservation annulée",
    bookingReferenceLabel: "Référence",
    refundLabel: "Remboursé",
    refundIdLabel: "ID remboursement",
    receiptNote: "Le remboursement apparaîtra sur votre carte sous 5-10 jours ouvrés.",
  },
  onboardingCard: {
    title: "Dernière étape : enregistrer une carte",
    subtitle: "Ajoutez un moyen de paiement pour finaliser votre compte.",
    ctaLabel: "Ajouter un moyen de paiement",
    note:
      "Les détails de la carte sont saisis dans l'iframe sécurisée Stripe, ils ne passent jamais par notre serveur. Vous reviendrez ici directement après.",
    savedTitle: "Moyen de paiement enregistré",
    savedSubtitle:
      "Tout est en place. Votre conversation continue ici.",
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
    serverErrorTitle: "Impossible de charger votre reçu",
    serverErrorSubtitle:
      "Votre paiement a peut-être abouti — réessayez dans un instant, ou consultez l'onglet de votre chat pour le statut à jour.",
    refundedTitle: "Réservation impossible — vous avez été remboursé",
    refundedSubtitle:
      "Votre carte a été débitée mais la réservation n'a pas pu être finalisée. La totalité du montant a été remboursée automatiquement.",
    refundedAmountLabel: "Remboursé",
  },
  paymentCanceled: {
    title: "Paiement annulé",
    subtitle: "Aucun montant n'a été prélevé. Vous pouvez réessayer depuis le chat.",
    returnToChatNote:
      "Vous pouvez fermer cet onglet — votre chat est toujours ouvert dans la fenêtre d'origine.",
  },
  cardSetupSuccess: {
    title: "Carte enregistrée",
    subtitle:
      "Votre moyen de paiement est prêt. Nous avons prévenu votre chat — votre conversation continue là-bas.",
    closeTabHint: "Vous pouvez fermer cet onglet.",
    fallbackLinkLabel: "Ouvrir le chat dans cet onglet",
  },
  approvalCard: {
    pendingStatus: "En attente de l'approbation",
    expiresInLabel: "Expire dans",
    expiresInLessThanMinute: "moins d'une minute",
    approversLabel: "Approbateurs",
    policyReasonLabel: "Motif politique",
    amountLabel: "Montant",
    cancelButtonLabel: "Annuler cette demande",
    cancellingLabel: "Annulation…",
    approvedTitle: "Approuvé",
    approvedBy: (name: string) => `Approuvé par ${name}. Votre réservation continue…`,
    rejectedTitle: "Refusé",
    rejectedReason: (reason: string) => `Refusé. Motif : ${reason}`,
    expiredTitle: "Demande expirée",
    expiredHint: "Cette demande a expiré. Voulez-vous essayer une autre option ?",
    canceledHeading: "Annulée",
    canceledTitle: "Demande retirée.",
    inputBlockedNotice:
      "En attente de l'approbation de votre manager — vous serez notifié dès sa réponse.",
  },
  chatInput: {
    placeholder: "Parlez-moi d'un voyage…",
    awaitingApprovalPlaceholder: "En attente de l'approbation du manager…",
  },
  onboardingWelcome: {
    intro:
      "Quatre onglets. Une carte personnelle. Un justificatif dans le mauvais format. " +
      "Ce n'est pas un processus de réservation c'est votre matinée qui part.\n\n" +
      "Klymo gère l'intégralité de votre voyage depuis cette conversation : vol trouvé, " +
      "hôtel réservé, carte débitée, facture envoyée à vos finances avant que vous posiez " +
      "votre téléphone.\n\n" +
      "C'est votre dernier voyage réservé manuellement.",
    warning:
      "On va vous demander quelques informations pour pouvoir émettre vos billets aux " +
      "normes des compagnies aériennes. Vérifiez bien chaque réponse avant de l'envoyer, " +
      "elles ne sont pas modifiables ensuite.",
  },
  typingIndicator: {
    thinking: "Réflexion en cours…",
    searching: "Recherche des vols…",
    presenting: "Préparation des options…",
    booking: "Finalisation de la réservation…",
  },
};

const DICTIONARY: Record<SupportedLanguage, Strings> = { en: EN, fr: FR };

export function strings(language: SupportedLanguage): Strings {
  return DICTIONARY[language];
}
