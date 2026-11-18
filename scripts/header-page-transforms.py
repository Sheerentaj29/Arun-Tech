"""Req 1/2/3/5 transforms for pipeline-report.ts:
1. Test Results table: wrapped non-overlapping headings (dynamic header
   height, vertical centering), rowH 22->24, header repeats on continuation.
2. Weld-scan page-1 header: company 16pt bold + title 14pt bold (portrait
   logo boxes narrowed to 92pt so the 16pt name fits between them).
3. Info grid: "Isometric Drawing No." -> "Report No." (actual record value).
5. Compact 3-element header (logos + company + title) on EVERY page after
   page 1; addNewPage() returns the content-top Y; cert/drawing pages draw
   below it.
"""
import re

P = "/home/z/my-project/src/lib/pdf/pipeline-report.ts"
s = open(P).read()
n_orig = len(s)

def rep(old, new, count=1):
    global s
    c = s.count(old)
    assert c == count, f"expected {count} of {old[:70]!r}, found {c}"
    s = s.replace(old, new)

# ── contentTopY declaration (before first addNewPage CALL at runtime) ──
rep(
    "  let cursorY = MARGIN;\n",
    "  let cursorY = MARGIN;\n"
    "  // Y where page content may start on the CURRENT page. Page 1 content\n"
    "  // flows from cursorY after the full header; every page created by\n"
    "  // addNewPage() draws the compact repeated header and moves this down.\n"
    "  let contentTopY = MARGIN;\n",
)

# ── addNewPage(): draw compact repeated header, return content top ──
rep(
    """  const addNewPage = () => {
    doc.addPage({
      size: pageSize,
      margins: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
    });
    drawFooter();
  };
""",
    """  const addNewPage = () => {
    doc.addPage({
      size: pageSize,
      margins: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
    });
    drawFooter();

    // ── COMPACT REPEATED HEADER (every page after page 1) ──
    // Same 3-element layout as the front page, sized down so content still
    // has room: [ArunTech logo (left)] [company + report title (center)]
    // [client logo (right)]. Uniform size/position on all continuation
    // pages — including certificate pages (Req: compact version so two
    // certificates still fit on one page).
    const cLogoH = 34;
    const cLogoW = 92;
    const cPad = 8;
    const company = "ARUN TECH INDUSTRIAL SERVICES PVT LTD";
    const cCenterX = MARGIN + cLogoW + cPad;
    const cCenterW = usableW - 2 * (cLogoW + cPad);
    doc.font(FONT_BOLD).fontSize(8).fillColor("#000");
    doc.text(company, cCenterX, MARGIN + 3, { width: cCenterW, align: "center" });
    doc.font(FONT_BOLD).fontSize(10).fillColor("#000");
    doc.text(titleText, cCenterX, MARGIN + 15, { width: cCenterW, align: "center" });
    doc.fillColor("#000");
    drawLogoInBox(serviceLogoPath, MARGIN, MARGIN, cLogoW, cLogoH, "ARUNTECH\\nLogo");
    drawLogoInBox(clientLogoPath, pageW - MARGIN - cLogoW, MARGIN, cLogoW, cLogoH, "Client\\nLogo");

    contentTopY = MARGIN + cLogoH + 6;  // content starts below the header band
    return contentTopY;
  };
""",
)

# ── Page-1 weld-scan header: 16pt company + 14pt title, portrait-aware boxes ──
rep(
    """  // Logo box dimensions — shared by both header styles below so the
  // centered title block can stay clear of the two logo boxes.
  const logoH = 70;
  const logoW = 130;
""",
    """  // Logo box dimensions — shared by both header styles below so the
  // centered title block can stay clear of the two logo boxes. Portrait
  // narrows the boxes so the 16pt company name fits between them
  // (measured: Geist Bold 16pt company name ≈ 341pt; usableW ≈ 539pt →
  // center column at logoW 92 + 5pt pad = 345pt ≥ 341pt).
  const logoH = 70;
  const logoW = orientation === "landscape" ? 130 : 92;
""",
)
rep(
    """    const companyName = "ARUN TECH INDUSTRIAL SERVICES PVT LTD";
    const centerX = MARGIN + logoW + 14;
    const centerW = usableW - 2 * (logoW + 14);
    doc.font(FONT_BOLD).fontSize(10).fillColor("#000");
    doc.text(companyName, centerX, cursorY + 13, { width: centerW, align: "center" });
    doc.font(FONT_BOLD).fontSize(15).fillColor("#000");
    doc.text(titleText, centerX, cursorY + 27, { width: centerW, align: "center" });
""",
    """    const companyName = "ARUN TECH INDUSTRIAL SERVICES PVT LTD";
    const hPad = orientation === "landscape" ? 14 : 5;
    const centerX = MARGIN + logoW + hPad;
    const centerW = usableW - 2 * (logoW + hPad);
    doc.font(FONT_BOLD).fontSize(16).fillColor("#000");   // company name: 16 pt bold
    doc.text(companyName, centerX, cursorY + 6, { width: centerW, align: "center" });
    doc.font(FONT_BOLD).fontSize(14).fillColor("#000");   // report title: 14 pt bold
    doc.text(titleText, centerX, cursorY + 30, { width: centerW, align: "center" });
""",
)

# ── Req 3: Isometric Drawing No. -> Report No. (3 info-grid branches) ──
rep(
    '["Isometric Drawing No.", report.isometricDrawingNumber],',
    '["Report No.", report.reportNumber],',
    count=3,
)

# ── y-reset call sites: addNewPage now returns the content top ──
s = s.replace("addNewPage(); y = MARGIN; }", "y = addNewPage(); }")
s = s.replace("{ addNewPage(); y = MARGIN; }", "{ y = addNewPage(); }")
s = re.sub(r"addNewPage\(\); y = MARGIN;", "y = addNewPage();", s)
s = re.sub(r"addNewPage\(\);\n(\s+)y = MARGIN;\n", lambda m: f"y = addNewPage();\n", s)

# Body start + TOC page
rep(
    "  addNewPage();\n  let y: number = MARGIN;\n",
    "  let y: number = addNewPage();\n",
)
rep(
    "  addNewPage();\n  {\n    let ty = MARGIN;",
    "  const tocTopY = addNewPage();\n  {\n    let ty = tocTopY;",
)

# ── Certificate section: content below compact header ──
rep("const top = start === 0 ? firstPageTop : MARGIN;", "const top = start === 0 ? firstPageTop : contentTopY;")
rep("await renderCertSection(equipCerts.slice(2), MARGIN);", "await renderCertSection(equipCerts.slice(2), contentTopY);")
rep("await renderCertSection(orderedPersonnelCerts.slice(2), MARGIN);", "await renderCertSection(orderedPersonnelCerts.slice(2), contentTopY);")
# continuation fresh page after a multi-page PDF certificate (3 sites)
rep("await drawCertificateInSlot(pair[1], MARGIN, MARGIN, usableW, pageMaxY - MARGIN);",
    "await drawCertificateInSlot(pair[1], MARGIN, contentTopY, usableW, pageMaxY - contentTopY);", count=1)
rep("await drawCertificateInSlot(firstPair[1], MARGIN, MARGIN, usableW, pageMaxY - MARGIN);",
    "await drawCertificateInSlot(firstPair[1], MARGIN, contentTopY, usableW, pageMaxY - contentTopY);", count=2)
# equipment section page headings
rep('doc.text(`${certBranch.main()}. Certification`, MARGIN, MARGIN, { width: usableW });',
    'doc.text(`${certBranch.main()}. Certification`, MARGIN, contentTopY, { width: usableW });')
rep('doc.text(`${certBranch.sub("Instrument Calibration")} Instrument Calibration (${equipCerts.length})`, MARGIN, MARGIN + 26, { width: usableW });',
    'doc.text(`${certBranch.sub("Instrument Calibration")} Instrument Calibration (${equipCerts.length})`, MARGIN, contentTopY + 26, { width: usableW });')
rep("const firstTop = MARGIN + 66; // below the two headings",
    "const firstTop = contentTopY + 66; // below the two headings")
# personnel section page heading
rep('doc.text(`${certBranchRef.current.sub("Inspector Certificates")} Inspector Certificates (${orderedPersonnelCerts.length})`, MARGIN, MARGIN, { width: usableW });',
    'doc.text(`${certBranchRef.current.sub("Inspector Certificates")} Inspector Certificates (${orderedPersonnelCerts.length})`, MARGIN, contentTopY, { width: usableW });')
rep("const firstTop = MARGIN + 50; // below the sub-heading",
    "const firstTop = contentTopY + 50; // below the sub-heading")
# multi-page PDF certificate continuation page (caption + image below header)
rep('doc.text(cert.title || "Certificate", MARGIN, MARGIN, { width: usableW, align: "center" });',
    'doc.text(cert.title || "Certificate", MARGIN, contentTopY, { width: usableW, align: "center" });')
rep('doc.text(`File: ${cert.fileName}  |  Page ${p + 1} of ${pageBuffers.length}`, MARGIN, MARGIN + 16, { width: usableW, align: "center" });',
    'doc.text(`File: ${cert.fileName}  |  Page ${p + 1} of ${pageBuffers.length}`, MARGIN, contentTopY + 16, { width: usableW, align: "center" });')
rep("const fullY = MARGIN + CERT_CAPTION_H;",
    "const fullY = contentTopY + CERT_CAPTION_H;")

# ── Drawing pages: draw below the compact header ──
rep("""  imgBuf: Buffer,
  pageNo: number,
  totalPages: number,
  pageW: number,
  pageH: number,
) {""",
    """  imgBuf: Buffer,
  pageNo: number,
  totalPages: number,
  pageW: number,
  pageH: number,
  contentTop: number,
) {""")
rep("""  const headerH = 36;
  const captionH = 18;
  const availW = pageW - 2 * MARGIN;
  const availH = pageH - MARGIN - headerH - captionH;
  const boxX = MARGIN;
  const boxY = MARGIN + headerH;

  // Drawing header
  doc.font(FONT_BOLD).fontSize(11).fillColor("#000");
  doc.text(drawing.title || "Drawing", MARGIN, MARGIN, {
    width: availW, align: "center",
  });
  doc.font(FONT_REGULAR).fontSize(8).fillColor("#444");
  const subLine =""",
    """  const headerH = 36;
  const captionH = 18;
  const availW = pageW - 2 * MARGIN;
  const availH = pageH - contentTop - MARGIN - captionH - headerH;
  const boxX = MARGIN;
  const boxY = contentTop + headerH;

  // Drawing header
  doc.font(FONT_BOLD).fontSize(11).fillColor("#000");
  doc.text(drawing.title || "Drawing", MARGIN, contentTop, {
    width: availW, align: "center",
  });
  doc.font(FONT_REGULAR).fontSize(8).fillColor("#444");
  const subLine =""")
rep("doc.text(subLine, MARGIN, MARGIN + 16, { width: availW, align: \"center\" });",
    "doc.text(subLine, MARGIN, contentTop + 16, { width: availW, align: \"center\" });")
rep("doc.text(locLine, MARGIN, MARGIN + 30, { width: availW, align: \"center\" });",
    "doc.text(locLine, MARGIN, contentTop + 30, { width: availW, align: \"center\" });")

rep("""function drawDrawingPlaceholder(
  doc: Doc,
  drawing: LinkedDrawing,
  message: string,
  pageW: number,
  pageH: number,
) {
  const availW = pageW - 2 * MARGIN;
  const headerH = 36;
  const boxY = MARGIN + headerH;
  const boxH = pageH - MARGIN - headerH - 30;

  // Header
  doc.font(FONT_BOLD).fontSize(11).fillColor("#000");
  doc.text(drawing.title || "Drawing", MARGIN, MARGIN, {
    width: availW, align: "center",
  });
  doc.font(FONT_REGULAR).fontSize(8).fillColor("#444");
  doc.text(
    `Drawing No: ${drawing.drawingNumber}    |    Revision: ${drawing.revisionNumber}    |    Type: ${drawing.drawingType}`,
    MARGIN, MARGIN + 16,
    { width: availW, align: "center" },
  );""",
    """function drawDrawingPlaceholder(
  doc: Doc,
  drawing: LinkedDrawing,
  message: string,
  pageW: number,
  pageH: number,
  contentTop: number,
) {
  const availW = pageW - 2 * MARGIN;
  const headerH = 36;
  const boxY = contentTop + headerH;
  const boxH = pageH - contentTop - MARGIN - headerH - 30;

  // Header
  doc.font(FONT_BOLD).fontSize(11).fillColor("#000");
  doc.text(drawing.title || "Drawing", MARGIN, contentTop, {
    width: availW, align: "center",
  });
  doc.font(FONT_REGULAR).fontSize(8).fillColor("#444");
  doc.text(
    `Drawing No: ${drawing.drawingNumber}    |    Revision: ${drawing.revisionNumber}    |    Type: ${drawing.drawingType}`,
    MARGIN, contentTop + 16,
    { width: availW, align: "center" },
  );""")

# drawing call sites — pass contentTopY (5 sites)
s = s.replace("drawDrawingImagePage(doc, drawing, pageBuffers[p], p + 1, pageBuffers.length, pageW, pageH);",
              "drawDrawingImagePage(doc, drawing, pageBuffers[p], p + 1, pageBuffers.length, pageW, pageH, contentTopY);")
s = s.replace("drawDrawingImagePage(doc, drawing, imgBuf, 1, 1, pageW, pageH);",
              "drawDrawingImagePage(doc, drawing, imgBuf, 1, 1, pageW, pageH, contentTopY);")
s = s.replace("          pageW, pageH,\n        );", "          pageW, pageH, contentTopY,\n        );")
s = s.replace("            pageW, pageH,\n          );", "            pageW, pageH, contentTopY,\n          );")

open(P, "w").write(s)
print(f"transforms applied ({n_orig} -> {len(s)} chars)")
