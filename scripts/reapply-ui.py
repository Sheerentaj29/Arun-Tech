"""Re-apply UI edits: Instrument Type rename + Weld Scan Scanning Details
(Flaw Sizing Technique dropdown, reference row arrangement, common Save button)
+ review-page Scanning Details pairs. Test Results headings were already
updated in the form (this turn) and are not touched here."""
P1 = "/home/z/my-project/src/components/views/pipeline-report-form-view.tsx"
P2 = "/home/z/my-project/src/components/views/pipeline-report-detail-view.tsx"
s = open(P1).read()
d = open(P2).read()
edits = 0


def rep(src, old, new, expected=1):
    n = src.count(old)
    assert n == expected, f"expected {expected}, found {n}: {old[:80]!r}"
    return src.replace(old, new)


# ── Form: Instrument Details column header ──
if ">Equipment Type</th>" in s:
    s = rep(s, '<th className="border border-cyan-800 px-2 py-2 text-center">Equipment Type</th>',
            '<th className="border border-cyan-800 px-2 py-2 text-center">Instrument Type</th>')
    edits += 1
else:
    assert ">Instrument Type</th>" in s, "instrument header missing in both forms"
    print("[skip] form instrument header already renamed")

# ── Form: Scanning Details — Save button in the card header ──
if "Common Save button" not in s:
    s = rep(s,
        """      {/* 3. SCANNING DETAILS */}
      <Card>
        <CardHeader><CardTitle className="text-base">Scanning Details</CardTitle></CardHeader>""",
        """      {/* 3. SCANNING DETAILS */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">Scanning Details</CardTitle>
          {/* Common Save button — persists ALL Scanning Details fields together
              (PUT /api/pipeline-inspections/[id]); no per-field saves needed. */}
          <Button size="sm" variant="outline" onClick={saveHeader} disabled={saving}>
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
            Save
          </Button>
        </CardHeader>""")
    edits += 1
else:
    print("[skip] form scanning Save button present")

# ── Form: Scanning Details — reference row arrangement + Flaw Sizing Technique ──
if '"wsScanningFlawSizingTechnique", "select"' not in s:
    s = rep(s,
        """                {([
                  ["Calibration Block", "wsScanningCalibrationBlock", "text" as const, "Reference Level", "wsScanningReferenceLevel", "text" as const],
                  ["Extent of Examination", "wsScanningExtentOfExamination", "text" as const, "Surface Condition", "wsScanningSurfaceCondition", "select" as const],
                ]).map(([label1, field1, type1, label2, field2, type2], rowIdx) => (""",
        """                {([
                  // Field arrangement per reference: row 1 Calibration Block |
                  // Reference Level, row 2 Extent of Examination | Flaw Sizing
                  // Technique, row 3 Surface Condition.
                  ["Calibration Block (DAC Block)", "wsScanningCalibrationBlock", "text" as const, [] as string[], "Reference Level", "wsScanningReferenceLevel", "text" as const, [] as string[]],
                  ["Extent of Examination", "wsScanningExtentOfExamination", "text" as const, [] as string[], "Flaw Sizing Technique", "wsScanningFlawSizingTechnique", "select" as const, ["6 dB Drop", "12 dB Drop", "18 dB Drop"] as string[]],
                  ["Surface Condition", "wsScanningSurfaceCondition", "select" as const, ["Clean & Smooth Surface", "Rough Surface", "Painted Surface"] as string[], "", "", "text" as const, [] as string[]],
                ]).map(([label1, field1, type1, opts1, label2, field2, type2, opts2], rowIdx) => (""")
    edits += 1
else:
    print("[skip] form scanning rows present")

# ── Form: per-cell option lists ──
if "(opts1 as string[])" not in s:
    s = rep(s,
        """                            {["Clean & Smooth Surface", "Rough Surface", "Painted Surface"].map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      ) : label1 ? (""",
        """                            {(opts1 as string[]).map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      ) : label1 ? (""")
    s = rep(s,
        """                            {["Clean & Smooth Surface", "Rough Surface", "Painted Surface"].map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      ) : label2 ? (""",
        """                            {(opts2 as string[]).map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      ) : label2 ? (""")
    edits += 1
else:
    print("[skip] form per-cell options present")

# ── Detail view: Instrument Details column header ──
if ">Equipment Type</th>" in d:
    d = rep(d, '<th className="border border-cyan-800 px-2 py-2 text-center">Equipment Type</th>',
            '<th className="border border-cyan-800 px-2 py-2 text-center">Instrument Type</th>')
    edits += 1
else:
    assert ">Instrument Type</th>" in d
    print("[skip] detail instrument header already renamed")

# ── Detail view: Scanning Details pairs (add Flaw Sizing Technique) ──
if '["Flaw Sizing Technique", report.wsScanningFlawSizingTechnique]' not in d:
    d = rep(d,
        """          const wsScanPairs: Array<[string, string | null | undefined]> = [
            ["Calibration Block", report.wsScanningCalibrationBlock],
            ["Reference Level", report.wsScanningReferenceLevel],
            ["Extent of Examination", report.wsScanningExtentOfExamination],
            ["Surface Condition", report.wsScanningSurfaceCondition],
          ];""",
        """          const wsScanPairs: Array<[string, string | null | undefined]> = [
            ["Calibration Block (DAC Block)", report.wsScanningCalibrationBlock],
            ["Reference Level", report.wsScanningReferenceLevel],
            ["Extent of Examination", report.wsScanningExtentOfExamination],
            ["Flaw Sizing Technique", report.wsScanningFlawSizingTechnique],
            ["Surface Condition", report.wsScanningSurfaceCondition],
          ];""")
    edits += 1
else:
    print("[skip] detail wsScanPairs present")

open(P1, "w").write(s)
open(P2, "w").write(d)
print(f"OK — {edits} edits applied")
