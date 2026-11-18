"""Weld Scan part 2: UI (form selects + x toggle), detail-view preview, PDF."""

# ─────────────────── form: pipeline scanning details ───────────────────
P = "src/components/views/pipeline-report-form-view.tsx"
s = open(P).read()

OLD = """                {([
                  // Field arrangement per reference: row 1 Calibration Block |
                  // Reference Level, row 2 Extent of Examination | Flaw Sizing
                  // Technique, row 3 Surface Condition.
                  ["Calibration Block (DAC Block)", "wsScanningCalibrationBlock", "text" as const, [] as string[], "Reference Level", "wsScanningReferenceLevel", "text" as const, [] as string[]],"""
NEW = """                {([
                  // Field arrangement per reference: row 1 Calibration Block |
                  // Reference Level, row 2 Extent of Examination | Flaw Sizing
                  // Technique, row 3 Surface Condition.
                  // Calibration Block is a dropdown (5 canonical options);
                  // legacy free-text values stay selectable via
                  // calibrationBlockOptionsWithLegacy so an old record is
                  // never silently changed on save.
                  ["Calibration Block (DAC Block)", "wsScanningCalibrationBlock", "select" as const, calibrationBlockOptionsWithLegacy(header.wsScanningCalibrationBlock) as string[], "Reference Level", "wsScanningReferenceLevel", "text" as const, [] as string[]],"""
assert s.count(OLD) == 1, f"pipeline scanning anchor: {s.count(OLD)}"
s = s.replace(OLD, NEW)

# Admin-only exact-specification row appended after the scanning table body
OLD = """                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* 4. TEST RESULTS */}"""
NEW = """                    </td>
                  </tr>
                ))}
                {isAdmin && header.wsScanningCalibrationBlock && (
                  <tr className="border-b border-zinc-200">
                    <td className="bg-cyan-50 border-r border-zinc-200 px-3 py-2 font-medium text-zinc-700 w-1/5 align-top">
                      Exact specification (admin)
                    </td>
                    <td colSpan={3} className="px-2 py-1.5">
                      <Input
                        className="h-8 text-sm"
                        value={header.wsScanningCalibrationBlockSpec}
                        onChange={(e) => updateHeader("wsScanningCalibrationBlockSpec", e.target.value)}
                        placeholder="Exact step values / specification of the selected block, e.g. Steps 1, 2, 3, 4, 5, 6, 7, 8, 9, 10 mm"
                      />
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* 4. TEST RESULTS */}"""
assert s.count(OLD) == 1, f"pipeline spec-row anchor: {s.count(OLD)}"
s = s.replace(OLD, NEW)

# ─────────────────── form: vessel calibration details ───────────────────
OLD = """                {([
                  ["Calibration Block", "vwsCalibrationBlock", "e.g. V1 / V2 / ASME basic calibration block"],
                  ["Calibration Block Material / MOC", "vwsCalibrationBlockMoc", "Material of the calibration block"],"""
NEW = """                {/* Calibration Block — dropdown (5 canonical options shared
                    with the piping weld scan); legacy free-text values stay
                    selectable so an old record is never silently changed. */}
                <tr className="border-b border-zinc-200">
                  <td className="bg-cyan-50 border-r border-zinc-200 px-3 py-2 font-medium text-zinc-700 w-1/3">
                    Calibration Block
                  </td>
                  <td className="px-2 py-1.5">
                    <Select
                      value={header.vwsCalibrationBlock}
                      onValueChange={(v) => updateHeader("vwsCalibrationBlock", v)}
                    >
                      <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="Select" /></SelectTrigger>
                      <SelectContent>
                        {calibrationBlockOptionsWithLegacy(header.vwsCalibrationBlock).map((m) => (
                          <SelectItem key={m} value={m}>{m}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </td>
                </tr>
                {isAdmin && header.vwsCalibrationBlock && (
                  <tr className="border-b border-zinc-200">
                    <td className="bg-cyan-50 border-r border-zinc-200 px-3 py-2 font-medium text-zinc-700 w-1/3 align-top">
                      Exact specification (admin)
                    </td>
                    <td className="px-2 py-1.5">
                      <Input
                        className="h-8 text-sm"
                        value={header.vwsCalibrationBlockSpec}
                        onChange={(e) => updateHeader("vwsCalibrationBlockSpec", e.target.value)}
                        placeholder="Exact step values / specification of the selected block, e.g. Steps 2, 4, 6, 8, 10, 12, 16, 20, 25 mm"
                      />
                    </td>
                  </tr>
                )}
                {([
                  ["Calibration Block Material / MOC", "vwsCalibrationBlockMoc", "Material of the calibration block"],"""
assert s.count(OLD) == 1, f"vessel calib anchor: {s.count(OLD)}"
s = s.replace(OLD, NEW)

# ─────────────────── form: probe-type toggle in Test Results ───────────────────
# isAdmin is defined inside the render; add a local alias in this component.
# It is already available as `user?.dashboardRole === "ADMIN"` — reuse the
# same expression inline where needed.

# 1) Card header: Add Row + Restore button when the column is hidden
OLD = """          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Test Results</CardTitle>
            <Button onClick={() => {
              const rows = JSON.parse(header.wsTestResultRows || "[]");
              rows.push({ description: "", identificationNo: "", weldType: "", probeType: "", probe: "", bp: "", sd: "", depth: "", echoHeight: "", length: "", observation: "", result: "" });
              setHeader((h) => ({ ...h, wsTestResultRows: JSON.stringify(rows) }));
            }} size="sm"><Plus className="mr-1 h-4 w-4" /> Add Row</Button>
          </div>"""
NEW = """          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Test Results</CardTitle>
            <div className="flex items-center gap-2">
              {header.wsProbeTypeHidden && (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={saving}
                  title="Bring back the Probe Type column (previously entered values are preserved)"
                  onClick={() => { updateHeader("wsProbeTypeHidden", false); saveHeader({ wsProbeTypeHidden: false }); }}
                ><Eye className="mr-1 h-4 w-4" /> Restore Probe Type</Button>
              )}
              <Button onClick={() => {
                const rows = JSON.parse(header.wsTestResultRows || "[]");
                rows.push({ description: "", identificationNo: "", weldType: "", probeType: "", probe: "", bp: "", sd: "", depth: "", echoHeight: "", length: "", observation: "", result: "" });
                setHeader((h) => ({ ...h, wsTestResultRows: JSON.stringify(rows) }));
              }} size="sm"><Plus className="mr-1 h-4 w-4" /> Add Row</Button>
            </div>
          </div>"""
assert s.count(OLD) == 1, f"test results header anchor: {s.count(OLD)}"
s = s.replace(OLD, NEW)

# 2) Probe Type <th> gains a small x (hide) control
OLD = """                  <th className="border border-cyan-800 px-2 py-2 text-center" style={{ minWidth: 95 }}>Probe Type</th>
                  <th className="border border-cyan-800 px-2 py-2 text-center" style={{ minWidth: 60 }}>Probe</th>"""
NEW = """                  <th className="border border-cyan-800 px-2 py-2 text-center" style={{ minWidth: 95 }}>
                    <div className="flex items-center justify-center gap-1">
                      <span>Probe Type</span>
                      <button
                        type="button"
                        title="Remove the Probe Type column from the table, the PDF and the preview (values are kept and can be restored)"
                        aria-label="Remove Probe Type column"
                        disabled={saving}
                        className="rounded p-0.5 text-white/80 hover:bg-white/20 hover:text-white"
                        onClick={() => { updateHeader("wsProbeTypeHidden", true); saveHeader({ wsProbeTypeHidden: true }); }}
                      >×<span className="sr-only">Remove Probe Type column</span></button>
                    </div>
                  </th>
                  <th className="border border-cyan-800 px-2 py-2 text-center" style={{ minWidth: 60 }}>Probe</th>"""
assert s.count(OLD) == 1, f"probe th anchor: {s.count(OLD)}"
s = s.replace(OLD, NEW)

open(P, "w").write(s)
print("form part 2 done (pipeline select+spec, vessel select+spec, toggle header)")
