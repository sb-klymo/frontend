/**
 * Pure derivation for the payment-method page's initial auto-charge toggle
 * state. The checkbox is checked iff the user's persisted `payment_mode` is
 * `auto_charge`; every other value (`checkout_opt_in`, `checkout_fallback`,
 * unknown) and the missing/error case (null/undefined) → unchecked, so the
 * UI never promises auto-charge the user didn't choose.
 *
 * Extracted from the page Server Component so the branch logic is unit-testable
 * (Vitest can't render async Server Components).
 */
export function deriveInitialAutoCharge(
  paymentMode: string | null | undefined,
): boolean {
  return paymentMode === "auto_charge";
}
