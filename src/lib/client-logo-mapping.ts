/**
 * Client Logo Mapping — Single Source of Truth (CLEAN SLATE)
 * =========================================================
 *
 * STATUS: The static client-name → logo-file map below is INTENTIONALLY EMPTY.
 *
 * The previous hardcoded mapping (aarti_industries.png, jetyre.png, lt.png,
 * tamimi.png, …) has been removed in full. The old index-based / upload-order
 * based / array-position based matching logic that previously lived here is
 * GONE. Nothing elsewhere in the codebase falls back to another company's
 * logo anymore — when no entry exists below, `resolveClientLogo()` returns
 * `null` and every caller renders a clean placeholder.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * HOW THE NEW MAPPING WILL BE ADDED
 * ─────────────────────────────────────────────────────────────────────────
 * The user will provide a fresh set of logo image files, each with a unique,
 * clearly identifiable filename (e.g. `raj-petro.png`, `raftaar-terminals.png`,
 * `thirumalai-chemicals.png`, `jk-tyre.png`, `vaaman-engineers.png`,
 * `valspar.png`, `vedanta-aluminium.png`).
 *
 * Those files will be dropped into `CLIENT_LOGO_DIR` (see constant below) and
 * the mapping will be filled in here, one line per client, using the form:
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
 * DESIGN RULES (must be respected when filling the map back in)
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
 * EMPTY by design. Populate one entry per client AFTER the user uploads the
 * new uniquely-named logo images. Until then, every lookup returns `null`
 * and the UI shows a placeholder.
 */
const CLIENT_LOGO_MAP: Record<string, string> = {
  // ─────────────────────────────────────────────────────────────────────
  // CLEAN SLATE — no entries.
  //
  // Add new entries here, one per line, in the form:
  //
  //   "<normalized exact client name>": "<exact-logo-filename>",
  //
  // Example (illustrative only — DO NOT assume these are correct until the
  // user provides the real filenames):
  //
  //   "raj petro specialities private limited": "raj-petro.png",
  //   "raftaar terminals pvt ltd":             "raftaar-terminals.png",
  //   "thirumalai chemicals ltd":              "thirumalai-chemicals.png",
  //   "jk tyre industries ltd":                "jk-tyre.png",
  //   "vaaman engineers india limited":        "vaaman-engineers.png",
  //   "valspar india coatings corporation private limited": "valspar.png",
  //   "vedanta aluminium metal limited":       "vedanta-aluminium.png",
  // ─────────────────────────────────────────────────────────────────────
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
