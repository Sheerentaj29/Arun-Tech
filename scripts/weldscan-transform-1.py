"""Weld Scan (Pipeline + Vessel): calibration-block dropdown, Probe Type
column visibility toggle, per-report persistence.

Req 1: Calibration Block (DAC Block) free-text -> dropdown with 5 options
       (both PIPELINE_WELD_SCAN and VESSEL_WELD_SCAN) + admin-configurable
       exact specification, persisted and shown in PDF/preview.
Req 2: x-remove toggle beside the Probe Type heading of the Pipeline Weld
       Scan Test Results table (Vessel Weld Scan has no Test Results /
       Probe Type column - its Weld Scan Testing Details table uses Probe
       Angle / Probe Frequency). Hidden column is excluded from the PDF and
       the preview; remaining columns stretch to fill the width.
Req 3: New per-report columns persist the choice; probe-type DATA is never
       deleted - hiding only affects display.
"""
import re

# ─────────────────────────── 1. prisma schema ───────────────────────────
P = "prisma/schema.prisma"
s = open(P).read()

OLD = """  wsTestResultRows                  String?  // JSON: [{description, identificationNo, weldType, probeType, probe, bp, sd, depth, echoHeight, length, observation, result}]"""
if OLD not in s:
    # schema comment may differ; fall back to the real line
    m = re.search(r"  wsTestResultRows\s+String\?.*\n", s)
    assert m, "wsTestResultRows not found in schema"
    OLD = m.group(0).rstrip("\n")
NEW = OLD + """
  wsScanningCalibrationBlockSpec    String?  // Weld Scan: admin-configured exact specification/step values of the selected calibration block
  wsProbeTypeHidden                 Boolean? // Weld Scan (PIPELINE only): Probe Type column hidden in Test Results (display-only; data kept)
  vwsCalibrationBlockSpec           String?  // Vessel Weld Scan: admin-configured exact specification/step values of the selected calibration block"""
assert s.count(OLD) == 1, f"schema anchor found {s.count(OLD)} times"
s = s.replace(OLD, NEW)
open(P, "w").write(s)
print("schema: 3 columns added")

# ─────────────────────────── 2. API routes ───────────────────────────
# create route (POST): new records write the fields when present
P = "src/app/api/pipeline-inspections/route.ts"
s = open(P).read()
rep = [
    ("""      wsTestResultRows: body.wsTestResultRows ?? "[]",
      // ─── VESSEL DPT CONSUMABLE DETAILS (Make / Product / Batch / Expiry) ───""",
     """      wsTestResultRows: body.wsTestResultRows ?? "[]",
      wsScanningCalibrationBlockSpec: body.wsScanningCalibrationBlockSpec?.trim() || null,
      wsProbeTypeHidden: body.wsProbeTypeHidden === true,
      // ─── VESSEL DPT CONSUMABLE DETAILS (Make / Product / Batch / Expiry) ───"""),
    ("""      vwsCalibrationBlock: body.vwsCalibrationBlock?.trim() || null,
      vwsCalibrationBlockMoc: body.vwsCalibrationBlockMoc?.trim() || null,""",
     """      vwsCalibrationBlock: body.vwsCalibrationBlock?.trim() || null,
      vwsCalibrationBlockMoc: body.vwsCalibrationBlockMoc?.trim() || null,
      vwsCalibrationBlockSpec: body.vwsCalibrationBlockSpec?.trim() || null,"""),
]
for old, new in rep:
    assert s.count(old) == 1, f"create route anchor: {s.count(old)}"
    s = s.replace(old, new)
open(P, "w").write(s)
print("create route patched")

# update route (PUT): merge pattern — update only when the form sends it
P = "src/app/api/pipeline-inspections/[id]/route.ts"
s = open(P).read()
rep = [
    ("""      wsTestResultRows: body.wsTestResultRows !== undefined ? body.wsTestResultRows : existing.wsTestResultRows,
      // ─── EQUIPMENT TYPE + VESSEL ORIENTATION ───""",
     """      wsTestResultRows: body.wsTestResultRows !== undefined ? body.wsTestResultRows : existing.wsTestResultRows,
      wsScanningCalibrationBlockSpec: body.wsScanningCalibrationBlockSpec !== undefined ? (body.wsScanningCalibrationBlockSpec?.trim() || null) : existing.wsScanningCalibrationBlockSpec,
      wsProbeTypeHidden: body.wsProbeTypeHidden !== undefined ? body.wsProbeTypeHidden === true : existing.wsProbeTypeHidden,
      // ─── EQUIPMENT TYPE + VESSEL ORIENTATION ───"""),
    ("""      vwsCalibrationBlock: body.vwsCalibrationBlock !== undefined ? (body.vwsCalibrationBlock?.trim() || null) : existing.vwsCalibrationBlock,
      vwsCalibrationBlockMoc: body.vwsCalibrationBlockMoc !== undefined ? (body.vwsCalibrationBlockMoc?.trim() || null) : existing.vwsCalibrationBlockMoc,""",
     """      vwsCalibrationBlock: body.vwsCalibrationBlock !== undefined ? (body.vwsCalibrationBlock?.trim() || null) : existing.vwsCalibrationBlock,
      vwsCalibrationBlockMoc: body.vwsCalibrationBlockMoc !== undefined ? (body.vwsCalibrationBlockMoc?.trim() || null) : existing.vwsCalibrationBlockMoc,
      vwsCalibrationBlockSpec: body.vwsCalibrationBlockSpec !== undefined ? (body.vwsCalibrationBlockSpec?.trim() || null) : existing.vwsCalibrationBlockSpec,"""),
]
for old, new in rep:
    assert s.count(old) == 1, f"update route anchor: {s.count(old)}"
    s = s.replace(old, new)
open(P, "w").write(s)
print("update route patched")

# ─────────────────────────── 3. form view ───────────────────────────
P = "src/components/views/pipeline-report-form-view.tsx"
s = open(P).read()

# 3a. shared options constant (top-level, near other weld-scan helpers)
OLD = "// Types + helpers for the VESSEL_WELD_SCAN report (Vessel → Weld Scan)."
NEW = """// ─── Calibration Block (DAC Block) dropdown options ───
// Shared by PIPELINE_WELD_SCAN (Scanning Details) and VESSEL_WELD_SCAN
// (Calibration Details). Correct terminology: "Step Wedge" (NOT "Step
// Wireless"); the 1–10 mm option is identified as a 10-step block; the
// 2–25 mm range is the documented step-wedge range. Manufacturers differ,
// so an administrator may record the block's exact specification via the
// admin-only "exact specification" field — the selection itself stays one
// of these five canonical options.
const CALIBRATION_BLOCK_OPTIONS = [
  "V1 Block (IIW Type 1)",
  "V2 Block (IIW Type 2 / A4)",
  "DAC Block – 19 mm",
  "VW Step Block – 1 mm to 10 mm (10-step)",
  "Step Wedge – 2 mm to 25 mm",
] as const;

// Legacy reports may hold a free-text value that is not one of the five
// options — keep it selectable so saving doesn't silently change it.
function calibrationBlockOptionsWithLegacy(current: string | null | undefined): string[] {
  const opts = CALIBRATION_BLOCK_OPTIONS as unknown as string[];
  const cur = (current ?? "").trim();
  if (!cur || opts.includes(cur)) return [...opts];
  return [...opts, cur];
}

// Types + helpers for the VESSEL_WELD_SCAN report (Vessel → Weld Scan)."""
assert s.count(OLD) == 1
s = s.replace(OLD, NEW)

# 3b. ReportHeader type additions
rep = [
    ("""  // ─── WELD SCAN SPECIFIC FIELDS ───
  wsScanningCalibrationBlock: string;""",
     """  // ─── WELD SCAN SPECIFIC FIELDS ───
  wsScanningCalibrationBlock: string;
  wsScanningCalibrationBlockSpec: string;  // admin-configured exact spec / step values
  wsProbeTypeHidden: boolean;              // Test Results Probe Type column hidden (display-only)"""),
    ("""  // Calibration Details
  vwsCalibrationBlock: string;
  vwsCalibrationBlockMoc: string;""",
     """  // Calibration Details
  vwsCalibrationBlock: string;
  vwsCalibrationBlockSpec: string;  // admin-configured exact spec / step values
  vwsCalibrationBlockMoc: string;"""),
]
for old, new in rep:
    assert s.count(old) == 1, f"type anchor: {s.count(old)}"
    s = s.replace(old, new)

# 3c. EMPTY_HEADER defaults
rep = [
    ("""  wsScanningCalibrationBlock: "",""",
     """  wsScanningCalibrationBlock: "",
  wsScanningCalibrationBlockSpec: "",
  wsProbeTypeHidden: false,"""),
    ("""  vwsCalibrationBlock: "",
  vwsCalibrationBlockMoc: "",""",
     """  vwsCalibrationBlock: "",
  vwsCalibrationBlockSpec: "",
  vwsCalibrationBlockMoc: "","""),
]
for old, new in rep:
    assert s.count(old) == 1, f"defaults anchor: {s.count(old)}"
    s = s.replace(old, new)

# 3d. load mapping
rep = [
    ("""          wsScanningCalibrationBlock: r.wsScanningCalibrationBlock ?? "",""",
     """          wsScanningCalibrationBlock: r.wsScanningCalibrationBlock ?? "",
          wsScanningCalibrationBlockSpec: r.wsScanningCalibrationBlockSpec ?? "",
          wsProbeTypeHidden: r.wsProbeTypeHidden === true,"""),
    ("""          vwsCalibrationBlock: r.vwsCalibrationBlock ?? "",
          vwsCalibrationBlockMoc: r.vwsCalibrationBlockMoc ?? "",""",
     """          vwsCalibrationBlock: r.vwsCalibrationBlock ?? "",
          vwsCalibrationBlockSpec: r.vwsCalibrationBlockSpec ?? "",
          vwsCalibrationBlockMoc: r.vwsCalibrationBlockMoc ?? "","""),
]
for old, new in rep:
    assert s.count(old) == 1, f"load anchor: {s.count(old)}"
    s = s.replace(old, new)

# 3e. saveHeader: optional override payload (used by instant column toggle)
OLD = """      const payload: Record<string, unknown> = { ...header };"""
NEW = """      const payload: Record<string, unknown> = { ...header, ...(saveOverrides ?? {}) };"""
assert s.count(OLD) == 1
s = s.replace(OLD, NEW)
OLD = """  async function saveHeader() {"""
NEW = """  async function saveHeader(saveOverrides?: Record<string, unknown>) {"""
assert s.count(OLD) == 1
s = s.replace(OLD, NEW)

open(P, "w").write(s)
print("form part 1 done (types, defaults, load, saveHeader)")
