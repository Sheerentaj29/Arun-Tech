/**
 * Client Logo Mapping — Single Source of Truth
 * ============================================
 *
 * IMPORTANT: This module is the ONLY place where client company names are
 * mapped to logo files. It is imported by:
 *   - the on-screen review / PDF preview (pipeline-report-detail-view.tsx)
 *   - the downloaded PDF generator (src/lib/pdf/pipeline-report.ts)
 *
 * Design rules (DO NOT violate):
 *   1. The map key is the **normalized** form of an EXACT client name as it
 *      appears in the database — never a keyword/substring. We match the
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
 * Every key below is `normalizeClientName(<exact DB client name>)`.
 * Every value is a real file that exists in CLIENT_LOGO_DIR.
 *
 * Clients not listed here (e.g. demo clients with no real logo) intentionally
 * have NO entry — `resolveClientLogo()` returns null for them so the UI shows
 * a placeholder instead of an unrelated company's logo.
 */
const CLIENT_LOGO_MAP: Record<string, string> = {
  // ── A ──
  "aarti industries ltd": "aarti_industries.png",
  "abdallah i al tamimi industrial services co": "tamimi.png",
  "advanced inspection services": "advanced_inspection.png",
  "atul ltd": "atul.png",

  // ── B ──
  "bharat petroleum corporation ltd": "bharat_petroleum.png",
  "blue star limited": "blue_star.png",

  // ── C ──
  "chennai petroleum corporation limited": "cpcl.png",
  "chemplast sanmar limited": "sanmar.png",
  "chidambaram shipcare private limited": "chidambaram_shipcare.png",
  "citadel engineering company": "citadel_engineering.png",
  "coromandel international limited": "coromandel.png",

  // ── D ──
  "dow chemicals international limited": "dow.png",

  // ── G ──
  "global analytical services": "global_analytical.png",
  "grasim industries limited": "aditya_birla_grasim.png",

  // ── H ──
  "hindustan zinc ltd": "hindustan_zinc.png",

  // ── I ──
  "itd cementation india limited": "it_cem.png",

  // ── J ──
  "jk tyre industries ltd": "jetyre.png",

  // ── K ──
  "kothari petrochemicals limited": "kothari_petrochemicals.png",

  // ── L ──
  // Note: the `&` in "L&T" normalizes to a SPACE (not removed), so the
  // normalized form is "l t geostructure private limited" — three separate
  // words: "l", "t", "geostructure". Keep the key exactly like that.
  "l t geostructure private limited": "lt.png",
  "larsen toubro limited construction": "lt.png",

  // ── P ──
  "pcbl limited": "pcbl_chemical.png",
  "pidilite industries limited": "pidilite.png",

  // ── R ──
  "raftaar terminals pvt ltd": "raftaar_terminals.png",
  "raj petro specialities private limited": "raj_petro.png",

  // ── T ──
  "tata chemicals limited": "tata.png",
  "tata projects limited": "tata.png",
  "thirumalai chemicals ltd": "thirumalai_chemicals.png",
  "tq cert services private limited": "tq_cert.png",
  "tuv india pvt ltd": "tuv_india.png",

  // ── V ──
  "vaaman engineers india limited": "vaaman_engineers.png",
  "valspar india coatings corporation private limited": "valspar.png",
  "vedanta aluminium metal limited": "vedanta_aluminium.png",
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
 * exists. Callers MUST handle the `null` case by showing a placeholder —
 * never by substituting another company's logo.
 */
export function resolveClientLogo(clientName: string): string | null {
  const key = normalizeClientName(clientName);
  if (!key) return null;
  return CLIENT_LOGO_MAP[key] ?? null;
}

/** Read-only view of the underlying map (for tooling / debugging only). */
export const CLIENT_LOGO_MAP_READONLY: Readonly<Record<string, string>> =
  Object.freeze({ ...CLIENT_LOGO_MAP });
