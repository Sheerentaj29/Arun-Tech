// ─── Vessel UT Thickness Measurement (VESSEL_UTM) shared row helpers ───
// Used by:
//   • the API routes (server-side normalization of the readings-row JSON
//     columns — the Minimum Measured Thickness is always recomputed here,
//     never trusted from the client payload),
//   • the form view (live auto-calculation while typing),
//   • the review/detail view and the PDF generator (min re-computed from
//     the stored spot readings so it can never go stale).
//
// Row shapes (stored as JSON strings on PipelineInspection):
//   • Shell rows, HORIZONTAL vessels (clock-position based):
//       [{ moc, componentType, componentId, nominalThickness,
//          c12: [4 spots], c3: [4 spots], c6: [4 spots], c9: [4 spots], min }]
//   • Shell rows, VERTICAL vessels (direction based):
//       [{ moc, componentType, direction, nominalThickness,
//          spot1, spot2, spot3, spot4, min }]
//   • Dish rows (Top Dish / Bottom Dish, direction based):
//       [{ component, direction, spot1..spot4, min }]
//   • Nozzle rows:
//       [{ nozzleId, nominalThickness, size, schedule, moc,
//          spot1..spot4, min }]
//
// `min` = Minimum Measured Thickness = minimum of the numeric spot
// readings on the row. Blank / non-numeric spots are ignored; the stored
// value keeps the ORIGINAL text of the minimum reading so the entered
// precision is preserved. When no spot on the row has a numeric reading
// the min is an empty string.

const CLOCK_KEYS = ["c12", "c3", "c6", "c9"] as const;
const SPOT_KEYS = ["spot1", "spot2", "spot3", "spot4"] as const;
const DIRECTIONS = ["East", "West", "North", "South"] as const;

function toStr(v: unknown): string {
  if (v === null || v === undefined) return "";
  return String(v).trim();
}

function parseSpotNumber(v: unknown): number | null {
  const s = toStr(v);
  if (!s) return null;
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

/**
 * Minimum Measured Thickness over one or more groups of spot readings.
 * Accepts plain spot strings and/or arrays of spot strings; blank and
 * non-numeric entries are ignored. Returns the original (trimmed) text
 * of the minimum reading so the user-entered precision is preserved, or
 * "" when there is no valid numeric reading at all.
 *
 * Example:
 *   vutmMinOfSpots(row.c12, row.c3, row.c6, row.c9)  // horizontal shell
 *   vutmMinOfSpots(row.spot1, row.spot2, row.spot3, row.spot4) // others
 */
export function vutmMinOfSpots(
  ...groups: Array<string | string[] | null | undefined>
): string {
  const flat: string[] = [];
  for (const g of groups) {
    if (Array.isArray(g)) {
      for (const s of g) flat.push(toStr(s));
    } else if (g !== null && g !== undefined) {
      flat.push(toStr(g));
    }
  }
  let minVal: number | null = null;
  let minRaw = "";
  for (const s of flat) {
    const n = parseSpotNumber(s);
    if (n === null) continue;
    if (minVal === null || n < minVal) {
      minVal = n;
      minRaw = s;
    }
  }
  return minRaw;
}

function normalizeDirection(v: unknown): string {
  const s = toStr(v);
  const match = DIRECTIONS.find(
    (d) => d.toLowerCase() === s.toLowerCase(),
  );
  return match ?? "";
}

function normalizeSpotArray(v: unknown): string[] {
  const arr = Array.isArray(v) ? v : [];
  return CLOCK_KEYS.map((_, i) => toStr(arr[i]));
}

export interface VutmNormalizeOptions {
  kind: "shell" | "dish" | "nozzle";
  /** Only meaningful for kind = "shell" (row shape differs). */
  orientation?: "HORIZONTAL" | "VERTICAL" | null;
}

/**
 * Normalize one of the VESSEL_UTM readings-row JSON columns:
 *   • parses the incoming JSON string (invalid → null),
 *   • coerces every expected field to a trimmed string,
 *   • clamps directions to East / West / North / South,
 *   • pads/truncates clock-position arrays to exactly 4 spots,
 *   • recomputes `min` from the spot readings (server-side source of
 *     truth for Minimum Measured Thickness).
 *
 * Returns the normalized JSON string, or null when the input is not a
 * valid JSON array.
 */
export function normalizeVutmRows(
  raw: unknown,
  opts: VutmNormalizeOptions,
): string | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;

  const rows: Array<Record<string, string | string[]>> = parsed.map(
    (r: Record<string, unknown>) => {
      if (opts.kind === "shell" && opts.orientation === "HORIZONTAL") {
        const clock: Record<string, string[]> = {};
        for (const k of CLOCK_KEYS) clock[k] = normalizeSpotArray(r[k]);
        return {
          moc: toStr(r.moc),
          componentType: toStr(r.componentType),
          componentId: toStr(r.componentId),
          nominalThickness: toStr(r.nominalThickness),
          ...clock,
          min: vutmMinOfSpots(clock.c12, clock.c3, clock.c6, clock.c9),
        };
      }
      if (opts.kind === "shell") {
        // VERTICAL shell row (direction based).
        const spots: Record<string, string> = {};
        for (const k of SPOT_KEYS) spots[k] = toStr(r[k]);
        return {
          moc: toStr(r.moc),
          componentType: toStr(r.componentType),
          direction: normalizeDirection(r.direction),
          nominalThickness: toStr(r.nominalThickness),
          ...spots,
          min: vutmMinOfSpots(spots.spot1, spots.spot2, spots.spot3, spots.spot4),
        };
      }
      if (opts.kind === "dish") {
        const spots: Record<string, string> = {};
        for (const k of SPOT_KEYS) spots[k] = toStr(r[k]);
        return {
          component: toStr(r.component),
          direction: normalizeDirection(r.direction),
          ...spots,
          min: vutmMinOfSpots(spots.spot1, spots.spot2, spots.spot3, spots.spot4),
        };
      }
      // Nozzle row.
      const spots: Record<string, string> = {};
      for (const k of SPOT_KEYS) spots[k] = toStr(r[k]);
      return {
        nozzleId: toStr(r.nozzleId),
        nominalThickness: toStr(r.nominalThickness),
        size: toStr(r.size),
        schedule: toStr(r.schedule),
        moc: toStr(r.moc),
        ...spots,
        min: vutmMinOfSpots(spots.spot1, spots.spot2, spots.spot3, spots.spot4),
      };
    },
  );

  return JSON.stringify(rows);
}

/**
 * Parse one of the stored VESSEL_UTM readings-row JSON columns back into
 * an array of row objects (recomputing `min` so it can never go stale).
 * Returns [] for missing/invalid JSON.
 */
export function parseVutmRows(
  json: string | null | undefined,
  opts: VutmNormalizeOptions,
): Array<Record<string, string | string[]>> {
  if (!json) return [];
  const normalized = normalizeVutmRows(json, opts);
  if (!normalized) return [];
  try {
    const parsed = JSON.parse(normalized);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// Suggestion lists (not restrictions — custom values are always allowed).
export const VUTM_SHELL_COMPONENTS_HORIZONTAL = [
  "Shell",
  "Shell-1",
  "Shell-2",
  "Dish End",
  "Top Dish",
  "Bottom Dish",
  "Nozzle",
];
export const VUTM_SHELL_COMPONENTS_VERTICAL = [
  "Shell-1",
  "Shell-2",
  "Shell-3",
  "Top Dish",
  "Bottom Dish",
  "Nozzle",
];
export const VUTM_DISH_COMPONENTS = ["Top Dish", "Bottom Dish", "Dish End"];
export const VUTM_NOZZLE_ID_SUGGESTIONS = ["N1", "N2", "N3", "N4"];
export const VUTM_DIRECTIONS = [...DIRECTIONS];
export const VUTM_MOC_SUGGESTIONS = [
  "Carbon Steel",
  "Carbon Steel (LTCS)",
  "Stainless Steel SS304",
  "Stainless Steel SS304L",
  "Stainless Steel SS316",
  "Stainless Steel SS316L",
  "Duplex SS",
  "Alloy Steel",
  "Other",
];
export const VUTM_METHOD_SUGGESTIONS = [
  "Contact Pulse Echo",
  "Contact",
  "Immersion",
];
export const VUTM_COUPLANT_SUGGESTIONS = [
  "Gel",
  "Oil",
  "Glycerine",
  "Water",
  "Grease",
];
export const VUTM_CRYSTAL_SUGGESTIONS = [
  "Dual Element",
  "Single Element",
];
