"use client";

import { useState } from "react";
import type { SupportedLanguage } from "@/lib/i18n";

export type PaymentConfirmationDetails = {
  trip_id: string;
  amount_cents: number;
  currency: string;
};

export type PaymentConfirmationCardProps = {
  paymentConfirmation: PaymentConfirmationDetails;
  language?: SupportedLanguage;
  onDecision?: (decision: "confirmed" | "canceled") => void;
};

export function PaymentConfirmationCard({
  paymentConfirmation,
  language = "en",
  onDecision,
}: PaymentConfirmationCardProps) {
  const [busy, setBusy] = useState(false);
  const amount = (paymentConfirmation.amount_cents / 100).toFixed(2);
  const ccy = paymentConfirmation.currency.toUpperCase();
  const t =
    language === "fr"
      ? { title: "Confirmer le paiement", total: "Total", pay: "Vérifier & payer", cancel: "Annuler" }
      : { title: "Confirm payment", total: "Total", pay: "Review & pay", cancel: "Cancel" };

  function decide(decision: "confirmed" | "canceled") {
    if (busy) return;
    setBusy(true);
    onDecision?.(decision);
  }

  return (
    <div
      className="rounded-lg border border-amber-200 bg-amber-50 p-4 shadow-sm"
      data-testid="payment-confirmation-card"
      role="group"
    >
      <h3 className="text-sm font-semibold text-amber-900">{t.title}</h3>
      <p className="mt-2 text-sm text-gray-800">
        {t.total}: <span className="font-semibold">{amount} {ccy}</span>
      </p>
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => decide("confirmed")}
          className="rounded-md bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          {t.pay}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => decide("canceled")}
          className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          {t.cancel}
        </button>
      </div>
    </div>
  );
}
