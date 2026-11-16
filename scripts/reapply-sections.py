"""Re-apply PDF features part 2: section TOC wiring, per-branch numbered
headings (14pt subs / 16pt mains), Weld Scan Test Results headings with full
forms + units, Scanning Details rewrite, 2x3 photo gallery, certification.
Final styling: tables keep the previous compact sizes."""
P = "/home/z/my-project/src/lib/pdf/pipeline-report.ts"
s = open(P).read()
log = []


def rep(old, new, expected=1):
    global s
    n = s.count(old)
    assert n == expected, f"expected {expected}, found {n}: {old[:90]!r}"
    s = s.replace(old, new)
    log.append(f"[{n}x] {old[:58]!r}")


# ── drawHeadingAndBody: new defaults + onPage TOC hook ──
rep(
    """  const drawHeadingAndBody = (
    headingText: string,
    bodyText: string,
    gapBefore = 8,
    gapAfter = 14,
    headingFontSize = 9,
    bodyFontSize = 8,
  ) => {""",
    """  const drawHeadingAndBody = (
    headingText: string,
    bodyText: string,
    gapBefore = 8,
    gapAfter = 14,
    headingFontSize = FONT_SIZE_SUB,
    bodyFontSize = FONT_SIZE_BODY,
    onPage?: () => void,
  ) => {""",
)
rep(
    """    if (y + needed > pageMaxY) {
      addNewPage();
      y = MARGIN;
    }
    // Draw heading
    y += gapBefore;
    doc.font(FONT_BOLD).fontSize(headingFontSize).fillColor("#000");
    doc.text(headingText, MARGIN, y, { width: usableW });""",
    """    if (y + needed > pageMaxY) {
      addNewPage();
      y = MARGIN;
    }
    // TOC registration — AFTER the page-break decision, so the recorded
    // page number is the page the heading actually lands on.
    if (onPage) onPage();
    // Draw heading
    y += gapBefore;
    doc.font(FONT_BOLD).fontSize(headingFontSize).fillColor("#000");
    doc.text(headingText, MARGIN, y, { width: usableW });""",
)

# ── Findings sections: one "Inspection Details" TOC main + subsections ──
rep(
    """  // ── 1. INSPECTION DESCRIPTION ──
  if (report.inspectionDescription) {
    drawHeadingAndBody(
      "Inspection Description",
      report.inspectionDescription,
      10,  // larger gap before this section
      14,
      9,
      8,
    );
  }""",
    """  // Findings sections share one TOC main section ("Inspection Details");
  // it is registered lazily at the first drawn findings heading.
  let inspectionDetailsMain: number | null = null;
  const detailsMain = (): number => {
    if (inspectionDetailsMain === null) inspectionDetailsMain = tocMainEntry("Inspection Details");
    return inspectionDetailsMain;
  };

  // ── 1. INSPECTION DESCRIPTION ──
  if (report.inspectionDescription) {
    drawHeadingAndBody(
      "Inspection Description",
      report.inspectionDescription,
      10,  // larger gap before this section
      14,
      FONT_SIZE_SUB,
      FONT_SIZE_BODY,
      () => tocSubEntry(detailsMain(), "Inspection Description"),
    );
  }""",
)
for title in ["Summary Of Site Observations", "Results", "Conclusion"]:
    rep(
        f'''      drawHeadingAndBody(
        "{title}",
        text,
        8,
        14,
        9,
        8,
      );''',
        f'''      drawHeadingAndBody(
        "{title}",
        text,
        8,
        14,
        FONT_SIZE_SUB,
        FONT_SIZE_BODY,
        () => tocSubEntry(detailsMain(), "{title}"),
      );''',
    )

# ── Engineering Drawings TOC registration ──
rep(
    """  const includeDrawings = !NO_DRAWINGS_REPORT_TYPES.includes(reportType);
  if (includeDrawings) {
    for (const drawing of linkedDrawings) {""",
    """  const includeDrawings = !NO_DRAWINGS_REPORT_TYPES.includes(reportType);
  if (includeDrawings) {
    let drawingsRegistered = false;
    const registerDrawingsToc = () => {
      if (!drawingsRegistered) {
        drawingsRegistered = true;
        tocMainEntry("Engineering Drawings");
      }
    };
    for (const drawing of linkedDrawings) {""",
)
rep("addNewPage();\n        drawDrawingPlaceholder(",
    "addNewPage();\n        registerDrawingsToc();\n        drawDrawingPlaceholder(", 2)
rep("addNewPage();\n          drawDrawingImagePage(doc, drawing, pageBuffers[p]",
    "addNewPage();\n          registerDrawingsToc();\n          drawDrawingImagePage(doc, drawing, pageBuffers[p]", 1)
rep("addNewPage();\n        drawDrawingImagePage(doc, drawing, imgBuf, 1, 1, pageW, pageH);",
    "addNewPage();\n        registerDrawingsToc();\n        drawDrawingImagePage(doc, drawing, imgBuf, 1, 1, pageW, pageH);", 1)

# ── Thickness branch: dynamic numbering + 16/14 headings ──
rep(
    """    // ── Draw the parent section heading: "7. Thickness Measurement" ──
    {
      const parentHeading = thicknessSectionHeading();
      const parentH = 20;""",
    """    const thicknessBranch = makeTocBranch("Thickness Measurement");

    // ── Draw the parent section heading: "<N>. Thickness Measurement" ──
    // (N is the dynamically assigned TOC section number)
    {
      const parentH = 24;""",
)
rep(
    """      if (y + neededH > pageMaxY) {
        addNewPage();
      }
      doc.font(FONT_BOLD).fontSize(12).fillColor("#1f2937");
      doc.text(parentHeading, MARGIN, y, { width: pageW - 2 * MARGIN, align: "left" });
      y += parentH;""",
    """      if (y + neededH > pageMaxY) {
        addNewPage();
      }
      const thMain = thicknessBranch.main();
      currentTestBranch = thicknessBranch;
      doc.font(FONT_BOLD).fontSize(FONT_SIZE_MAIN).fillColor("#1f2937");
      doc.text(`${thMain}. Thickness Measurement`, MARGIN, y, { width: pageW - 2 * MARGIN, align: "left" });
      y += parentH;""",
)
rep(
    """        const entry = thicknessTableHeading(i + 1, tables[i].label);""",
    """        const entry = `${thicknessBranch.main()}.${i + 1} – ${tables[i].label}`;""",
)
rep(
    """      const tableNumberedHeading = thicknessTableHeading(tIdx + 1, table.label);""",
    """      const tableNumberedHeading = `${thicknessBranch.main()}.${tIdx + 1} – ${table.label}`;""",
)
rep(
    """        doc.font(FONT_BOLD).fontSize(11).fillColor("#1f2937");
        doc.text(tableNumberedHeading, MARGIN, y, { width: pageW - 2 * MARGIN, align: "left" });""",
    """        tocSubEntry(thicknessBranch.main(), table.label);
        doc.font(FONT_BOLD).fontSize(FONT_SIZE_SUB).fillColor("#1f2937");
        doc.text(tableNumberedHeading, MARGIN, y, { width: pageW - 2 * MARGIN, align: "left" });""",
)
rep(
    """            doc.font(FONT_BOLD).fontSize(10).fillColor("#1f2937");
            doc.text(`${tableNumberedHeading} (continued)`, MARGIN, MARGIN, { width: pageW - 2 * MARGIN, align: "left" });""",
    """            doc.font(FONT_BOLD).fontSize(FONT_SIZE_SUB).fillColor("#1f2937");
            doc.text(`${tableNumberedHeading} (continued)`, MARGIN, MARGIN, { width: pageW - 2 * MARGIN, align: "left" });""",
)
rep(
    """import {
  parseThicknessTablesConfig,
  DEFAULT_TABLE_ID,
  thicknessSectionHeading,
  thicknessTableHeading,
  type ThicknessTableConfig,
} from "@/lib/thickness-tables";""",
    """import {
  parseThicknessTablesConfig,
  DEFAULT_TABLE_ID,
  type ThicknessTableConfig,
} from "@/lib/thickness-tables";""",
)

# ── Visual branch: main heading + registration ──
rep(
    """    const visColWidths = calcColumnWidths(visCols, pageW);
    startBodyOnFreshPage(tableHeaderH + rowH2);
    drawVisualTableHeader(doc, visCols, visColWidths, y, pageW);""",
    """    const visColWidths = calcColumnWidths(visCols, pageW);
    const visualBranch = makeTocBranch("Visual Inspection");
    currentTestBranch = visualBranch;
    startBodyOnFreshPage(tableHeaderH + rowH2);
    doc.font(FONT_BOLD).fontSize(FONT_SIZE_MAIN).fillColor("#1f2937");
    doc.text(`${visualBranch.main()}. Visual Inspection Observations`, MARGIN, y,
      { width: pageW - 2 * MARGIN, align: "left" });
    y += 28;
    tocSubEntry(visualBranch.main(), "Visual Observations Table");
    drawVisualTableHeader(doc, visCols, visColWidths, y, pageW);""",
)

# ── Condition branch: registration at drawn heading ──
rep(
    """function drawConditionAssessment(
  doc: Doc,
  report: any,
  startY: number,
  pageW: number,
  _pageH: number,
  margin: number,
  maxRowY: number,
  addNewPage: () => void,
): number {""",
    """function drawConditionAssessment(
  doc: Doc,
  report: any,
  startY: number,
  pageW: number,
  _pageH: number,
  margin: number,
  maxRowY: number,
  addNewPage: () => void,
  registerMain?: () => void,
): number {""",
)
rep(
    """  // Section heading
  if (y + 20 > maxRowY) { addNewPage(); y = margin; }
  doc.font(FONT_BOLD).fontSize(11).fillColor("#000");
  doc.text("Condition Assessment", margin, y, { width: pageW - 2 * margin, align: "left" });""",
    """  // Section heading
  if (y + 20 > maxRowY) { addNewPage(); y = margin; }
  if (registerMain) registerMain();
  doc.font(FONT_BOLD).fontSize(FONT_SIZE_MAIN).fillColor("#000");
  doc.text("Condition Assessment", margin, y, { width: pageW - 2 * margin, align: "left" });""",
)
rep(
    """    startBodyOnFreshPage(80);
    y = drawConditionAssessment(doc, report as any, y, pageW, pageH, MARGIN, pageMaxY, addNewPage);""",
    """    const conditionBranch = makeTocBranch("Condition Assessment");
    currentTestBranch = conditionBranch;
    startBodyOnFreshPage(80);
    y = drawConditionAssessment(doc, report as any, y, pageW, pageH, MARGIN, pageMaxY, addNewPage,
      () => conditionBranch.main());""",
)

# ── Body always starts on a fresh page after the reserved TOC page ──
rep(
    """  // Only create a new page for findings if there IS findings content to
  // render. If all four findings fields are empty AND there are drawings
  // (which each get their own page), creating a blank page here would
  // leave an empty page between the cover and the first drawing.
  // So we check whether any findings text exists before calling addNewPage().
  const hasFindingsContent =
    !!((report as any).inspectionDescription && report.inspectionDescription!.trim()) ||
    !!((report as any).siteObservationSummary && (report as any).siteObservationSummary.trim()) ||
    !!((report as any).results && (report as any).results.trim()) ||
    !!((report as any).conclusion && (report as any).conclusion.trim());
  if (hasFindingsContent) {
    addNewPage();
    // Initialize y for the findings sections
    y = MARGIN;
  } else {
    // No findings content — y stays at 0. The drawings section and
    // startBodyOnFreshPage will create pages as needed. If there are
    // no drawings either, startBodyOnFreshPage will create a page for
    // the body content (measurement table, DPT observations, etc.).
    y = 0;
  }""",
    """  // The TOC page (page 2) is RESERVED for the table of contents itself — the
  // report body always starts on a fresh page, whether or not findings content
  // exists. (Before the TOC existed, `y = 0` acted as a "no page yet" sentinel
  // that let startBodyOnFreshPage create the body page lazily; with the TOC
  // page as the current page that sentinel drew body content ON TOP of the TOC.)
  addNewPage();
  let y: number = MARGIN;""",
)

open(P, "w").write(s)
print("\\n".join(log))
print(f"PART 2 DONE — {len(log)} edits")
