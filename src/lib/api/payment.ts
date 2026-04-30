/**
 * Typed client wrappers for the payment domain.
 *
 * Calls go through the Next.js BFF (`/api/payment/...`) so the Supabase JWT
 * stays server-side. Response types are sourced from the auto-generated
 * OpenAPI client (`@/lib/api/generated`) so a backend schema change shows
 * up as a TypeScript error here on the next `npm run gen:api`.
 */

import type { SetupIntentResponse } from "@/lib/api/generated/types.gen";

export class PaymentApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "PaymentApiError";
  }
}

export async function createSetupIntent(): Promise<SetupIntentResponse> {
  const response = await fetch("/api/payment/setup-intent", {
    method: "POST",
    headers: { Accept: "application/json" },
  });

  if (!response.ok) {
    const detail = await response.json().catch(() => ({
      code: "unknown_error",
      message: `HTTP ${response.status}`,
    }));
    throw new PaymentApiError(
      response.status,
      detail.code ?? "unknown_error",
      detail.message ?? `HTTP ${response.status}`,
    );
  }

  return (await response.json()) as SetupIntentResponse;
}
