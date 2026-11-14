// ─── Vessel UT Thickness Measurement (VESSEL_UTM) shared row helpers ───
// Used by:
//   • the API routes (server-side normalization of the readings-row JSON
//     column — the Minimum Measured Thickness is always recomputed here,
//     never trusted from the client payload),
//   • the form view (live auto-calculation while typing),
//   • the review/detail view and the PDF generator (min re-computed from
//     the stored readings so it can never go stale).
//
// UNIFIED row shape (stored as a JSON string on PipelineInspection
// .vutmShellRows — the only readings column used by new reports):
//   [{ moc, componentType, componentId, nominalThickness,
//      c12: string[], c3: string[], c6: string[], c9: string[], min }]
//
//   • Each clock position (12 / 3 / 6 / 9 o'clock) holds ANY number of
//     readings — the form starts with ONE input slot per position and
//     the user can add / remove readings dynamically.
//   • min = Minimum Measured Thickness = minimum of ALL numeric readings
//     across the four clock positions of the row. Blank / non-numeric
//     readings are ignored; the stored value keeps the ORIGINAL text of
//     the minimum reading so the entered precision is preserved. When no
//     reading on the row is numeric the min is an empty string.
//
// LEGACY row shapes (written by earlier versions; converted transparently
// by normalizeVutmRows / vutmUnifiedRowsFromReport so existing saved
// reports keep every reading — nothing is lost):
//   • HORIZONTAL shell rows (clock positions with fixed Spot 1–4):
//       [{ moc, componentType, componentId, nominalThickness,
//          c12: [≤4 spots], c3: [...], c6: [...], c9: [...] }]
//   • VERTICAL shell rows (direction based, Spot 1–4):
//       [{ moc, componentType, direction, nominalThickness,
//          spot1, spot2, spot3, spot4 }]
//       → direction maps to a clock position using the same layout the
//         report always used: North→12 o'clock, East→3, South→6, West→9;
//         rows of the same component are merged into one unified row.
//   • Dish rows (legacy vutmDishRows column):
//       [{ component, direction, spot1..spot4 }]
//   • Nozzle rows (legacy vutmNozzleRows column):
//       [{ nozzleId, nominalThickness, size, schedule, moc, spot1..spot4 }]
//       → spots map to the four clock positions in order (12 / 3 / 6 / 9).

const CLOCK_KEYS = ["c12", "c3", "c6", "c9"] as const;

export type VutmClockKey = (typeof CLOCK_KEYS)[number];

export interface VutmRow {
  moc: string;
  componentType: string;
  componentId: string;
  nominalThickness: string;
  c12: string[];
  c3: string[];
  c6: string[];
  c9: string[];
  min: string;
}

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
 * Minimum Measured Thickness over one or more groups of readings.
 * Accepts plain reading strings and/or arrays of reading strings; blank
 * and non-numeric entries are ignored. Returns the original (trimmed)
 * text of the minimum reading so the user-entered precision is
 * preserved, or "" when there is no valid numeric reading at all.
 *
 * Example:
 *   vutmMinOfSpots(row.c12, row.c3, row.c6, row.c9)
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

// Direction → clock position mapping used when converting legacy
// VERTICAL rows (the same layout the app always displayed:
// north = 12 o'clock, east = 3 o'clock, south = 6 o'clock, west = 9).
const DIRECTION_TO_CLOCK: Record<string, VutmClockKey> = {
  north: "c12",
  east: "c3",
  south: "c6",
  west: "c9",
};

function legacyClockKeyForDirection(v: unknown): VutmClockKey | null {
  const s = toStr(v).toLowerCase();
  return DIRECTION_TO_CLOCK[s] ?? null;
}

/**
 * Normalize one clock-position readings array from untrusted JSON:
 * keeps every entry as a trimmed string and guarantees at least ONE
 * slot (the form always shows a single input per position initially).
 */
function normalizeReadingArray(v: unknown): string[] {
  if (Array.isArray(v)) {
    const arr = v.map((s) => toStr(s));
    return arr.length > 0 ? arr : [""];
  }
  // Legacy scalar (single spot value on a converted row).
  const s = toStr(v);
  return s ? [s] : [""];
}

/** Convert any legacy row shape (or a unified row) into a unified row. */
function legacyRowToUnified(r: Record<string, unknown>): VutmRow {
  const base: VutmRow = {
    moc: toStr(r.moc),
    componentType: toStr(r.componentType),
    componentId: toStr(r.componentId),
    nominalThickness: toStr(r.nominalThickness),
    c12: [""] as string[],
    c3: [""] as string[],
    c6: [""] as string[],
    c9: [""] as string[],
    min: "",
  };

  // Legacy VERTICAL shell row (direction + spot1..4).
  if (r.direction !== undefined && r.c12 === undefined) {
    const key = legacyClockKeyForDirection(r.direction) ?? "c12";
    base[key] = [
      toStr(r.spot1),
      toStr(r.spot2),
      toStr(r.spot3),
      toStr(r.spot4),
    ].filter((s) => s !== "");
    if (base[key].length === 0) base[key] = [""];
    // Legacy dish rows carry the component name in `component`.
    if (!base.componentType) base.componentType = toStr(r.component);
    base.min = vutmMinOfSpots(base.c12, base.c3, base.c6, base.c9);
    return base;
  }

  // Legacy NOZZLE row (nozzleId + spot1..4 → one reading per position,
  // in the 12 / 3 / 6 / 9 order).
  if (r.nozzleId !== undefined && r.c12 === undefined) {
    base.componentType = base.componentType || "Nozzle";
    base.componentId = base.componentId || toStr(r.nozzleId);
    base.nominalThickness = base.nominalThickness || toStr(r.nominalThickness);
    base.c12 = [toStr(r.spot1)];
    base.c3 = [toStr(r.spot2)];
    base.c6 = [toStr(r.spot3)];
    base.c9 = [toStr(r.spot4)];
    base.min = vutmMinOfSpots(base.c12, base.c3, base.c6, base.c9);
    return base;
  }

  // Unified (or legacy HORIZONTAL) row: clock arrays pass through.
  base.c12 = normalizeReadingArray(r.c12);
  base.c3 = normalizeReadingArray(r.c3);
  base.c6 = normalizeReadingArray(r.c6);
  base.c9 = normalizeReadingArray(r.c9);
  base.min = vutmMinOfSpots(base.c12, base.c3, base.c6, base.c9);
  return base;
}

function rowMergeKey(row: VutmRow): string {
  return [row.moc, row.componentType, row.componentId, row.nominalThickness]
    .map((s) => s.toLowerCase())
    .join("\u0001");
}

/** Concatenate two clock-reading arrays, dropping blank placeholder slots. */
function mergeClockReadings(a: string[], b: string[]): string[] {
  const merged = [...a, ...b].filter((s) => s !== "");
  return merged.length > 0 ? merged : [""];
}

/** Merge converted legacy rows of the same component into one row. */
function mergeUnifiedRows(rows: VutmRow[]): VutmRow[] {
  const merged: VutmRow[] = [];
  const byKey = new Map<string, VutmRow>();
  for (const row of rows) {
    const key = rowMergeKey(row);
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, row);
      merged.push(row);
      continue;
    }
    existing.c12 = mergeClockReadings(existing.c12, row.c12);
    existing.c3 = mergeClockReadings(existing.c3, row.c3);
    existing.c6 = mergeClockReadings(existing.c6, row.c6);
    existing.c9 = mergeClockReadings(existing.c9, row.c9);
    existing.min = vutmMinOfSpots(existing.c12, existing.c3, existing.c6, existing.c9);
  }
  return merged;
}

/**
 * Normalize the VESSEL_UTM readings-row JSON column (server-side source
 * of truth):
 *   • parses the incoming JSON string (invalid → null),
 *   • converts every legacy row shape (HORIZONTAL 4-spot rows, VERTICAL
 *     direction rows, dish rows, nozzle rows) into the unified shape,
 *     merging rows of the same component,
 *   • guarantees at least ONE reading slot per clock position,
 *   • recomputes `min` from the readings.
 *
 * Returns the normalized JSON string, or null when the input is not a
 * valid JSON array.
 */
export function normalizeVutmRows(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;
  const rows = mergeUnifiedRows(
    parsed.map((r) => legacyRowToUnified((r ?? {}) as Record<string, unknown>)),
  );
  return JSON.stringify(rows);
}

/**
 * Parse the stored VESSEL_UTM readings-row JSON column into unified row
 * objects (recomputing `min` so it can never go stale). Returns [] for
 * missing/invalid JSON.
 */
export function parseVutmRows(
  json: string | null | undefined,
): VutmRow[] {
  if (!json) return [];
  const normalized = normalizeVutmRows(json);
  if (!normalized) return [];
  try {
    const parsed: unknown = JSON.parse(normalized);
    return Array.isArray(parsed) ? (parsed as VutmRow[]) : [];
  } catch {
    return [];
  }
}

/**
 * Unified rows converted from the LEGACY vutmDishRows / vutmNozzleRows
 * columns (old reports keep their data; new reports save these columns
 * as "[]"). Returns [] for missing/invalid JSON.
 */
function legacyColumnToUnifiedRows(
  json: string | null | undefined,
  kind: "dish" | "nozzle",
): VutmRow[] {
  if (!json || !json.trim()) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed) || parsed.length === 0) return [];
  const rows = parsed.map((r) => {
    const base = legacyRowToUnified((r ?? {}) as Record<string, unknown>);
    if (kind === "dish") {
      base.componentType = base.componentType || toStr((r as Record<string, unknown>).component);
      base.moc = "";
      base.componentId = "";
      base.nominalThickness = "";
    }
    return base;
  });
  return mergeUnifiedRows(rows);
}

/**
 * All VESSEL_UTM readings as ONE unified list for display / PDF / form
 * editing: the unified vutmShellRows column plus any legacy data still
 * living in the vutmDishRows / vutmNozzleRows columns.
 */
export function vutmUnifiedRowsFromReport(
  shellJson: string | null | undefined,
  dishJson?: string | null | undefined,
  nozzleJson?: string | null | undefined,
): VutmRow[] {
  const rows = parseVutmRows(shellJson);
  if (dishJson || nozzleJson) {
    rows.push(
      ...legacyColumnToUnifiedRows(dishJson ?? null, "dish"),
      ...legacyColumnToUnifiedRows(nozzleJson ?? null, "nozzle"),
    );
  }
  return rows;
}

/** A fresh empty unified row: ONE reading slot per clock position. */
export function emptyVutmRow(): VutmRow {
  return {
    moc: "",
    componentType: "",
    componentId: "",
    nominalThickness: "",
    c12: [""],
    c3: [""],
    c6: [""],
    c9: [""],
    min: "",
  };
}

// Suggestion lists (not restrictions — custom values are always allowed).
export const VUTM_COMPONENT_TYPES = [
  "Shell",
  "Shell-1",
  "Shell-2",
  "Dish End",
  "Top Dish",
  "Bottom Dish",
  "Nozzle",
  "Custom Component",
];
export const VUTM_NOZZLE_ID_SUGGESTIONS = ["N1", "N2", "N3", "N4"];
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
