/**
 * Thickness Table Config — Single Source of Truth
 * ================================================
 *
 * Helpers for the multi-table Thickness Pipeline feature.
 *
 * A single Thickness report can contain zero, one, or many "thickness
 * tables". Each table is a group of ThicknessMeasurement rows that share
 * the same `tableGroup` value (a stable string id). The list of tables
 * (id + label + display order) is stored as JSON on the parent
 * PipelineInspection.thicknessTablesConfig field.
 *
 * This module is pure (no Node imports) so it can be used from both
 * server and browser bundles.
 *
 * Backward compatibility:
 *   - If `thicknessTablesConfig` is null/empty/invalid → fall back to a
 *     single default table whose id is "default" and label is
 *     "Thickness Pipeline Table 1".
 *   - Existing rows (created before this feature) have
 *     `tableGroup = "default"`, so they continue to render in the
 *     (implicit) default table.
 */

export interface ThicknessTableConfig {
  /** Stable id used as the `tableGroup` value on each row. */
  id: string;
  /** Human-readable label shown as the table heading. */
  label: string;
  /** 0-indexed display order. */
  sortOrder: number;
}

export const DEFAULT_TABLE_ID = "default";

/** The label to use for the first (always-present) thickness table. */
export const DEFAULT_TABLE_LABEL = "Thickness Pipeline Table 1";

// ─── SECTION NUMBERING ───
// The Thickness Measurement section has a fixed position in the report
// structure. The parent section number ("7") reflects this position and
// does not change. The sub-table number suffix (".N") is dynamically
// derived from each table's position in the ordered list — so adding,
// deleting, or reordering tables automatically renumbers everything.

/** The section number for the Thickness Measurement section in the report. */
export const THICKNESS_SECTION_NUMBER = "7";

/** The parent section title shown above all thickness tables. */
export const THICKNESS_SECTION_TITLE = "Thickness Measurement";

/**
 * Build the numbered heading for the parent thickness section.
 * Example: "7. Thickness Measurement"
 */
export function thicknessSectionHeading(): string {
  return `${THICKNESS_SECTION_NUMBER}. ${THICKNESS_SECTION_TITLE}`;
}

/**
 * Build the numbered heading for a single thickness table.
 * The index is 1-based (first table = 7.1, second = 7.2, etc.).
 *
 * Example: "7.1 – Thickness Measurement – Tank A"
 *
 * @param indexOneBased  1-based position of this table in the ordered list.
 * @param label          The user-supplied label for this table.
 */
export function thicknessTableHeading(indexOneBased: number, label: string): string {
  return `${THICKNESS_SECTION_NUMBER}.${indexOneBased} – ${label}`;
}

/**
 * Build an Index/Table of Contents entry for a single thickness table.
 * This is the format used in the Index list that appears under the
 * parent section heading.
 *
 * Example: "7.1 – Thickness Measurement – Tank A"
 *
 * (Same as thicknessTableHeading — the Index mirrors the table headings.)
 */
export function thicknessTableIndexEntry(indexOneBased: number, label: string): string {
  return thicknessTableHeading(indexOneBased, label);
}

/**
 * Parse a thicknessTablesConfig JSON string into a sorted array.
 * Returns a single default table if the string is missing/invalid/empty.
 */
export function parseThicknessTablesConfig(raw: string | null | undefined): ThicknessTableConfig[] {
  if (!raw || !raw.trim()) {
    return [{ id: DEFAULT_TABLE_ID, label: DEFAULT_TABLE_LABEL, sortOrder: 0 }];
  }
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) {
      return [{ id: DEFAULT_TABLE_ID, label: DEFAULT_TABLE_LABEL, sortOrder: 0 }];
    }
    // Validate each entry; drop malformed ones.
    const cleaned: ThicknessTableConfig[] = [];
    for (const entry of parsed) {
      if (entry && typeof entry === "object" && typeof entry.id === "string" && typeof entry.label === "string") {
        cleaned.push({
          id: entry.id,
          label: entry.label,
          sortOrder: typeof entry.sortOrder === "number" ? entry.sortOrder : cleaned.length,
        });
      }
    }
    if (cleaned.length === 0) {
      return [{ id: DEFAULT_TABLE_ID, label: DEFAULT_TABLE_LABEL, sortOrder: 0 }];
    }
    // Ensure the first entry is always the "default" table.
    if (!cleaned.some((t) => t.id === DEFAULT_TABLE_ID)) {
      cleaned.unshift({ id: DEFAULT_TABLE_ID, label: DEFAULT_TABLE_LABEL, sortOrder: -1 });
    }
    // Re-number sortOrder (0..n-1) in array order.
    return cleaned
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((t, i) => ({ ...t, sortOrder: i }));
  } catch {
    return [{ id: DEFAULT_TABLE_ID, label: DEFAULT_TABLE_LABEL, sortOrder: 0 }];
  }
}

/** Serialize an array of configs to a JSON string for DB persistence. */
export function serializeThicknessTablesConfig(tables: ThicknessTableConfig[]): string {
  return JSON.stringify(
    tables.map((t, i) => ({ id: t.id, label: t.label, sortOrder: i })),
  );
}

/** Generate a fresh, stable-ish id for a newly added thickness table. */
export function generateThicknessTableId(): string {
  return `t_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/** Default label for the Nth (1-indexed) table. */
export function defaultThicknessTableLabel(indexOneBased: number): string {
  return `Thickness Pipeline Table ${indexOneBased}`;
}
