/**
 * Layover-duration classifier for Phase 10 R2 color coding on OptionCard.
 *
 * Thresholds (per design spec §3.7):
 *   <60min       → "tight"   (short-connection risk)
 *   60min..300min → "normal"  (default gray)
 *   >300min       → "long"    (boring layover)
 */

import { parseISODuration } from "./duration";

export type LayoverLevel = "tight" | "normal" | "long";

const TIGHT_THRESHOLD_MIN = 60;
const LONG_THRESHOLD_MIN = 300;

export function classifyLayover(iso: string): LayoverLevel {
  const minutes = parseISODuration(iso);
  if (minutes < TIGHT_THRESHOLD_MIN) return "tight";
  if (minutes > LONG_THRESHOLD_MIN) return "long";
  return "normal";
}

/**
 * Tailwind class for the layover-duration span. Warning levels share
 * the same orange treatment; "normal" is the default gray text the rest
 * of the row uses.
 */
export function layoverClassName(level: LayoverLevel): string {
  if (level === "tight" || level === "long") return "text-orange-600";
  return "text-gray-500";
}
