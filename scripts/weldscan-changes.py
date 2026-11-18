"""Weld-scan changes:
1. UI: Probe Type dropdown (Shear Wave / Longitudinal Wave) before Probe in
   Test Results; new rows get probeType:""; colSpan 13→14. Row remove (✕)
   and auto-renumber already exist.
2. PDF: "Probe Type" column + probeType key before Probe; adjusted ratios.
3. PDF header (PIPELINE_WELD_SCAN only): one horizontal row — ArunTech logo
   left, company name + WELD SCAN REPORT centered, client logo right;
   Report No/Rev/Date/Status metadata line removed (DB records unchanged).
"""
P = "/home/z/my-project/src/lib/pdf/pipeline-report.ts"
s = open(P).read()

# ── Edit 1: hoist logo box dims + weld-scan one-row header ──
OLD_HEAD = '''  let cursorY = MARGIN;

  // ── TITLE ──
  const titleFontSize = orientation === "landscape" ? 14 : 12;
  doc.font(FONT_BOLD).fontSize(titleFontSize).fillColor("#000");
  const titleHeight = doc.heightOfString(titleText, { width: usableW, align: "center" });
  doc.text(titleText, MARGIN, cursorY, { width: usableW, align: "center" });
  cursorY += titleHeight + 8;  // explicit 8pt gap below title
'''
assert s.count(OLD_HEAD) == 1
NEW_HEAD = '''  let cursorY = MARGIN;

  // Logo box dimensions — shared by both header styles below so the
  // centered title block can stay clear of the two logo boxes.
  const logoH = 70;
  const logoW = 130;

  if (reportType === "PIPELINE_WELD_SCAN") {
    // ── WELD SCAN HEADER: one horizontal row ──
    //   [ArunTech logo (left)] [company name + report title (center)] [client logo (right)]
    // The Report No / Rev / Date / Status metadata line is intentionally NOT
    // drawn on the weld-scan PDF header — the fields remain in the database
    // and in the internal report records (approval / revision workflow
    // untouched). The centered text is confined to the gap between the two
    // logo boxes so it can never underlap them; the shared LOGOS block below
    // draws the two boxes on this same line (same cursorY, same heights),
    // keeping all three elements vertically aligned in one row.
    const companyName = "ARUN TECH INDUSTRIAL SERVICES PVT LTD";
    const centerX = MARGIN + logoW + 14;
    const centerW = usableW - 2 * (logoW + 14);
    doc.font(FONT_BOLD).fontSize(10).fillColor("#000");
    doc.text(companyName, centerX, cursorY + 13, { width: centerW, align: "center" });
    doc.font(FONT_BOLD).fontSize(15).fillColor("#000");
    doc.text(titleText, centerX, cursorY + 27, { width: centerW, align: "center" });
    doc.fillColor("#000");
    // cursorY intentionally unchanged — the LOGOS block below draws the two
    // logo boxes on this same horizontal band.
  } else {
    // ── TITLE ── (all non-weld-scan reports: unchanged layout)
    const titleFontSize = orientation === "landscape" ? 14 : 12;
    doc.font(FONT_BOLD).fontSize(titleFontSize).fillColor("#000");
    const titleHeight = doc.heightOfString(titleText, { width: usableW, align: "center" });
    doc.text(titleText, MARGIN, cursorY, { width: usableW, align: "center" });
    cursorY += titleHeight + 8;  // explicit 8pt gap below title
  }
'''
s = s.replace(OLD_HEAD, NEW_HEAD)

# ── Edit 2: subtitle only for non-weld-scan ──
OLD_SUB = '''  // ── SUBTITLE (Report No | Rev | Date Range | Status) ──
  const subtitleFontSize'''
assert s.count(OLD_SUB) == 1
NEW_SUB = '''  // ── SUBTITLE (Report No | Rev | Date Range | Status) ── (non-weld-scan only)
  const subtitleFontSize'''
# subtitle block must live inside the else branch: it currently sits after the
# title block, which is now inside `else { ... }` — re-indenting is risky, so
# instead guard it explicitly:
s = s.replace(OLD_SUB, NEW_SUB)
OLD_SUBDRAW = '''  const subtitleText =
    `Report No: ${report.reportNumber}    |    Rev: ${report.revisionNumber}    |    ` +
    `Date: ${dateRange}    |    ` +
    `Status: ${report.status}`;
  doc.font(FONT_REGULAR).fontSize(subtitleFontSize).fillColor("#333");
  const subtitleHeight = doc.heightOfString(subtitleText, { width: usableW, align: "center" });
  doc.text(subtitleText, MARGIN, cursorY, { width: usableW, align: "center" });
  cursorY += subtitleHeight + 10;  // explicit 10pt gap below subtitle
'''
assert s.count(OLD_SUBDRAW) == 1
NEW_SUBDRAW = '''  const subtitleText =
    `Report No: ${report.reportNumber}    |    Rev: ${report.revisionNumber}    |    ` +
    `Date: ${dateRange}    |    ` +
    `Status: ${report.status}`;
  if (reportType !== "PIPELINE_WELD_SCAN") {
    doc.font(FONT_REGULAR).fontSize(subtitleFontSize).fillColor("#333");
    const subtitleHeight = doc.heightOfString(subtitleText, { width: usableW, align: "center" });
    doc.text(subtitleText, MARGIN, cursorY, { width: usableW, align: "center" });
    cursorY += subtitleHeight + 10;  // explicit 10pt gap below subtitle
  }
'''
s = s.replace(OLD_SUBDRAW, NEW_SUBDRAW)

# ── Edit 3: remove the now-duplicate logoH/logoW consts in the LOGOS block ──
OLD_LOGO = '''  const logoH = 70;
  const logoW = 130;
  const serviceLogoPath = findServiceLogo();'''
assert s.count(OLD_LOGO) == 1
NEW_LOGO = '''  const serviceLogoPath = findServiceLogo();'''
s = s.replace(OLD_LOGO, NEW_LOGO)

# ── Edit 4: Test Results table — Probe Type column before Probe ──
OLD_TBL = '''      ["Sl. No", "Description", "Identification No.", "Weld Type", "Probe", "Beam Path (BP) (mm)", "Skip Distance (SD) (mm)", "Depth (mm)", "Echo Height (%)", "Length (mm)", "Observation", "Result"],
      ["description", "identificationNo", "weldType", "probe", "bp", "sd", "depth", "echoHeight", "length", "observation", "result"],'''
assert s.count(OLD_TBL) == 1
NEW_TBL = '''      ["Sl. No", "Description", "Identification No.", "Weld Type", "Probe Type", "Probe", "Beam Path (BP) (mm)", "Skip Distance (SD) (mm)", "Depth (mm)", "Echo Height (%)", "Length (mm)", "Observation", "Result"],
      ["description", "identificationNo", "weldType", "probeType", "probe", "bp", "sd", "depth", "echoHeight", "length", "observation", "result"],'''
s = s.replace(OLD_TBL, NEW_TBL)

OLD_RATIO = '''      [0.5, 1.35, 1.2, 0.9, 0.9, 1.1, 1.2, 0.9, 1.05, 0.95, 1.35, 0.9],'''
assert s.count(OLD_RATIO) == 1
NEW_RATIO = '''      [0.5, 1.2, 1.05, 0.85, 0.95, 0.75, 1.0, 1.05, 0.8, 0.95, 0.85, 1.2, 0.8],'''
s = s.replace(OLD_RATIO, NEW_RATIO)

open(P, "w").write(s)
print("pipeline-report.ts: header + test-results edits applied")

# ── Form view edits ──
F = "/home/z/my-project/src/components/views/pipeline-report-form-view.tsx"
s = open(F).read()

OLD_ROW = '''              rows.push({ description: "", identificationNo: "", weldType: "", probe: "", bp: "", sd: "", depth: "", echoHeight: "", length: "", observation: "", result: "" });'''
assert s.count(OLD_ROW) == 1
NEW_ROW = '''              rows.push({ description: "", identificationNo: "", weldType: "", probeType: "", probe: "", bp: "", sd: "", depth: "", echoHeight: "", length: "", observation: "", result: "" });'''
s = s.replace(OLD_ROW, NEW_ROW)

OLD_TH = '''                  <th className="border border-cyan-800 px-2 py-2 text-center" style={{ minWidth: 70 }}>Weld Type</th>
                  <th className="border border-cyan-800 px-2 py-2 text-center" style={{ minWidth: 60 }}>Probe</th>'''
assert s.count(OLD_TH) == 1
NEW_TH = '''                  <th className="border border-cyan-800 px-2 py-2 text-center" style={{ minWidth: 70 }}>Weld Type</th>
                  <th className="border border-cyan-800 px-2 py-2 text-center" style={{ minWidth: 95 }}>Probe Type</th>
                  <th className="border border-cyan-800 px-2 py-2 text-center" style={{ minWidth: 60 }}>Probe</th>'''
s = s.replace(OLD_TH, NEW_TH)

OLD_EMPTY = '''                    if (rows.length === 0) return <tr><td colSpan={13} className="text-center py-4 text-muted-foreground border border-zinc-300">No test result rows yet.</td></tr>;'''
assert s.count(OLD_EMPTY) == 1
NEW_EMPTY = '''                    if (rows.length === 0) return <tr><td colSpan={14} className="text-center py-4 text-muted-foreground border border-zinc-300">No test result rows yet.</td></tr>;'''
s = s.replace(OLD_EMPTY, NEW_EMPTY)

# Insert the Probe Type Select cell between the Weld Type cell and the
# plain-input field loop (which starts with "probe").
OLD_TD = '''                        {(["probe", "bp", "sd", "depth", "echoHeight", "length", "observation", "result"] as const).map((field) => ('''
assert s.count(OLD_TD) == 1
NEW_TD = '''                        <td className="border border-zinc-300 p-1">
                          <Select value={row.probeType ?? ""} onValueChange={(v) => { const n = [...rows]; n[idx] = { ...row, probeType: v }; setHeader((h) => ({ ...h, wsTestResultRows: JSON.stringify(n) })); }}>
                            <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Select" /></SelectTrigger>
                            <SelectContent>
                              {["Shear Wave", "Longitudinal Wave"].map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </td>
                        {(["probe", "bp", "sd", "depth", "echoHeight", "length", "observation", "result"] as const).map((field) => ('''
s = s.replace(OLD_TD, NEW_TD)

open(F, "w").write(s)
print("pipeline-report-form-view.tsx: Probe Type column + defaults applied")
