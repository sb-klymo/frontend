"use client";

/**
 * `PaymentModeToggle` — binary opt-in for the auto-charge payment mode.
 *
 * Per `docs/ARCHITECTURE.md` §"Three Payment Modes", users opt into one of:
 *   1. auto-charge (saved card + automatic backend charge)
 *   2. checkout opt-in (saved card, but Stripe Checkout link per booking)
 *   3. checkout fallback (no saved card → Stripe Checkout link)
 *
 * Mode 3 is *not* a user choice — it's the absence-of-card state. So at
 * onboarding (where we are saving a card) the meaningful question is
 * binary: "Auto-charge ON" (mode 1) vs "Auto-charge OFF" (mode 2). The
 * fallback is implicit if the user never saves a card.
 *
 * Stateless — parent owns the value and the persistence path.
 */

type Props = {
  value: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
};

export function PaymentModeToggle({ value, onChange, disabled }: Props) {
  return (
    <div className="rounded-md border border-gray-200 bg-gray-50 p-4">
      <label className="flex cursor-pointer items-start gap-3">
        <input
          type="checkbox"
          checked={value}
          onChange={(e) => onChange(e.target.checked)}
          disabled={disabled}
          className="mt-1 h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
        />
        <span className="flex-1">
          <span className="block text-sm font-medium text-gray-900">
            Auto-charge bookings to this card
          </span>
          <span className="mt-1 block text-xs text-gray-600">
            When on, Klymo charges this card automatically as soon as you
            confirm a booking in chat. When off, Klymo will send you a
            checkout link to pay for each booking.
          </span>
        </span>
      </label>
    </div>
  );
}
