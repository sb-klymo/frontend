/**
 * Duration formatting helpers shared between OptionCard (renders flight
 * leg duration from ISO-8601) and BookingConfirmationCard (renders total
 * flight time from minutes).
 *
 * Format mirrors what BookingConfirmationCard rendered before Phase 10:
 *   "2h 15min" / "1h" / "45 min" (FR) / "45min" (EN)
 *
 * Phase 10 R1: extracted from BookingConfirmationCard.tsx so OptionCard
 * can share it.
 */

import type { SupportedLanguage } from "@/lib/i18n";

/**
 * Parse an ISO-8601 duration string (e.g. "PT2H15M") to total minutes.
 * Returns 0 for invalid input — callers should check before rendering.
 */
export function parseISODuration(iso: string): number {
  if (!iso || !iso.startsWith("PT")) return 0;
  const body = iso.slice(2);
  let hours = 0;
  let minutes = 0;
  const hMatch = body.match(/(\d+)H/);
  if (hMatch && hMatch[1] !== undefined) hours = parseInt(hMatch[1], 10);
  const mMatch = body.match(/(\d+)M/);
  if (mMatch && mMatch[1] !== undefined) minutes = parseInt(mMatch[1], 10);
  return hours * 60 + minutes;
}

/**
 * Format a total minutes count to a human-readable string.
 *   135 → "2h 15min"
 *    60 → "1h"
 *    45 → "45 min" (fr) / "45min" (en)
 *     0 → ""
 */
export function formatMinutes(
  totalMinutes: number,
  language: SupportedLanguage,
): string {
  if (totalMinutes <= 0) return "";
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return language === "fr" ? `${minutes} min` : `${minutes}min`;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}min`;
}

/**
 * Convenience: parse ISO + format in one call.
 */
export function formatDuration(
  iso: string,
  language: SupportedLanguage,
): string {
  return formatMinutes(parseISODuration(iso), language);
}
