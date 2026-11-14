// ─── Vessel UT Thickness Measurement — Size / Schedule / WT reference data ───
// Scope: VESSEL_UTM ONLY (Vessel → UT Thickness Measurement). The two
// orientations carry SEPARATE configurations:
//
//   • HORIZONTAL VESSEL — carbon-steel reference chart (ASME B36.10M):
//       NPS 1/4 … 48 — 1/8 and 3/8 are deliberately NOT included.
//       Schedules (13, exactly the chart's columns):
//         SCH 10, SCH 20, SCH 30, SCH STD, SCH 40, SCH 60, SCH 80,
//         SCH XS, SCH 100, SCH 120, SCH 140, SCH 160, SCH XXS
//       Each NPS lists ONLY the schedules that have a value in the chart
//       for that NPS — the Schedule dropdown is filtered accordingly and
//       the WT (mm) populates automatically. DN and OD are associated
//       with every NPS.
//
//   • VERTICAL VESSEL — stainless-steel reference chart (ASME B36.19M):
//       Nominal Bore mm / Inch: 3 mm/1/8 … 600 mm/24.
//       Schedules (6): SCH 5S, SCH 10S, SCH 40S, SCH 80S, SCH 160S,
//       SCH XXS. ONLY the WT / wall-thickness column is used — the
//       chart's Weight (Kg/m) column is intentionally NOT part of this
//       configuration (no weight data, no weight calculation).
//
// Values are taken from published ANSI/ASME B36.10M & B36.19M reference
// charts (the same source the Piping UT module uses, kept as a SEPARATE
// configuration here — Piping is not modified). This module is pure so
// it can be used from server and browser bundles. It is intentionally
// NOT generic: every NPS/size stores its actual schedule→WT combinations
// and invalid combinations are simply not offered.
//
// This file does NOT touch the Piping UT configuration
// (src/lib/domain/pipe-standards.ts / the PipeStandard table).

export interface VutmHorizontalSize {
  /** NPS label, e.g. "2", "1 1/4", "48". */
  nps: string;
  /** Associated DN, e.g. "DN50". */
  dn: string;
  /** Outside diameter in mm (chart OD column), e.g. "60.3". */
  odMm: string;
  /** schedule label → wall thickness in mm. Only chart-valued combos. */
  schedules: Record<string, string>;
}

export interface VutmVerticalSize {
  /** Nominal bore in mm, e.g. "25 mm". */
  nominalBoreMm: string;
  /** Inch designation, e.g. "1", "1 1/4", "3/8". */
  inch: string;
  /** Outside diameter in mm (chart OD column), e.g. "33.4". */
  odMm: string;
  /** schedule label → wall thickness in mm. Only chart-valued combos. */
  schedules: Record<string, string>;
}

// The 13 schedule columns of the horizontal (carbon-steel) chart, in the
// chart's order. No other schedule exists in this configuration.
export const VUTM_H_SCHEDULES = [
  "SCH 10",
  "SCH 20",
  "SCH 30",
  "SCH STD",
  "SCH 40",
  "SCH 60",
  "SCH 80",
  "SCH XS",
  "SCH 100",
  "SCH 120",
  "SCH 140",
  "SCH 160",
  "SCH XXS",
] as const;

// The 6 schedule columns of the vertical (stainless-steel) chart.
export const VUTM_V_SCHEDULES = [
  "SCH 5S",
  "SCH 10S",
  "SCH 40S",
  "SCH 80S",
  "SCH 160S",
  "SCH XXS",
] as const;

const H = (
  nps: string,
  dn: string,
  odMm: string,
  schedules: Record<string, string>,
): VutmHorizontalSize => ({ nps, dn, odMm, schedules });

const V = (
  nominalBoreMm: string,
  inch: string,
  odMm: string,
  schedules: Record<string, string>,
): VutmVerticalSize => ({ nominalBoreMm, inch, odMm, schedules });

// ─── HORIZONTAL VESSEL — NPS 1/4 … 48 (no 1/8, no 3/8) ───
export const VUTM_HORIZONTAL_SIZES: VutmHorizontalSize[] = [
  H("1/4", "DN8", "13.7", { "SCH STD": "2.24", "SCH 40": "2.24", "SCH 80": "3.02", "SCH XS": "3.02" }),
  H("1/2", "DN15", "21.3", { "SCH STD": "2.77", "SCH 40": "2.77", "SCH 80": "3.73", "SCH XS": "3.73", "SCH 160": "4.78", "SCH XXS": "7.47" }),
  H("3/4", "DN20", "26.7", { "SCH STD": "2.87", "SCH 40": "2.87", "SCH 80": "3.91", "SCH XS": "3.91", "SCH 160": "5.56", "SCH XXS": "7.82" }),
  H("1", "DN25", "33.4", { "SCH STD": "3.38", "SCH 40": "3.38", "SCH 80": "4.55", "SCH XS": "4.55", "SCH 160": "6.35", "SCH XXS": "9.09" }),
  H("1 1/4", "DN32", "42.2", { "SCH STD": "3.56", "SCH 40": "3.56", "SCH 80": "4.85", "SCH XS": "4.85", "SCH 160": "6.35", "SCH XXS": "9.7" }),
  H("1 1/2", "DN40", "48.3", { "SCH STD": "3.68", "SCH 40": "3.68", "SCH 80": "5.08", "SCH XS": "5.08", "SCH 160": "7.14", "SCH XXS": "10.15" }),
  H("2", "DN50", "60.3", { "SCH STD": "3.91", "SCH 40": "3.91", "SCH 80": "5.54", "SCH XS": "5.54", "SCH 160": "8.74", "SCH XXS": "11.07" }),
  H("2 1/2", "DN65", "73", { "SCH STD": "5.16", "SCH 40": "5.16", "SCH 80": "7.01", "SCH XS": "7.01", "SCH 160": "9.53", "SCH XXS": "14.02" }),
  H("3", "DN80", "88.9", { "SCH STD": "5.49", "SCH 40": "5.49", "SCH 80": "7.62", "SCH XS": "7.62", "SCH 160": "11.13", "SCH XXS": "15.24" }),
  H("3 1/2", "DN90", "101.6", { "SCH STD": "5.74", "SCH 40": "5.74", "SCH 80": "8.08", "SCH XS": "8.08" }),
  H("4", "DN100", "114.3", { "SCH STD": "6.02", "SCH 40": "6.02", "SCH 80": "8.56", "SCH XS": "8.56", "SCH 120": "11.13", "SCH 160": "13.49", "SCH XXS": "17.12" }),
  H("5", "DN125", "141.3", { "SCH STD": "6.55", "SCH 40": "6.55", "SCH 80": "9.53", "SCH XS": "9.53", "SCH 120": "12.7", "SCH 160": "15.88", "SCH XXS": "19.05" }),
  H("6", "DN150", "168.3", { "SCH STD": "7.11", "SCH 40": "7.11", "SCH 80": "10.97", "SCH XS": "10.97", "SCH 120": "14.27", "SCH 160": "18.26", "SCH XXS": "21.95" }),
  H("8", "DN200", "219.1", { "SCH 20": "6.35", "SCH 30": "7.04", "SCH STD": "8.18", "SCH 40": "8.18", "SCH 60": "10.31", "SCH 80": "12.7", "SCH XS": "12.7", "SCH 100": "15.09", "SCH 120": "18.26", "SCH 140": "20.62", "SCH 160": "23.01", "SCH XXS": "22.23" }),
  H("10", "DN250", "273.1", { "SCH 20": "6.35", "SCH 30": "7.8", "SCH STD": "9.27", "SCH 40": "9.27", "SCH 60": "12.7", "SCH 80": "15.09", "SCH XS": "12.7", "SCH 100": "18.26", "SCH 120": "21.44", "SCH 140": "25.4", "SCH 160": "28.58", "SCH XXS": "25.4" }),
  H("12", "DN300", "323.9", { "SCH 20": "6.35", "SCH 30": "8.38", "SCH STD": "9.53", "SCH 40": "10.31", "SCH 60": "14.27", "SCH 80": "17.48", "SCH XS": "12.7", "SCH 100": "21.44", "SCH 120": "25.4", "SCH 140": "28.58", "SCH 160": "33.32", "SCH XXS": "25.4" }),
  H("14", "DN350", "355.6", { "SCH 10": "6.35", "SCH 20": "7.92", "SCH 30": "9.53", "SCH STD": "9.53", "SCH 40": "11.13", "SCH 60": "15.09", "SCH 80": "19.05", "SCH XS": "12.7", "SCH 100": "23.83", "SCH 120": "27.79", "SCH 140": "31.75", "SCH 160": "35.71" }),
  H("16", "DN400", "406.4", { "SCH 10": "6.35", "SCH 20": "7.92", "SCH 30": "9.53", "SCH STD": "9.53", "SCH 40": "12.7", "SCH 60": "16.66", "SCH 80": "21.44", "SCH XS": "12.7", "SCH 100": "26.19", "SCH 120": "30.96", "SCH 140": "36.53", "SCH 160": "40.49" }),
  H("18", "DN450", "457.2", { "SCH 10": "6.35", "SCH 20": "7.92", "SCH 30": "11.13", "SCH STD": "9.53", "SCH 40": "14.27", "SCH 60": "19.05", "SCH 80": "23.83", "SCH XS": "12.7", "SCH 100": "29.36", "SCH 120": "34.93", "SCH 140": "39.67", "SCH 160": "45.24" }),
  H("20", "DN500", "508", { "SCH 10": "6.35", "SCH 20": "9.53", "SCH 30": "12.7", "SCH STD": "9.53", "SCH 40": "15.09", "SCH 60": "20.62", "SCH 80": "26.19", "SCH XS": "12.7", "SCH 100": "32.54", "SCH 120": "38.1", "SCH 140": "44.45", "SCH 160": "50.01" }),
  H("22", "DN550", "559", { "SCH 10": "6.35", "SCH 20": "9.53", "SCH 30": "12.7", "SCH STD": "9.53", "SCH 60": "22.23", "SCH 80": "28.58", "SCH XS": "12.7", "SCH 100": "34.93", "SCH 120": "41.28", "SCH 140": "47.63", "SCH 160": "53.98" }),
  H("24", "DN600", "610", { "SCH 10": "6.35", "SCH 20": "9.53", "SCH 30": "14.27", "SCH STD": "9.53", "SCH 40": "17.48", "SCH 60": "24.61", "SCH 80": "30.96", "SCH XS": "12.7", "SCH 100": "38.89", "SCH 120": "46.02", "SCH 140": "52.37", "SCH 160": "59.54" }),
  H("26", "DN650", "660", { "SCH 10": "7.92", "SCH 20": "12.7", "SCH STD": "9.53", "SCH XS": "12.7" }),
  H("28", "DN700", "711", { "SCH 10": "7.92", "SCH 20": "12.7", "SCH 30": "15.88", "SCH STD": "9.53", "SCH XS": "12.7" }),
  H("30", "DN750", "762", { "SCH 10": "7.92", "SCH 20": "12.7", "SCH 30": "15.88", "SCH STD": "9.53", "SCH XS": "12.7" }),
  H("32", "DN800", "813", { "SCH 10": "7.92", "SCH 20": "12.7", "SCH 30": "15.88", "SCH STD": "9.53", "SCH 40": "17.48", "SCH XS": "12.7" }),
  H("34", "DN850", "864", { "SCH 10": "7.92", "SCH 20": "12.7", "SCH 30": "15.88", "SCH STD": "9.53", "SCH 40": "17.48", "SCH XS": "12.7" }),
  H("36", "DN900", "914", { "SCH 10": "7.92", "SCH 20": "12.7", "SCH 30": "15.88", "SCH STD": "9.53", "SCH 40": "19.05", "SCH XS": "12.7" }),
  H("38", "DN950", "965", { "SCH STD": "9.53", "SCH XS": "12.7" }),
  H("40", "DN1000", "1016", { "SCH STD": "9.53", "SCH 40": "12.7" }),
  H("42", "DN1050", "1067", { "SCH 20": "12.7", "SCH 30": "15.88", "SCH STD": "9.53", "SCH 40": "19.05", "SCH XS": "12.7" }),
  H("44", "DN1100", "1118", { "SCH STD": "9.53", "SCH XS": "12.7" }),
  H("46", "DN1150", "1168", { "SCH STD": "9.53", "SCH XS": "12.7" }),
  H("48", "DN1200", "1219", { "SCH STD": "9.53", "SCH XS": "12.7" }),
];

// ─── VERTICAL VESSEL — Nominal Bore 3 mm/1/8 … 600 mm/24 ───
// WT only — the chart's Weight (Kg/m) column is intentionally excluded.
export const VUTM_VERTICAL_SIZES: VutmVerticalSize[] = [
  V("3 mm", "1/8", "10.3", { "SCH 10S": "1.24", "SCH 40S": "1.73", "SCH 80S": "2.41" }),
  V("6 mm", "1/4", "13.7", { "SCH 10S": "1.65", "SCH 40S": "2.24", "SCH 80S": "3.02" }),
  V("10 mm", "3/8", "17.1", { "SCH 10S": "1.65", "SCH 40S": "2.31", "SCH 80S": "3.2" }),
  V("15 mm", "1/2", "21.3", { "SCH 5S": "1.65", "SCH 10S": "2.11", "SCH 40S": "2.77", "SCH 80S": "3.73", "SCH 160S": "4.78", "SCH XXS": "7.47" }),
  V("20 mm", "3/4", "26.7", { "SCH 5S": "1.65", "SCH 10S": "2.11", "SCH 40S": "2.87", "SCH 80S": "3.91", "SCH 160S": "5.56", "SCH XXS": "7.82" }),
  V("25 mm", "1", "33.4", { "SCH 5S": "1.65", "SCH 10S": "2.77", "SCH 40S": "3.38", "SCH 80S": "4.55", "SCH 160S": "6.35", "SCH XXS": "9.09" }),
  V("32 mm", "1 1/4", "42.2", { "SCH 5S": "1.65", "SCH 10S": "2.77", "SCH 40S": "3.56", "SCH 80S": "4.85", "SCH 160S": "6.35", "SCH XXS": "9.7" }),
  V("40 mm", "1 1/2", "48.3", { "SCH 5S": "1.65", "SCH 10S": "2.77", "SCH 40S": "3.68", "SCH 80S": "5.08", "SCH 160S": "7.14", "SCH XXS": "10.15" }),
  V("50 mm", "2", "60.3", { "SCH 5S": "1.65", "SCH 10S": "2.77", "SCH 40S": "3.91", "SCH 80S": "5.54", "SCH 160S": "8.74", "SCH XXS": "11.07" }),
  V("65 mm", "2 1/2", "73", { "SCH 5S": "2.11", "SCH 10S": "3.05", "SCH 40S": "5.16", "SCH 80S": "7.01", "SCH 160S": "9.53", "SCH XXS": "14.02" }),
  V("80 mm", "3", "88.9", { "SCH 5S": "2.11", "SCH 10S": "3.05", "SCH 40S": "5.49", "SCH 80S": "7.62", "SCH 160S": "11.13", "SCH XXS": "15.24" }),
  V("100 mm", "4", "114.3", { "SCH 5S": "2.11", "SCH 10S": "3.05", "SCH 40S": "6.02", "SCH 80S": "8.56", "SCH 160S": "13.49", "SCH XXS": "17.12" }),
  V("125 mm", "5", "141.3", { "SCH 5S": "2.77", "SCH 10S": "3.4", "SCH 40S": "6.55", "SCH 80S": "9.53", "SCH 160S": "15.88", "SCH XXS": "19.05" }),
  V("150 mm", "6", "168.3", { "SCH 5S": "2.77", "SCH 10S": "3.4", "SCH 40S": "7.11", "SCH 80S": "10.97", "SCH 160S": "18.26", "SCH XXS": "21.95" }),
  V("200 mm", "8", "219.1", { "SCH 5S": "2.77", "SCH 10S": "3.76", "SCH 40S": "8.18", "SCH 80S": "12.7", "SCH 160S": "23.01", "SCH XXS": "22.23" }),
  V("250 mm", "10", "273.1", { "SCH 5S": "3.4", "SCH 10S": "4.19", "SCH 40S": "9.27", "SCH 80S": "12.7", "SCH 160S": "28.58", "SCH XXS": "25.4" }),
  V("300 mm", "12", "323.9", { "SCH 5S": "3.96", "SCH 10S": "4.57", "SCH 40S": "9.53", "SCH 80S": "12.7", "SCH 160S": "33.32", "SCH XXS": "25.4" }),
  V("350 mm", "14", "355.6", { "SCH 5S": "3.96", "SCH 10S": "4.78", "SCH 40S": "11.13", "SCH 80S": "19.05", "SCH 160S": "35.71" }),
  V("400 mm", "16", "406.4", { "SCH 5S": "4.19", "SCH 10S": "4.78", "SCH 40S": "12.7", "SCH 80S": "21.44", "SCH 160S": "40.49" }),
  V("450 mm", "18", "457.2", { "SCH 5S": "4.19", "SCH 10S": "4.78", "SCH 40S": "14.27", "SCH 80S": "23.83", "SCH 160S": "45.24" }),
  V("500 mm", "20", "508", { "SCH 5S": "4.78", "SCH 10S": "5.54", "SCH 40S": "15.09", "SCH 80S": "26.19", "SCH 160S": "50.01" }),
  V("600 mm", "24", "610", { "SCH 5S": "5.54", "SCH 10S": "6.35", "SCH 40S": "17.48", "SCH 80S": "30.96", "SCH 160S": "59.54" }),
];

// ─── HORIZONTAL helpers ───

/** All horizontal NPS labels (1/4 … 48 — 1/8 and 3/8 are NOT included). */
export function vutmHNpsOptions(): string[] {
  return VUTM_HORIZONTAL_SIZES.map((s) => s.nps);
}

/** The horizontal size record for an NPS, or undefined. */
export function vutmHSize(nps: string): VutmHorizontalSize | undefined {
  return VUTM_HORIZONTAL_SIZES.find((s) => s.nps === nps);
}

/**
 * Schedules AVAILABLE for the selected horizontal NPS — only the
 * schedules that have a WT value in the chart for that NPS, ordered as
 * in the chart's column order. Invalid NPS + Schedule combinations are
 * therefore not selectable.
 */
export function vutmHSchedulesFor(nps: string): string[] {
  const size = vutmHSize(nps);
  if (!size) return [];
  return VUTM_H_SCHEDULES.filter((s) => size.schedules[s] !== undefined);
}

/** WT (mm) for the NPS + Schedule combination, or null when invalid. */
export function vutmHWtFor(nps: string, schedule: string): string | null {
  return vutmHSize(nps)?.schedules[schedule] ?? null;
}

// ─── VERTICAL helpers ───

/**
 * All vertical size labels ("3 mm / 1/8" … "600 mm / 24") in chart
 * order — keyed by the inch designation.
 */
export function vutmVSizeOptions(): Array<{ value: string; label: string }> {
  return VUTM_VERTICAL_SIZES.map((s) => ({
    value: s.inch,
    label: `${s.nominalBoreMm} / ${s.inch}`,
  }));
}

/** The vertical size record for an inch designation, or undefined. */
export function vutmVSize(inch: string): VutmVerticalSize | undefined {
  return VUTM_VERTICAL_SIZES.find((s) => s.inch === inch);
}

/**
 * Schedules AVAILABLE for the selected vertical size — only the
 * schedules that have a WT value in the chart for that size, ordered as
 * in the chart's column order.
 */
export function vutmVSchedulesFor(inch: string): string[] {
  const size = vutmVSize(inch);
  if (!size) return [];
  return VUTM_V_SCHEDULES.filter((s) => size.schedules[s] !== undefined);
}

/** WT (mm) for the Nominal Bore / Inch + Schedule combination, or null. */
export function vutmVWtFor(inch: string, schedule: string): string | null {
  return vutmVSize(inch)?.schedules[schedule] ?? null;
}

/**
 * WT for EITHER orientation (used by the form's auto-populate):
 * orientation-aware dispatch. Returns null when the combination has no
 * chart value (invalid combinations are never selectable).
 */
export function vutmWtFor(
  orientation: string | null | undefined,
  size: string,
  schedule: string,
): string | null {
  if (orientation === "VERTICAL") return vutmVWtFor(size, schedule);
  return vutmHWtFor(size, schedule);
}

/**
 * Schedules available for EITHER orientation. Also used to validate a
 * stored size/schedule pair when re-opening a report.
 */
export function vutmSchedulesFor(
  orientation: string | null | undefined,
  size: string,
): string[] {
  if (orientation === "VERTICAL") return vutmVSchedulesFor(size);
  return vutmHSchedulesFor(size);
}
