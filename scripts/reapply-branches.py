"""Re-apply PDF features part 3: per-branch TOC declarations + numbered
sub-section headings (14pt), Weld Scan Test Results headings with full forms
and units, wsMultiCol tocBranch/colRatios support, Scanning Details rewrite
(reference arrangement + Flaw Sizing Technique, previous 7pt styling),
2x3 photo gallery, certification numbering."""
import re

P = "/home/z/my-project/src/lib/pdf/pipeline-report.ts"
s = open(P).read()
log = []


def rep(old, new, expected=1):
    global s
    n = s.count(old)
    assert n == expected, f"expected {expected}, found {n}: {old[:90]!r}"
    s = s.replace(old, new)
    log.append(f"[{n}x] {old[:58]!r}")


def sub_heading(accent, literal, ts_expr):
    """Replace the (bold 11pt accent + doc.text(literal)) heading pair with a
    14pt numbered subsection heading. Idempotent via ts_expr presence."""
    global s, log
    if ts_expr in s:
        log.append(f"[skip] {literal[:40]}")
        return
    pat = re.compile(
        r'doc\.font\(FONT_BOLD\)\.fontSize\(11\)\.fillColor\('
        + (r'"' + re.escape(accent) + r'"' if accent.startswith("#") else re.escape(accent))
        + r'\);\n(\s*)doc\.text\("'
        + re.escape(literal) + r'", MARGIN, y\);'
    )
    ms = list(pat.finditer(s))
    assert len(ms) >= 1, f"{literal} @{accent}: found {len(ms)}"
    m = ms[0]
    indent = m.group(1)
    accent_arg = ('"' + accent + '"' if accent.startswith("#") else accent)
    repl = (
        f"doc.font(FONT_BOLD).fontSize(FONT_SIZE_SUB).fillColor({accent_arg});\n"
        f"{indent}doc.text(`{{{ts_expr}}}`, MARGIN, y);"
    )
    s = s[: m.start()] + repl + s[m.end():]
    log.append(f"[heading] {literal[:44]}")


def declare_branch(const_line, var, title):
    global s, log
    if f"const {var} = makeTocBranch" in s:
        log.append(f"[skip declare] {var}")
        return
    rep(const_line, const_line + f'\n    const {var} = makeTocBranch("{title}");\n'
        f"    currentTestBranch = {var};")


# ── Branch closures (correct scopes) ──
declare_branch("    const dptReport = report as any;", "pdptBranch", "Dye Penetrant Testing")
declare_branch("    const vdptReport = report as any;", "vdptBranch", "Dye Penetrant Testing")
declare_branch("    const vmptReport = report as any;", "vmptBranch", "Magnetic Particle Testing")
declare_branch("    const mptReport = report as any;", "pmptBranch", "Magnetic Particle Testing")
declare_branch("    const wsReport = report as any;", "pwsBranch", "Weld Scan")
declare_branch("    const vwsReport = report as any;", "vwsBranch", "Weld Scan")
declare_branch("    const utmReport = report as any;", "vutmBranch", "UT Thickness Measurement")
declare_branch("    const tdptReport = report as any;", "tdptBranch", "Dye Penetrant Testing")
declare_branch("    const tmptReport = report as any;", "tmptBranch", "Magnetic Particle Testing")
declare_branch("    const twsReport = report as any;", "twsBranch", "Weld Scan")
declare_branch("    const tutmReport = report as any;", "tutmBranch", "UT Thickness Measurement")

# ── PIPELINE_DPT ──
sub_heading("#3a1d4a", "3. DYE PENETRANT PROCEDURE",
            'pdptBranch.sub("Dye Penetrant Procedure") + " DYE PENETRANT PROCEDURE"')
sub_heading("#3a1d4a", "Consumable Details",
            'pdptBranch.sub("Consumable Details") + " Consumable Details"')
sub_heading("#3a1d4a", "DPT Inspection Results",
            'pdptBranch.sub("DPT Inspection Results") + " DPT Inspection Results"')

# ── VESSEL_DPT ──
sub_heading("#3a1d4a", "Dye Penetrant Testing Parameters",
            'vdptBranch.sub("Dye Penetrant Testing Parameters") + " Dye Penetrant Testing Parameters"')
sub_heading("#3a1d4a", "Consumable Details",
            'vdptBranch.sub("Consumable Details") + " Consumable Details"')
sub_heading("#3a1d4a", "Dye Penetrant Testing Details",
            'vdptBranch.sub("Dye Penetrant Testing Details") + " Dye Penetrant Testing Details"')

# ── VESSEL_MPT ──
sub_heading("#7c2d12", "Magnetic Particle Testing Parameters",
            'vmptBranch.sub("Magnetic Particle Testing Parameters") + " Magnetic Particle Testing Parameters"')
sub_heading("#7c2d12", "Consumable Details",
            'vmptBranch.sub("Consumable Details") + " Consumable Details"')
sub_heading("#7c2d12", "Magnetic Particle Testing Details",
            'vmptBranch.sub("Magnetic Particle Testing Details") + " Magnetic Particle Testing Details"')

# ── PIPELINE_MPT ──
sub_heading("#7c2d12", "5.1 Magnetic Particle Testing Parameters",
            'pmptBranch.sub("Magnetic Particle Testing Parameters") + " Magnetic Particle Testing Parameters"')
sub_heading("#7c2d12", "Consumable Details",
            'pmptBranch.sub("Consumable Details") + " Consumable Details"')
sub_heading("#7c2d12", "MPT Inspection Results",
            'pmptBranch.sub("MPT Inspection Results") + " MPT Inspection Results"')

# ── VESSEL_WELD_SCAN ──
sub_heading("vwsAccent", "Weld Scan Testing Parameters",
            'vwsBranch.sub("Weld Scan Testing Parameters") + " Weld Scan Testing Parameters"')
sub_heading("vwsAccent", "Probe Details",
            'vwsBranch.sub("Probe Details") + " Probe Details"')
sub_heading("vwsAccent", "Weld Scan Testing Details",
            'vwsBranch.sub("Weld Scan Testing Details") + " Weld Scan Testing Details"')

# ── VESSEL_UTM ──
sub_heading("utmAccent", "UT Thickness Measurement Parameters",
            'vutmBranch.sub("UT Thickness Measurement Parameters") + " UT Thickness Measurement Parameters"')
sub_heading("utmAccent", "Probe Details — Longitudinal Wave (0°)",
            'vutmBranch.sub("Probe Details — Longitudinal Wave (0°)") + " Probe Details — Longitudinal Wave (0°)"')
sub_heading("utmAccent", "UT Thickness Measurement Readings",
            'vutmBranch.sub("UT Thickness Measurement Readings") + " UT Thickness Measurement Readings"')

# ── TANK_DPT ──
sub_heading("tdptAccent", "Dye Penetrant Testing Parameters",
            'tdptBranch.sub("Dye Penetrant Testing Parameters") + " Dye Penetrant Testing Parameters"')
sub_heading("tdptAccent", "Consumable Details",
            'tdptBranch.sub("Consumable Details") + " Consumable Details"')
sub_heading("tdptAccent", "Dye Penetrant Testing Details",
            'tdptBranch.sub("Dye Penetrant Testing Details") + " Dye Penetrant Testing Details"')

# ── TANK_MPT ──
sub_heading("tmptAccent", "Magnetic Particle Testing Parameters",
            'tmptBranch.sub("Magnetic Particle Testing Parameters") + " Magnetic Particle Testing Parameters"')
sub_heading("tmptAccent", "Consumable Details",
            'tmptBranch.sub("Consumable Details") + " Consumable Details"')
sub_heading("tmptAccent", "Magnetic Particle Testing Details",
            'tmptBranch.sub("Magnetic Particle Testing Details") + " Magnetic Particle Testing Details"')

# ── TANK_WELD_SCAN ──
sub_heading("twsAccent", "Weld Scan Testing Parameters",
            'twsBranch.sub("Weld Scan Testing Parameters") + " Weld Scan Testing Parameters"')
sub_heading("twsAccent", "Probe Details",
            'twsBranch.sub("Probe Details") + " Probe Details"')
sub_heading("twsAccent", "Weld Scan Testing Details",
            'twsBranch.sub("Weld Scan Testing Details") + " Weld Scan Testing Details"')

# ── TANK_UTM ──
sub_heading("tutmAccent", "UT Thickness Measurement Parameters",
            'tutmBranch.sub("UT Thickness Measurement Parameters") + " UT Thickness Measurement Parameters"')
sub_heading("tutmAccent", "Probe Details — Longitudinal Wave (0°)",
            'tutmBranch.sub("Probe Details — Longitudinal Wave (0°)") + " Probe Details — Longitudinal Wave (0°)"')
sub_heading("tutmAccent", "UT Thickness Measurement Readings",
            'tutmBranch.sub("UT Thickness Measurement Readings") + " UT Thickness Measurement Readings"')

# ── Weld-scan multi-column helper: tocBranch + colRatios support, 14pt heading ──
rep(
    "    const drawWsMultiColTable = (heading: string, headers: string[], rowFields: string[], jsonStr: string, dateFields: string[] = []) => {",
    "    const drawWsMultiColTable = (heading: string, headers: string[], rowFields: string[], jsonStr: string, dateFields: string[] = [], tocBranch?: { sub: (t: string) => string }, colRatios?: number[]) => {",
)
rep(
    """      const headerH = 28;
      const rowH = 22;
      const colCount = headers.length;
      const colW = usableW / colCount;""",
    """      const headerH = 28;
      const rowH = 22;
      const colCount = headers.length;
      const colW = colRatios
        ? usableW / colRatios.reduce((a, b) => a + b, 0)
        : usableW / colCount;
      const colWidths = colRatios
        ? colRatios.map((r) => (usableW / colRatios.reduce((a, b) => a + b, 0)) * r)
        : headers.map(() => colW);""",
)
rep(
    """      doc.font(FONT_BOLD).fontSize(10).fillColor("#000");
      doc.text(heading, MARGIN, y);
      doc.fillColor("#000");
      y += 16;""",
    """      const headingLabel = tocBranch ? `${tocBranch.sub(heading)} ${heading}` : heading;
      doc.font(FONT_BOLD).fontSize(FONT_SIZE_SUB).fillColor("#000");
      doc.text(headingLabel, MARGIN, y);
      doc.fillColor("#000");
      y += 20;""",
)
rep(
    """          doc.text(headers[i], x + 2, headerY + 8, { width: colW - 4, align: "center" });
          x += colW;""",
    """          doc.text(headers[i], x + 2, headerY + 8, { width: colWidths[i] - 4, align: "center" });
          x += colWidths[i];""",
)
rep(
    """          let val = "";
          if (i === 0 && heading.includes("Test Results")) {
            val = String(r + 1);
          } else {
            const fieldIdx = heading.includes("Test Results") ? i - 1 : i;
            const field = rowFields[fieldIdx];""",
    """          const colW = colWidths[i];
          let val = "";
          if (i === 0 && heading.includes("Test Results")) {
            val = String(r + 1);
          } else {
            const fieldIdx = heading.includes("Test Results") ? i - 1 : i;
            const field = rowFields[fieldIdx];""",
)

# ── Weld Scan call sites: Instrument Type rename + branch + weighted widths ──
rep(
    """    // 1. Instrument Details
    drawWsMultiColTable(
      "Instrument Details",
      ["Equipment Type", "Machine Make", "Model", "M/c Sr. No.", "Calibration Due Date"],
      ["equipmentType", "machineMake", "model", "mcSrNo", "calibrationDueDate"],
      wsReport.wsInstrumentRows ?? "[]",
      ["calibrationDueDate"],
    );""",
    """    // 1. Instrument Details (column renamed per spec: Instrument Type)
    drawWsMultiColTable(
      "Instrument Details",
      ["Instrument Type", "Machine Make", "Model", "M/c Sr. No.", "Calibration Due Date"],
      ["equipmentType", "machineMake", "model", "mcSrNo", "calibrationDueDate"],
      wsReport.wsInstrumentRows ?? "[]",
      ["calibrationDueDate"],
      pwsBranch,
    );""",
)
rep(
    """    // 2. Test Probe Details
    drawWsMultiColTable(
      "Test Probe Details",
      ["Probe Type", "Probe Angle", "Frequency", "Size", "Probe No.", "Range", "Ref dB", "Scan dB"],
      ["probeType", "probeAngle", "frequency", "size", "probeNo", "range", "referenceDb", "scanningDb"],
      wsReport.wsProbeRows ?? "[]",
    );""",
    """    // 2. Test Probe Details
    drawWsMultiColTable(
      "Test Probe Details",
      ["Probe Type", "Probe Angle", "Frequency", "Size", "Probe No.", "Range", "Ref dB", "Scan dB"],
      ["probeType", "probeAngle", "frequency", "size", "probeNo", "range", "referenceDb", "scanningDb"],
      wsReport.wsProbeRows ?? "[]",
      [],
      pwsBranch,
      [1.4, 1, 1.1, 1.2, 0.9, 0.9, 0.8, 0.9],
    );""",
)
rep(
    """    // 4. Test Results
    drawWsMultiColTable(
      "Test Results",
      ["Sl. No", "Description", "Identification No.", "Weld Type", "Probe", "BP", "SD", "Depth", "Echo Height", "Length", "Observation", "Result"],
      ["description", "identificationNo", "weldType", "probe", "bp", "sd", "depth", "echoHeight", "length", "observation", "result"],
      wsReport.wsTestResultRows ?? "[]",
    );""",
    """    // 4. Test Results — headings carry the full forms and measurement units
    drawWsMultiColTable(
      "Test Results",
      ["Sl. No", "Description", "Identification No.", "Weld Type", "Probe", "Beam Path (BP) (mm)", "Skip Distance (SD) (mm)", "Depth (mm)", "Echo Height (%)", "Length (mm)", "Observation", "Result"],
      ["description", "identificationNo", "weldType", "probe", "bp", "sd", "depth", "echoHeight", "length", "observation", "result"],
      wsReport.wsTestResultRows ?? "[]",
      [],
      pwsBranch,
      [0.5, 1.35, 1.2, 0.9, 0.9, 1.1, 1.2, 0.9, 1.05, 0.95, 1.35, 0.9],
    );""",
)

# ── Scanning Details: reference pairing + Flaw Sizing Technique (7pt) ──
rep(
    """    // Helper: draw a two-column scanning details table
    const drawWsScanningDetails = () => {
      const rowH = 18;
      const labelW = usableW * 0.25;
      const valueW = (usableW - 2 * labelW) / 2;
      const scanPairs: Array<[string, string | null]> = [
        ["Calibration Block", wsReport.wsScanningCalibrationBlock],
        ["Extent of Examination", wsReport.wsScanningExtentOfExamination],
        ["", null],
        ["Reference Level", wsReport.wsScanningReferenceLevel],
        ["Surface Condition", wsReport.wsScanningSurfaceCondition],
      ];
      // Only render if any value is non-empty
      const hasData = scanPairs.some(([, v]) => v && String(v).trim());
      if (!hasData) return;

      if (y + 24 + rowH * 3 > pageMaxY) { addNewPage(); y = MARGIN; }
      y += 4;
      doc.font(FONT_BOLD).fontSize(10).fillColor("#000");
      doc.text("Scanning Details", MARGIN, y);
      y += 16;

      for (let i = 0; i < scanPairs.length; i += 2) {
        if (y + rowH > pageMaxY) { addNewPage(); y = MARGIN; }
        const left = scanPairs[i];
        const right = scanPairs[i + 1] ?? ["", null];
        doc.rect(MARGIN, y, labelW, rowH).fill("#ecfeff");
        doc.font(FONT_BOLD).fontSize(7).fillColor("#000");
        doc.text(left[0], MARGIN + 3, y + 5, { width: labelW - 6 });
        doc.rect(MARGIN + labelW, y, valueW, rowH).fill("#ffffff");
        doc.font(FONT_REGULAR).fontSize(7);
        const lv = left[1] && String(left[1]).trim() ? String(left[1]).trim() : "";
        doc.text(lv, MARGIN + labelW + 3, y + 5, { width: valueW - 6 });
        doc.rect(MARGIN + labelW + valueW, y, labelW, rowH).fill("#ecfeff");
        doc.font(FONT_BOLD).fontSize(7);
        doc.text(right[0], MARGIN + labelW + valueW + 3, y + 5, { width: labelW - 6 });
        doc.rect(MARGIN + 2 * labelW + valueW, y, valueW, rowH).fill("#ffffff");
        doc.font(FONT_REGULAR).fontSize(7);
        const rv = right[1] && String(right[1]).trim() ? String(right[1]).trim() : "";
        doc.text(rv, MARGIN + 2 * labelW + valueW + 3, y + 5, { width: valueW - 6 });
        doc.rect(MARGIN, y, usableW, rowH).stroke(TABLE_OUTER_BORDER);
        doc.moveTo(MARGIN + labelW, y).lineTo(MARGIN + labelW, y + rowH).stroke(TABLE_INNER_BORDER);
        doc.moveTo(MARGIN + labelW + valueW, y).lineTo(MARGIN + labelW + valueW, y + rowH).stroke(TABLE_INNER_BORDER);
        doc.moveTo(MARGIN + 2 * labelW + valueW, y).lineTo(MARGIN + 2 * labelW + valueW, y + rowH).stroke(TABLE_INNER_BORDER);
        y += rowH;
      }
      doc.fillColor("#000");
      y += 4;
    };""",
    """    // Helper: draw the Scanning Details table — two (label | value) pairs
    // per row, matching the reference form:
    //   row 1: Calibration Block (DAC Block) | Reference Level
    //   row 2: Extent of Examination         | Flaw Sizing Technique
    //   row 3: Surface Condition             | —
    const drawWsScanningDetails = () => {
      const rowH = 18;
      const labelW = usableW * 0.25;
      const valueW = (usableW - 2 * labelW) / 2;
      const scanPairs: Array<[string, string | null]> = [
        ["Calibration Block (DAC Block)", wsReport.wsScanningCalibrationBlock],
        ["Reference Level", wsReport.wsScanningReferenceLevel],
        ["Extent of Examination", wsReport.wsScanningExtentOfExamination],
        ["Flaw Sizing Technique", wsReport.wsScanningFlawSizingTechnique],
        ["Surface Condition", wsReport.wsScanningSurfaceCondition],
        ["", null],
      ];
      // Only render if any value is non-empty
      const hasData = scanPairs.some(([, v]) => v && String(v).trim());
      if (!hasData) return;

      if (y + 24 + rowH * 3 > pageMaxY) { addNewPage(); y = MARGIN; }
      y += 4;
      const scanNum = pwsBranch.sub("Scanning Details");
      doc.font(FONT_BOLD).fontSize(FONT_SIZE_SUB).fillColor("#000");
      doc.text(`${scanNum} Scanning Details`, MARGIN, y);
      y += 20;

      for (let i = 0; i < scanPairs.length; i += 2) {
        if (y + rowH > pageMaxY) { addNewPage(); y = MARGIN; }
        const left = scanPairs[i];
        const right = scanPairs[i + 1] ?? ["", null];
        doc.rect(MARGIN, y, labelW, rowH).fill("#ecfeff");
        doc.font(FONT_BOLD).fontSize(7).fillColor("#000");
        doc.text(left[0], MARGIN + 3, y + 5, { width: labelW - 6 });
        doc.rect(MARGIN + labelW, y, valueW, rowH).fill("#ffffff");
        doc.font(FONT_REGULAR).fontSize(7).fillColor("#000");
        const lv = left[1] && String(left[1]).trim() ? String(left[1]).trim() : "";
        doc.text(lv, MARGIN + labelW + 3, y + 5, { width: valueW - 6 });
        doc.rect(MARGIN + labelW + valueW, y, labelW, rowH).fill("#ecfeff");
        doc.font(FONT_BOLD).fontSize(7).fillColor("#000");
        doc.text(right[0], MARGIN + labelW + valueW + 3, y + 5, { width: labelW - 6 });
        doc.rect(MARGIN + 2 * labelW + valueW, y, valueW, rowH).fill("#ffffff");
        doc.font(FONT_REGULAR).fontSize(7).fillColor("#000");
        const rv = right[1] && String(right[1]).trim() ? String(right[1]).trim() : "";
        doc.text(rv, MARGIN + 2 * labelW + valueW + 3, y + 5, { width: valueW - 6 });
        doc.rect(MARGIN, y, usableW, rowH).stroke(TABLE_OUTER_BORDER);
        doc.moveTo(MARGIN + labelW, y).lineTo(MARGIN + labelW, y + rowH).stroke(TABLE_INNER_BORDER);
        doc.moveTo(MARGIN + labelW + valueW, y).lineTo(MARGIN + labelW + valueW, y + rowH).stroke(TABLE_INNER_BORDER);
        doc.moveTo(MARGIN + 2 * labelW + valueW, y).lineTo(MARGIN + 2 * labelW + valueW, y + rowH).stroke(TABLE_INNER_BORDER);
        y += rowH;
      }
      doc.fillColor("#000");
      y += 4;
    };""",
)

# ── Photo gallery: exact 2-column × 3-row grid, 6 photos per page ──
rep(
    """  if (allPhotos.length > 0) {
    // PHOTO GALLERY HEADING — ensure heading + first photo row fit together
    // (a heading must never appear alone at the bottom of a page).
    // First photo row needs: cellH (photo + caption) + small gap.
    const photoW_forCalc = orientation === "landscape" ? 180 : 140;
    const photoH_forCalc = orientation === "landscape" ? 120 : 95;
    const captionH_forCalc = 16;
    const cellH_forCalc = photoH_forCalc + captionH_forCalc;
    const headingH_photos = 22; // heading line + small gap below
    // Need: heading + first row of photos
    if (y + headingH_photos + cellH_forCalc + 10 > pageMaxY) {
      addNewPage();
      y = MARGIN;
    }
    y += 10;
    doc.font(FONT_BOLD).fontSize(10).fillColor("#000");
    // Report-type-specific gallery heading. The Vessel UT Thickness
    // Measurement report names the section per the reference layout;
    // every other report type keeps the existing heading.
    doc.text(
      reportType === "VESSEL_UTM"
        ? "Photographs – During UT Thickness Measurement"
        : "Inspection Photographs",
      MARGIN, y,
    );
    y += 20;

    // Fixed thumbnail size — consistent across all photos
    const photoW = photoW_forCalc;
    const photoH = photoH_forCalc;
    const captionH = captionH_forCalc; // space reserved for caption below each photo
    const cellH = cellH_forCalc; // total height per photo cell
    const gap = 10;
    const photosPerRow = Math.max(1, Math.floor((pageW - 2 * MARGIN + gap) / (photoW + gap)));

    let currentCol = 0;
    let currentRowY = y;

    for (let i = 0; i < allPhotos.length; i++) {
      const photo = allPhotos[i];
      const px = MARGIN + currentCol * (photoW + gap);
      const py = currentRowY;

      // Check if this photo + caption fits on the current page.
      // If not, move to a new page and reset column + row.
      if (py + cellH > pageMaxY) {
        addNewPage();
        currentCol = 0;
        currentRowY = MARGIN;
        const newPx = MARGIN;
        const newPy = currentRowY;
        drawPhotoCell(doc, photo, newPx, newPy, photoW, photoH, FONT_REGULAR);
        currentCol++;
        if (currentCol >= photosPerRow) {
          currentCol = 0;
          currentRowY += cellH + gap;
        }
        continue;
      }

      // Draw the photo cell (image + border + caption)
      drawPhotoCell(doc, photo, px, py, photoW, photoH, FONT_REGULAR);

      currentCol++;
      if (currentCol >= photosPerRow) {
        currentCol = 0;
        currentRowY += cellH + gap;
      }
    }

    // Update y to after the last row
    y = currentRowY + (currentCol > 0 ? cellH + gap : 0);
  }""",
    """  if (allPhotos.length > 0) {
    // ═══════════════════════════════════════════════════════════════
    // PHOTO GALLERY — EXACTLY 6 photographs per page in a 2-column ×
    // 3-row grid (per spec). Every photograph keeps its original aspect
    // ratio inside its own bordered cell (drawPhotoCell uses fit, never
    // stretch). Captions/filenames sit underneath each photograph.
    // More than 6 photos → additional pages with the same layout.
    // Fewer than 6 on the last page → only the available photographs are
    // drawn (no empty placeholder boxes). No photo is ever dropped.
    // ═══════════════════════════════════════════════════════════════
    // Pre-load every photo ONCE (converting unsupported formats to PNG via
    // sharp) so each gallery page renders real photographs, never placeholders.
    const photoBufs: Array<Buffer | null> = [];
    for (const ph of allPhotos) {
      photoBufs.push(await loadEmbeddableImage(ph.filePath));
    }

    const PHOTOS_PER_PAGE = 6;
    const GRID_COLS = 2;
    const GRID_ROWS = 3;
    const gapX = 12;
    const gapY = 12;
    const captionH_photos = 16; // caption strip below each photo box
    const headingH_photos = 20; // heading line + gap below

    // Grid geometry: 3 rows must ALWAYS fit on a fresh page below the
    // heading, so every gallery page uses the identical layout. The 8pt
    // pre-heading gap is subtracted so row 3 (and its caption) can never
    // cross the page boundary — a caption drawn with `width` would
    // otherwise trigger pdfkit's LineWrapper page-break and orphan itself
    // onto the next page.
    const preHeadingGap = 8;
    const gridAvailH = pageMaxY - MARGIN - headingH_photos - preHeadingGap;
    const rowH_photos = Math.floor((gridAvailH - (GRID_ROWS - 1) * gapY) / GRID_ROWS);
    const cellW_photos = Math.floor((pageW - 2 * MARGIN - (GRID_COLS - 1) * gapX) / GRID_COLS);
    const photoBoxH = rowH_photos - captionH_photos;

    // Gallery heading — registered in the TOC as a subsection of the
    // report's test-type section.
    const photoTitle =
      reportType === "VESSEL_UTM"
        ? "Photographs – During UT Thickness Measurement"
        : "Inspection Photographs";

    for (let start = 0; start < allPhotos.length; start += PHOTOS_PER_PAGE) {
      if (start === 0) {
        // First gallery page: keep heading + full grid together.
        if (y + headingH_photos + GRID_ROWS * rowH_photos + (GRID_ROWS - 1) * gapY > pageMaxY) {
          addNewPage();
          y = MARGIN;
        }
        y += preHeadingGap;
        if (currentTestBranch) {
          doc.font(FONT_BOLD).fontSize(FONT_SIZE_SUB).fillColor("#000");
          doc.text(`${currentTestBranch.sub(photoTitle)} ${photoTitle}`, MARGIN, y);
        } else {
          doc.font(FONT_BOLD).fontSize(FONT_SIZE_SUB).fillColor("#000");
          doc.text(photoTitle, MARGIN, y);
        }
        y += headingH_photos;
      } else {
        // Continuation page: same 2×3 grid, nothing but photos.
        addNewPage();
        y = MARGIN;
      }

      const group = allPhotos.slice(start, start + PHOTOS_PER_PAGE);
      for (let g = 0; g < group.length; g++) {
        const col = g % GRID_COLS;
        const row = Math.floor(g / GRID_COLS);
        const px = MARGIN + col * (cellW_photos + gapX);
        const py = y + row * (rowH_photos + gapY);
        // drawPhotoCell fits the image inside (px, py, cellW, photoBox)
        // preserving aspect ratio and draws the caption below the box.
        drawPhotoCell(doc, group[g], px, py, cellW_photos, photoBoxH, FONT_REGULAR, photoBufs[start + g]);
      }
      y += GRID_ROWS * rowH_photos + (GRID_ROWS - 1) * gapY + 8;
    }
  }""",
)

# ── Certification: TOC main + numbered subsections ──
rep(
    """      addNewPage();
      // Draw "Certification" heading + sub-heading at the top of this page
      doc.font(FONT_BOLD).fontSize(14).fillColor("#000");
      doc.text("Certification", MARGIN, MARGIN, { width: usableW });
      doc.font(FONT_BOLD).fontSize(11);
      doc.text(`Instrument Calibration (${equipCerts.length})`, MARGIN, MARGIN + 20, { width: usableW });""",
    """      addNewPage();
      // Draw "Certification" heading + sub-heading at the top of this page
      if (certBranchRef.current === null) {
        certBranchRef.current = makeTocBranch("Certification");
      }
      const certBranch = certBranchRef.current;
      doc.font(FONT_BOLD).fontSize(FONT_SIZE_MAIN).fillColor("#000");
      doc.text(`${certBranch.main()}. Certification`, MARGIN, MARGIN, { width: usableW });
      doc.font(FONT_BOLD).fontSize(FONT_SIZE_SUB);
      doc.text(`${certBranch.sub("Instrument Calibration")} Instrument Calibration (${equipCerts.length})`, MARGIN, MARGIN + 26, { width: usableW });""",
)
rep(
    """      addNewPage();
      doc.font(FONT_BOLD).fontSize(11).fillColor("#000");
      doc.text(`Inspector Certificates (${orderedPersonnelCerts.length})`, MARGIN, MARGIN, { width: usableW });""",
    """      addNewPage();
      if (certBranchRef.current === null) {
        certBranchRef.current = makeTocBranch("Certification");
      }
      doc.font(FONT_BOLD).fontSize(FONT_SIZE_SUB).fillColor("#000");
      doc.text(`${certBranchRef.current.sub("Inspector Certificates")} Inspector Certificates (${orderedPersonnelCerts.length})`, MARGIN, MARGIN, { width: usableW });""",
)
rep(
    """    const equipCerts = certificates.filter((c) => c.category === "EQUIPMENT");
    const personnelCerts = certificates.filter((c) => c.category === "PERSONNEL");""",
    """    const equipCerts = certificates.filter((c) => c.category === "EQUIPMENT");
    const personnelCerts = certificates.filter((c) => c.category === "PERSONNEL");
    const certBranchRef: { current: ReturnType<typeof makeTocBranch> | null } = { current: null };""",
)

open(P, "w").write(s)
print("\\n".join(log))
print(f"PART 3 DONE — {len(log)} edits")
