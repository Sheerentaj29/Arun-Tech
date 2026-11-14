// ─── Vessel UT Thickness Measurement (VESSEL_UTM) shared row helpers ───
// Used by:
//   • the API routes (server-side normalization of the readings-row JSON
//     column — the Minimum Measured Thickness is always recomputed here,
//     never trusted from the client payload),
//   • the form view (live auto-calculation while typing),
//   • the review/detail view and the PDF generator (min re-computed from
//     the stored readings so it can never go stale).
//
// The VESSEL_UTM readings structure depends on the vessel orientation
// (selected in the report-creation flow — VESSEL_UTM ONLY; no other
// module asks for an orientation). Both shapes are stored in the
// vutmShellRows JSON column, tagged by their keys:
//
//   • HORIZONTAL rows — clock-position based (12 / 3 / 6 / 9 o'clock):
//       [{ moc, componentType, componentId, nominalThickness,
//          c12: string[], c3: string[], c6: string[], c9: string[], min }]
//   • VERTICAL rows — direction based (East / West / North / South):
//       [{ moc, componentType, componentId, nominalThickness,
//          direction: "East"|"West"|"North"|"South",
//          readings: string[], min }]
//
//   • Every clock position / direction starts with ONE reading slot and
//     can grow dynamically ("+ Add Reading") — the arrays are never
//     padded to a fixed length.
//   • min = Minimum Measured Thickness = minimum of ALL numeric readings
//     of the row (across the four clock positions for horizontal rows).
//     Blank / non-numeric readings are ignored; the stored value keeps
//     the ORIGINAL text of the minimum reading so the entered precision
//     is preserved. When no reading is numeric the min is an empty
//     string.
//   • Reports created before an orientation was stored (vesselOrientation
//     null) are rendered as HORIZONTAL (clock positions), which matches
//     the clock-array rows they contain.
//
// LEGACY row shapes (written by earlier versions; converted
// transparently so existing saved reports keep every reading — nothing
// is lost):
//   • HORIZONTAL shell rows with fixed Spot 1–4 per clock position:
//       [{ moc, componentType, componentId, nominalThickness,
//          c12: [≤4 spots], c3: [...], c6: [...], c9: [...] }]
//   • VERTICAL shell rows (direction + fixed Spot 1–4):
//       [{ moc, componentType, direction, nominalThickness,
//          spot1, spot2, spot3, spot4 }]
//   • Dish rows (legacy vutmDishRows column):
//       [{ component, direction, spot1..spot4 }]
//   • Nozzle rows (legacy vutmNozzleRows column):
//       [{ nozzleId, nominalThickness, size, schedule, moc, spot1..spot4 }]
//     Horizontal: spots map to the four clock positions in order
//     (12 / 3 / 6 / 9). Vertical: each spot becomes one direction row
//     (North / East / South / West, same order).

const CLOCK_KEYS = ["c12", "c3", "c6", "c9"] as const;

export type VutmClockKey = (typeof CLOCK_KEYS)[number];
export type VesselOrientation = "HORIZONTAL" | "VERTICAL";

export interface VutmClockRow {
  moc: string;
  componentType: string;
  componentId: string;
  nominalThickness: string;
  /** NPS / Pipe Size (HORIZONTAL) or Nominal Bore inch (VERTICAL) —
   *  from the orientation's size/schedule/WT reference configuration. */
  size: string;
  /** Schedule label, e.g. "SCH 40" (H) or "SCH 40S" (V). */
  schedule: string;
  c12: string[];
  c3: string[];
  c6: string[];
  c9: string[];
  min: string;
}

export interface VutmDirectionRow {
  moc: string;
  componentType: string;
  componentId: string;
  nominalThickness: string;
  /** NPS / Pipe Size (HORIZONTAL) or Nominal Bore inch (VERTICAL) —
   *  from the orientation's size/schedule/WT reference configuration. */
  size: string;
  /** Schedule label, e.g. "SCH 40" (H) or "SCH 40S" (V). */
  schedule: string;
  direction: string;
  readings: string[];
  min: string;
}

export type VutmRow = VutmClockRow | VutmDirectionRow;

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
 *   vutmMinOfSpots(row.c12, row.c3, row.c6, row.c9)   // horizontal row
 *   vutmMinOfSpots(row.readings)                       // vertical row
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

// Canonical directions for VERTICAL vessels.
export const VUTM_DIRECTIONS = ["East", "West", "North", "South"] as const;

// Direction → clock position mapping used when converting legacy rows
// (the same layout the report always displayed: north = 12 o'clock,
// east = 3 o'clock, south = 6 o'clock, west = 9 o'clock).
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

/** Canonical East/West/North/South (case-insensitive), "" otherwise. */
function normalizeDirection(v: unknown): string {
  const s = toStr(v).toLowerCase();
  return VUTM_DIRECTIONS.find((d) => d.toLowerCase() === s) ?? "";
}

/**
 * Normalize one readings array from untrusted JSON: keeps every entry
 * as a trimmed string and guarantees at least ONE slot (each clock
 * position / direction always shows a single input initially).
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

/** Legacy spot1..spot4 → readings list (blanks dropped, ≥1 slot). */
function legacySpotsToReadings(r: Record<string, unknown>): string[] {
  const readings = [
    toStr(r.spot1),
    toStr(r.spot2),
    toStr(r.spot3),
    toStr(r.spot4),
  ].filter((s) => s !== "");
  return readings.length > 0 ? readings : [""];
}

/** Identify legacy dish rows ({ component, direction, spot1..4 }). */
function isLegacyDishRow(r: Record<string, unknown>): boolean {
  return r.component !== undefined && r.direction !== undefined && r.c12 === undefined;
}

/** Identify legacy nozzle rows ({ nozzleId, ..., spot1..4 }). */
function isLegacyNozzleRow(r: Record<string, unknown>): boolean {
  return r.nozzleId !== undefined && r.c12 === undefined && r.direction === undefined;
}

/** Identify legacy VERTICAL shell rows ({ direction, spot1..4 }). */
function isLegacyDirectionRow(r: Record<string, unknown>): boolean {
  return r.direction !== undefined && r.c12 === undefined;
}

/** Identify rows carrying clock arrays (unified or legacy HORIZONTAL). */
function isClockRowLike(r: Record<string, unknown>): boolean {
  return r.c12 !== undefined;
}

/** Normalize one HORIZONTAL (clock-position) row from untrusted JSON. */
function normalizeClockRow(r: Record<string, unknown>): VutmClockRow {
  const row: VutmClockRow = {
    moc: toStr(r.moc),
    componentType: toStr(r.componentType),
    componentId: toStr(r.componentId),
    nominalThickness: toStr(r.nominalThickness),
    size: toStr(r.size),
    schedule: toStr(r.schedule),
    c12: normalizeReadingArray(r.c12),
    c3: normalizeReadingArray(r.c3),
    c6: normalizeReadingArray(r.c6),
    c9: normalizeReadingArray(r.c9),
    min: "",
  };
  // Legacy dish rows carry the component name in `component`; legacy
  // nozzle rows carry the nozzle ID — map them into the unified fields.
  if (!row.componentType) row.componentType = toStr(r.component);
  if (r.nozzleId !== undefined) {
    row.componentType = row.componentType || "Nozzle";
    row.componentId = row.componentId || toStr(r.nozzleId);
  }
  // Legacy VERTICAL / dish rows have fixed spot1..4 instead of arrays:
  // their readings map onto ONE clock position via the direction.
  if (!isClockRowLike(r)) {
    const key = legacyClockKeyForDirection(r.direction) ?? "c12";
    const spots = legacySpotsToReadings(r);
    row.c12 = [""];
    row.c3 = [""];
    row.c6 = [""];
    row.c9 = [""];
    row[key] = spots;
  }
  row.min = vutmMinOfSpots(row.c12, row.c3, row.c6, row.c9);
  return row;
}

/** Normalize one VERTICAL (direction) row from untrusted JSON. */
function normalizeDirectionRow(r: Record<string, unknown>): VutmDirectionRow {
  const readings = Array.isArray(r.readings)
    ? normalizeReadingArray(r.readings)
    : legacySpotsToReadings(r);
  return {
    moc: toStr(r.moc),
    componentType: toStr(r.componentType) || toStr(r.component),
    componentId: toStr(r.componentId) || toStr(r.nozzleId),
    nominalThickness: toStr(r.nominalThickness),
    size: toStr(r.size),
    schedule: toStr(r.schedule),
    direction: normalizeDirection(r.direction),
    readings,
    min: vutmMinOfSpots(readings),
  };
}

/**
 * Convert one HORIZONTAL-shaped row into VERTICAL direction rows
 * (defensive migration: c12→North, c3→East, c6→South, c9→West).
 */
function directionRowsFromClockRow(r: Record<string, unknown>): VutmDirectionRow[] {
  const base = {
    moc: toStr(r.moc),
    componentType: toStr(r.componentType),
    componentId: toStr(r.componentId),
    nominalThickness: toStr(r.nominalThickness),
    size: toStr(r.size),
    schedule: toStr(r.schedule),
  };
  const clockKeyToDirection: Array<[VutmClockKey, string]> = [
    ["c12", "North"],
    ["c3", "East"],
    ["c6", "South"],
    ["c9", "West"],
  ];
  const rows: VutmDirectionRow[] = [];
  for (const [key, direction] of clockKeyToDirection) {
    const readings = Array.isArray(r[key])
      ? (r[key] as Array<unknown>).map((s) => toStr(s)).filter((s) => s !== "")
      : [];
    if (readings.length === 0) continue;
    rows.push({ ...base, direction, readings, min: vutmMinOfSpots(readings) });
  }
  if (rows.length === 0) {
    return [{ ...base, direction: "", readings: [""], min: "" }];
  }
  return rows;
}

/** Convert one VERTICAL-shaped row into a HORIZONTAL clock row. */
function clockRowFromDirectionRow(r: Record<string, unknown>): VutmClockRow {
  const key = legacyClockKeyForDirection(r.direction) ?? "c12";
  const readings = Array.isArray(r.readings)
    ? normalizeReadingArray(r.readings)
    : legacySpotsToReadings(r);
  const row: VutmClockRow = {
    moc: toStr(r.moc),
    componentType: toStr(r.componentType) || toStr(r.component),
    componentId: toStr(r.componentId),
    nominalThickness: toStr(r.nominalThickness),
    size: toStr(r.size),
    schedule: toStr(r.schedule),
    c12: [""],
    c3: [""],
    c6: [""],
    c9: [""],
    min: "",
  };
  row[key] = readings;
  row.min = vutmMinOfSpots(row.c12, row.c3, row.c6, row.c9);
  return row;
}

function clockMergeKey(row: VutmClockRow): string {
  return [row.moc, row.componentType, row.componentId, row.nominalThickness]
    .map((s) => s.toLowerCase())
    .join("\u0001");
}

function directionMergeKey(row: VutmDirectionRow): string {
  return [row.moc, row.componentType, row.componentId, row.nominalThickness, row.direction]
    .map((s) => s.toLowerCase())
    .join("\u0001");
}

/** Concatenate two reading arrays, dropping blank placeholder slots. */
function mergeReadings(a: string[], b: string[]): string[] {
  const merged = [...a, ...b].filter((s) => s !== "");
  return merged.length > 0 ? merged : [""];
}

/** Merge HORIZONTAL rows of the same component into one row. */
function mergeClockRows(rows: VutmClockRow[]): VutmClockRow[] {
  const merged: VutmClockRow[] = [];
  const byKey = new Map<string, VutmClockRow>();
  for (const row of rows) {
    const existing = byKey.get(clockMergeKey(row));
    if (!existing) {
      byKey.set(clockMergeKey(row), row);
      merged.push(row);
      continue;
    }
    existing.c12 = mergeReadings(existing.c12, row.c12);
    existing.c3 = mergeReadings(existing.c3, row.c3);
    existing.c6 = mergeReadings(existing.c6, row.c6);
    existing.c9 = mergeReadings(existing.c9, row.c9);
    existing.min = vutmMinOfSpots(existing.c12, existing.c3, existing.c6, existing.c9);
  }
  return merged;
}

/** Merge VERTICAL rows of the same component + direction into one row. */
function mergeDirectionRows(rows: VutmDirectionRow[]): VutmDirectionRow[] {
  const merged: VutmDirectionRow[] = [];
  const byKey = new Map<string, VutmDirectionRow>();
  for (const row of rows) {
    const existing = byKey.get(directionMergeKey(row));
    if (!existing) {
      byKey.set(directionMergeKey(row), row);
      merged.push(row);
      continue;
    }
    existing.readings = mergeReadings(existing.readings, row.readings);
    existing.min = vutmMinOfSpots(existing.readings);
  }
  return merged;
}

/**
 * Normalize the VESSEL_UTM readings-row JSON column (server-side source
 * of truth) for the given orientation:
 *   • parses the incoming JSON string (invalid → null),
 *   • converts every legacy row shape (HORIZONTAL 4-spot rows, VERTICAL
 *     direction rows, dish rows, nozzle rows) into the orientation's
 *     current shape, merging rows of the same component (+ direction),
 *   • guarantees at least ONE reading slot per clock position /
 *     direction,
 *   • recomputes `min` from the readings.
 *
 * Returns the normalized JSON string, or null when the input is not a
 * valid JSON array.
 */
export function normalizeVutmRows(
  raw: unknown,
  orientation?: VesselOrientation | null,
): string | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;
  const records = parsed.map((r) => (r ?? {}) as Record<string, unknown>);
  const vertical = orientation === "VERTICAL";

  let rows: VutmRow[];
  if (vertical) {
    const dirRows = records.flatMap((r): VutmDirectionRow[] => {
      if (isClockRowLike(r)) return directionRowsFromClockRow(r);
      if (isLegacyNozzleRow(r)) {
        // Legacy nozzle spots → one direction row per spot (N/E/S/W).
        const base = normalizeDirectionRow(r);
        const spots = legacySpotsToReadings(r).filter((s) => s !== "");
        if (spots.length === 0) return [{ ...base, direction: "", readings: [""], min: "" }];
        const order = ["North", "East", "South", "West"];
        return spots.map((s, i) => ({
          ...base,
          direction: order[i] ?? "",
          readings: [s],
          min: vutmMinOfSpots(s),
        }));
      }
      return [normalizeDirectionRow(r)];
    });
    rows = mergeDirectionRows(dirRows);
  } else {
    const clockRows = records.map((r): VutmClockRow => {
      if (isClockRowLike(r)) return normalizeClockRow(r);
      if (isLegacyDirectionRow(r) || isLegacyDishRow(r) || isLegacyNozzleRow(r)) {
        return clockRowFromDirectionRow(r);
      }
      return normalizeClockRow(r);
    });
    rows = mergeClockRows(clockRows);
  }
  return JSON.stringify(rows);
}

/**
 * Parse the stored VESSEL_UTM readings-row JSON column into row objects
 * for the given orientation (recomputing `min` so it can never go
 * stale). Returns [] for missing/invalid JSON.
 */
export function parseVutmRows(
  json: string | null | undefined,
  orientation?: VesselOrientation | null,
): VutmRow[] {
  if (!json) return [];
  const normalized = normalizeVutmRows(json, orientation);
  if (!normalized) return [];
  try {
    const parsed: unknown = JSON.parse(normalized);
    return Array.isArray(parsed) ? (parsed as VutmRow[]) : [];
  } catch {
    return [];
  }
}

/**
 * Legacy vutmDishRows / vutmNozzleRows columns converted for the given
 * orientation (old reports keep their data; new reports save these
 * columns as "[]"). Returns [] for missing/invalid JSON.
 */
function legacyColumnToRows(
  json: string | null | undefined,
  kind: "dish" | "nozzle",
  orientation?: VesselOrientation | null,
): VutmRow[] {
  if (!json || !json.trim()) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed) || parsed.length === 0) return [];
  const records = parsed.map((r) => (r ?? {}) as Record<string, unknown>);
  if (orientation === "VERTICAL") {
    const rows = records.flatMap((r): VutmDirectionRow[] => {
      // Rows already in the clock shape (defensive: written by an earlier
      // version) expand into direction rows so no reading is lost.
      const converted = isClockRowLike(r)
        ? directionRowsFromClockRow(r)
        : [normalizeDirectionRow(r)];
      if (kind === "dish") {
        for (const base of converted) {
          base.moc = "";
          base.componentId = "";
          base.nominalThickness = "";
        }
      }
      return converted;
    });
    return mergeDirectionRows(rows);
  }
  const rows = records.map((r): VutmClockRow => {
    const base = normalizeClockRow(r);
    if (kind === "dish") {
      base.componentType = base.componentType || toStr(r.component);
      base.moc = "";
      base.componentId = "";
      base.nominalThickness = "";
    }
    return base;
  });
  return mergeClockRows(rows);
}

/**
 * All VESSEL_UTM readings for the report's orientation as ONE list for
 * display / PDF / form editing: the vutmShellRows column plus any
 * legacy data still living in the vutmDishRows / vutmNozzleRows
 * columns.
 */
export function vutmRowsFromReport(
  shellJson: string | null | undefined,
  dishJson: string | null | undefined,
  nozzleJson: string | null | undefined,
  orientation?: VesselOrientation | null,
): VutmRow[] {
  return [
    ...parseVutmRows(shellJson, orientation),
    ...legacyColumnToRows(dishJson ?? null, "dish", orientation),
    ...legacyColumnToRows(nozzleJson ?? null, "nozzle", orientation),
  ];
}

/**
 * A fresh empty row for the orientation: HORIZONTAL → clock row with
 * ONE reading slot per position; VERTICAL → direction row with ONE
 * reading slot.
 */
export function emptyVutmRow(orientation?: VesselOrientation | null): VutmRow {
  if (orientation === "VERTICAL") {
    return {
      moc: "",
      componentType: "",
      componentId: "",
      nominalThickness: "",
      size: "",
      schedule: "",
      direction: "",
      readings: [""],
      min: "",
    };
  }
  return {
    moc: "",
    componentType: "",
    componentId: "",
    nominalThickness: "",
    size: "",
    schedule: "",
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
