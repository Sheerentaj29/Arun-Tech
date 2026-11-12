/**
 * Client Logo Mapping — Single Source of Truth
 * ============================================
 *
 * STATUS: The map below contains exactly 5 verified mappings, one per
 * client logo image the user explicitly uploaded and identified.
 *
 * The old hardcoded mapping (aarti_industries.png, jetyre.png, lt.png,
 * tamimi.png, …) was removed in full in the previous cleanup step. The old
 * index-based / upload-order-based / array-position-based matching logic
 * that previously lived here is GONE. Nothing elsewhere in the codebase
 * falls back to another company's logo — when no entry exists below,
 * `resolveClientLogo()` returns `null` and every caller renders a clean
 * placeholder.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * HOW ADDITIONAL MAPPINGS ARE ADDED
 * ─────────────────────────────────────────────────────────────────────────
 * When the user uploads more logo images, drop each file into
 * `CLIENT_LOGO_DIR` (see constant below) and add one line here in the form:
 *
 *     "<normalized exact DB client name>": "<exact-logo-filename>",
 *
 * The mapping uses ONLY:
 *   - exact client identifier (the normalized exact client name), and
 *   - exact logo filename.
 *
 * The mapping does NOT use:
 *   - array position
 *   - array index
 *   - upload order
 *   - alphabetical position
 *   - random / fuzzy fallback
 *
 * ─────────────────────────────────────────────────────────────────────────
 * DESIGN RULES (must be respected when adding entries)
 * ─────────────────────────────────────────────────────────────────────────
 *   1. The map key is the NORMALIZED form of an EXACT client name as it
 *      appears in the database — never a keyword or substring. We match the
 *      whole company name, not part of it.
 *   2. Logo files are referenced by exact filename only — no array indices,
 *      no upload order, no positional lookup.
 *   3. `resolveClientLogo()` returns `null` when a client name has no exact
 *      mapping. Callers MUST then show a placeholder / "no logo" UI — they
 *      MUST NOT fall back to another company's logo.
 *   4. Normalization is purely cosmetic: lowercase, collapse whitespace,
 *      strip punctuation/special characters. It does NOT remove legal
 *      suffixes (Limited, Pvt, Corporation, …) because doing so would
 *      create collisions between distinct companies.
 *   5. Aruntech (the service company) is fixed on the LEFT of every report
 *      and is NOT part of this mapping.
 *
 * The module is dependency-free (no Node imports) so it is safe to import
 * from both server and browser bundles.
 */

/** Directory where physical client logo files live on disk (server only). */
export const CLIENT_LOGO_DIR =
  "/home/z/my-project/storage/logos/clients";

/**
 * Explicit map: normalized client name → logo filename.
 *
 * Each key is `normalizeClientName(<exact DB client name>)`.
 * Each value is the exact filename of a logo image that physically exists
 * in CLIENT_LOGO_DIR. Only the 5 logos the user explicitly uploaded and
 * verified are listed here — no guessed, fuzzy, or leftover entries from
 * the old (deleted) mapping.
 *
 * Filenames are taken verbatim from the user's upload (with the accidental
 * leading space stripped). Internal spaces are preserved and the
 * /api/client-logo/[slug] endpoint is configured to accept them.
 */
const CLIENT_LOGO_MAP: Record<string, string> = {
  // ── 5 mappings (verified exact matches against the Client DB) ──
  "aarti industries ltd":                "Aarti Industries Ltd.png",
  "atul ltd":                            "Atul Ltd.png",
  "bharat petroleum corporation ltd":    "Bharat Petroleum Corporation Ltd.png",
  "blue star limited":                   "Blue Star Limited.png",
  "chemplast sanmar limited":            "Chemplast Sanmar Limited.png",
};

/**
 * Normalize a client name for matching.
 *
 * Lowercases, trims, collapses internal whitespace, and strips punctuation
 * and special characters (`&`, `/`, `,`, `.`, `(`, `)`, `'`, `"`, `-`).
 * Legal suffixes (Limited, Pvt, Corporation, …) are deliberately preserved.
 */
export function normalizeClientName(name: string): string {
  if (!name) return "";
  return name
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ")                      // collapse whitespace
    .replace(/[&/\\,.()'"!\-;:]+/g, " ")        // strip punctuation → space
    .replace(/\s+/g, " ")                      // collapse again
    .trim();
}

/**
 * Resolve a client name to its logo filename, or `null` if no exact mapping
 * exists. With the map currently empty this always returns `null`.
 *
 * Callers MUST handle the `null` case by showing a placeholder — never by
 * substituting another company's logo.
 */
export function resolveClientLogo(clientName: string): string | null {
  const key = normalizeClientName(clientName);
  if (!key) return null;
  return CLIENT_LOGO_MAP[key] ?? null;
}

/** Read-only view of the underlying map (for tooling / debugging only). */
export const CLIENT_LOGO_MAP_READONLY: Readonly<Record<string, string>> =
  Object.freeze({ ...CLIENT_LOGO_MAP });
