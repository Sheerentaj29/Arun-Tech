/**
 * Shared Measurement Utilities
 * =================================
 *
 * Pure helpers used by BOTH the measurements API routes (POST + PUT) and
 * the PDF generator. Extracted from duplicated inline definitions to
 * guarantee the calculation rule stays identical everywhere.
 *
 * This module is pure (no Node imports) so it can be used from both
 * server and browser bundles.
 */

// ─── Measurement status enum ───
export const MEASUREMENT_STATUSES = ["Measured", "NotMeasured", "NotApplicable"] as const;
export type MeasurementStatus = (typeof MEASUREMENT_STATUSES)[number];

/**
 * Parse a numeric value from an unknown input (string, number, null, etc.).
 * Returns null for empty/null/NaN/negative values. Used by the API routes
 * to normalize clock-position measurement values before storage.
 */
export function parseNum(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "string" ? parseFloat(v) : (v as number);
  if (Number.isNaN(n) || n < 0) return null;
  return n;
}

/**
 * Normalize an unknown status string to a valid MeasurementStatus.
 *
 * @param s         The raw status value from the request body.
 * @param fallback  The status to use if `s` is not a valid enum value.
 *                  Defaults to "NotMeasured".
 */
export function normalizeMeasurementStatus(
  s: unknown,
  fallback: MeasurementStatus = "NotMeasured",
): MeasurementStatus {
  if (typeof s === "string" && MEASUREMENT_STATUSES.includes(s as MeasurementStatus)) {
    return s as MeasurementStatus;
  }
  return fallback;
}

/**
 * Compute the observed minimum thickness from valid (Measured) clock
 * readings. Excludes missing, NotMeasured, and NotApplicable values.
 * Returns null if no valid measurements exist (NEVER zero — zero would
 * be a dangerously misleading value for a thickness reading).
 *
 * This function is the SINGLE source of truth for observed-minimum
 * calculation. It is used by:
 *   - POST /api/.../measurements       (row creation)
 *   - PUT  /api/.../measurements/[mid] (row update)
 *   - The form view's local updateRow() (mirrors this logic)
 */
export function computeObservedMinimum(args: {
  northMm: number | null; northStatus: string;
  eastMm: number | null; eastStatus: string;
  southMm: number | null; southStatus: string;
  westMm: number | null; westStatus: string;
}): number | null {
  const values: number[] = [];
  for (const [val, status] of [
    [args.northMm, args.northStatus],
    [args.eastMm, args.eastStatus],
    [args.southMm, args.southStatus],
    [args.westMm, args.westStatus],
  ] as const) {
    if (status === "Measured" && val !== null && val !== undefined) {
      values.push(Number(val));
    }
  }
  if (values.length === 0) return null;
  return Math.min(...values);
}

/**
 * Format a measurement value + status for DISPLAY.
 *
 *   - NotApplicable → "N/A"
 *   - NotMeasured / null / undefined → "—"
 *   - Measured (with value) → value.toFixed(2)
 *
 * Used by BOTH the review/detail view (browser) and the PDF generator
 * (server). Extracted from duplicated inline definitions to guarantee
 * the formatting is identical everywhere.
 */
export function fmtMeasurement(v: number | null, status: string): string {
  if (status === "NotApplicable") return "N/A";
  if (status === "NotMeasured" || v === null || v === undefined) return "—";
  return v.toFixed(2);
}
