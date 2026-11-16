"""Req 2 + Req 3 for the PDF generator:
- Weld Scan Test Results headings get full forms + units.
- Table heading/content fonts and geometry restored to the previous sizes
  (six pure helper functions are restored verbatim from git HEAD; in-branch
  constants are reverted individually).
- The 16/14 section-heading hierarchy, TOC, photo grid and all new features
  stay untouched.
"""
import re

P = "/home/z/my-project/src/lib/pdf/pipeline-report.ts"
ORIG = "/tmp/orig-pdf.ts"
s = open(P).read()
o = open(ORIG).read()
log = []


def rep(old, new, expected=1):
    global s
    n = s.count(old)
    if n == 0 and new in s:
        log.append(f"[skip] {old[:56]!r}")
        return
    assert n == expected, f"expected {expected}, found {n}: {old[:80]!r}"
    s = s.replace(old, new)
    log.append(f"[{n}x] {old[:56]!r}")


def function_body(text, name):
    """Extract 'function NAME(...) { ... }' up to the matching closing brace."""
    m = re.search(r"^(async )?function " + re.escape(name) + r"\(", text, re.M)
    assert m, f"{name} not found"
    start = m.start()
    i = text.index("{", m.end())
    depth = 0
    j = i
    while True:
        c = text[j]
        if c == "{":
            depth += 1
        elif c == "}":
            depth -= 1
            if depth == 0:
                break
        j += 1
    return text[start:j + 1]


# ── Req 2: Test Results headings with full forms and units (PDF) ──
rep(
    '      ["Sl. No", "Description", "Identification No.", "Weld Type", "Probe", "BP", "SD", "Depth", "Echo Height", "Length", "Observation", "Result"],',
    '      ["Sl. No", "Description", "Identification No.", "Weld Type", "Probe", "Beam Path (BP) (mm)", "Skip Distance (SD) (mm)", "Depth (mm)", "Echo Height (%)", "Length (mm)", "Observation", "Result"],',
)
rep(
    "      [0.55, 1.5, 1.35, 1, 1, 0.7, 0.7, 0.9, 1.1, 0.9, 1.55, 0.95],",
    "      [0.5, 1.35, 1.2, 0.9, 0.9, 1.1, 1.2, 0.9, 1.05, 0.95, 1.35, 0.9],",
)

# ── Req 3: restore the six pure table helpers verbatim from git HEAD ──
for name in ["drawDptTableHeader", "drawVisualTableHeader", "drawTableHeader",
             "drawDptRow", "drawMeasurementRow", "drawVisualObservationRow"]:
    cur = function_body(s, name)
    orig = function_body(o, name)
    if cur == orig:
        log.append(f"[skip identical] {name}")
        continue
    s = s.replace(cur, orig)
    log.append(f"[restored] {name}")

rep("const tableHeaderH = 70;", "const tableHeaderH = 36;")
rep("(rowH - 15) / 2", "(rowH - 10) / 2", 3)
rep("(rowH2 - 15) / 2", "(rowH2 - 10) / 2")

# ── Weld-scan multi-column tables: header 6pt, content 6.5pt, h28/r22 ──
rep(
    """      const headerH = 40;
      const rowH = 30;""",
    """      const headerH = 28;
      const rowH = 22;""",
)
rep(
    """        let x = MARGIN;
        doc.font(FONT_BOLD).fontSize(FONT_SIZE_BODY).fillColor(TABLE_HEADER_FG);
        for (let i = 0; i < headers.length; i++) {
          if (i > 0) doc.moveTo(x, headerY).lineTo(x, headerY + headerH).stroke(TABLE_INNER_BORDER);
          doc.text(headers[i], x + 2, headerY + 14, { width: colWidths[i] - 4, align: "center" });
          x += colWidths[i];
        }""",
    """        let x = MARGIN;
        doc.font(FONT_BOLD).fontSize(6).fillColor(TABLE_HEADER_FG);
        for (let i = 0; i < headers.length; i++) {
          if (i > 0) doc.moveTo(x, headerY).lineTo(x, headerY + headerH).stroke(TABLE_INNER_BORDER);
          doc.text(headers[i], x + 2, headerY + 8, { width: colWidths[i] - 4, align: "center" });
          x += colWidths[i];
        }""",
)
rep(
    """          doc.rect(x, y, colW, rowH).stroke(TABLE_INNER_BORDER);
          doc.font(FONT_REGULAR).fontSize(FONT_SIZE_BODY).fillColor("#000");""",
    """          doc.rect(x, y, colW, rowH).stroke(TABLE_INNER_BORDER);
          doc.font(FONT_REGULAR).fontSize(6.5).fillColor("#000");""",
)

# ── Scanning Details table: previous 7pt labels/values, rowH 18 ──
rep(
    """    const drawWsScanningDetails = () => {
      const rowH = 26;""",
    """    const drawWsScanningDetails = () => {
      const rowH = 18;""",
)
rep(
    """        doc.rect(MARGIN, y, labelW, rowH).fill("#ecfeff");
        doc.font(FONT_BOLD).fontSize(FONT_SIZE_BODY).fillColor("#000");
        doc.text(left[0], MARGIN + 3, y + 6, { width: labelW - 6 });
        doc.rect(MARGIN + labelW, y, valueW, rowH).fill("#ffffff");
        doc.font(FONT_REGULAR).fontSize(FONT_SIZE_BODY).fillColor("#000");
        const lv = left[1] && String(left[1]).trim() ? String(left[1]).trim() : "";
        doc.text(lv, MARGIN + labelW + 3, y + 6, { width: valueW - 6 });
        doc.rect(MARGIN + labelW + valueW, y, labelW, rowH).fill("#ecfeff");
        doc.font(FONT_BOLD).fontSize(FONT_SIZE_BODY).fillColor("#000");
        doc.text(right[0], MARGIN + labelW + valueW + 3, y + 6, { width: labelW - 6 });
        doc.rect(MARGIN + 2 * labelW + valueW, y, valueW, rowH).fill("#ffffff");
        doc.font(FONT_REGULAR).fontSize(FONT_SIZE_BODY).fillColor("#000");
        const rv = right[1] && String(right[1]).trim() ? String(right[1]).trim() : "";
        doc.text(rv, MARGIN + 2 * labelW + valueW + 3, y + 6, { width: valueW - 6 });""",
    """        doc.rect(MARGIN, y, labelW, rowH).fill("#ecfeff");
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
        doc.text(rv, MARGIN + 2 * labelW + valueW + 3, y + 5, { width: valueW - 6 });""",
)

# ── In-branch header/row height constants back to previous ──
rep("const headerH = 46;", "const headerH = 36;", 4)
rep("const rowH = 34;", "const rowH = 28;", 4)
rep("const vHeaderH = 46;", "const vHeaderH = 36;", 4)
rep("const vRowH = 34;", "const vRowH = 28;", 4)
rep("const dptHeaderH = 46;", "const dptHeaderH = 36;")
rep("const dptRowH = 34;", "const dptRowH = 28;")
rep('const rowH2 = orientation === "landscape" ? 34 : 30;',
    'const rowH2 = orientation === "landscape" ? 28 : 22;')
rep("const pRowH = 26;", "const pRowH = 20;", 4)
rep("const dHeaderH = 42;", "const dHeaderH = 30;", 2)
rep("const dRowH = 36;", "const dRowH = 30;", 2)

# Probe/details header cell offsets (utm variant 7, others 8)
rep(
    'doc.text(pHeaders[i], x + 2, headerY + 14, { width: pColWidths[i] - 4, align: "center" });',
    'doc.text(pHeaders[i], x + 2, headerY + 7, { width: pColWidths[i] - 4, align: "center" });',
    4,
)
rep(
    'doc.text(dHeaders[i], x + 2, headerY + 14, { width: dColWidths[i] - 4, align: "center" });',
    'doc.text(dHeaders[i], x + 2, headerY + 8, { width: dColWidths[i] - 4, align: "center" });',
    2,
)
rep("headerY + 14,", "headerY + 8,", 5)

# ── UT Thickness readings tables: previous compact geometry + widths ──
rep("const vHeaderH = 64;", "const vHeaderH = 26;")
rep("const uHeaderH = 64;", "const uHeaderH = 26;")
rep("const tHeaderH = 64;", "const tHeaderH = 26;")
rep("const vLineH = 13;", "const vLineH = 8;")
rep("const uLineH = 13;", "const uLineH = 8;")
rep("const tLineH = 13;", "const tLineH = 8;")
rep("const vMinRowH = 24;", "const vMinRowH = 18;")
rep("const uMinRowH = 24;", "const uMinRowH = 18;")
rep("const tMinRowH = 24;", "const tMinRowH = 18;")
rep("? { moc: 52, comp: 86, id: 70, nom: 64, dir: 62, min: 72 }",
    "? { moc: 58, comp: 78, id: 48, nom: 44, dir: 42, min: 48 }")
rep(": { moc: 44, comp: 66, id: 44, nom: 52, dir: 50, min: 50 };",
    ": { moc: 44, comp: 56, id: 36, nom: 32, dir: 34, min: 38 };")
rep("? { moc: 52, comp: 86, id: 70, nom: 64, min: 72 }",
    "? { moc: 62, comp: 80, id: 52, nom: 46, min: 48 }")
rep(": { moc: 46, comp: 66, id: 44, nom: 52, min: 50 };",
    ": { moc: 46, comp: 58, id: 38, nom: 34, min: 38 };")
rep("? { moc: 52, comp: 86, id: 66, nom: 64, min: 72 }",
    "? { moc: 62, comp: 80, id: 60, nom: 46, min: 48 }")
rep(": { moc: 46, comp: 66, id: 48, nom: 52, min: 50 };",
    ": { moc: 46, comp: 58, id: 44, nom: 34, min: 38 };")

# UT cell helpers: drop the 12pt clamp (restore param sizes 6.5/7)
rep(
    'doc.font(bold ? FONT_BOLD : FONT_REGULAR).fontSize(Math.max(fontSize, FONT_SIZE_BODY)).fillColor("#000");',
    'doc.font(bold ? FONT_BOLD : FONT_REGULAR).fontSize(fontSize).fillColor("#000");',
    2,
)
rep("(rowH - Math.max(fontSize, FONT_SIZE_BODY) - 1) / 2 + 1",
    "(rowH - fontSize - 1) / 2 + 1", 2)

# Remaining readings/probe/details header fonts → 6.5 (after helper restore)
rep(
    """          let x = MARGIN;
          doc.font(FONT_BOLD).fontSize(FONT_SIZE_BODY).fillColor(TABLE_HEADER_FG);
          const headers: Array<[string, number]> = [""",
    """          let x = MARGIN;
          doc.font(FONT_BOLD).fontSize(6.5).fillColor(TABLE_HEADER_FG);
          const headers: Array<[string, number]> = [""",
)
rep(
    """        let x = MARGIN;
        doc.font(FONT_BOLD).fontSize(FONT_SIZE_BODY).fillColor(TABLE_HEADER_FG);
        const headers: Array<[string, number]> = [""",
    """        let x = MARGIN;
        doc.font(FONT_BOLD).fontSize(6.5).fillColor(TABLE_HEADER_FG);
        const headers: Array<[string, number]> = [""",
)
rep(
    """      let x = MARGIN;
      doc.font(FONT_BOLD).fontSize(FONT_SIZE_BODY).fillColor(TABLE_HEADER_FG);
      const headers: Array<[string, number]> = [""",
    """      let x = MARGIN;
      doc.font(FONT_BOLD).fontSize(6.5).fillColor(TABLE_HEADER_FG);
      const headers: Array<[string, number]> = [""",
)
rep(
    """        let x = MARGIN;
        doc.font(FONT_BOLD).fontSize(FONT_SIZE_BODY).fillColor(TABLE_HEADER_FG);
        for (let i = 0; i < pHeaders.length; i++) {""",
    """        let x = MARGIN;
        doc.font(FONT_BOLD).fontSize(6.5).fillColor(TABLE_HEADER_FG);
        for (let i = 0; i < pHeaders.length; i++) {""",
    4,
)
rep(
    """        let x = MARGIN;
        doc.font(FONT_BOLD).fontSize(FONT_SIZE_BODY).fillColor(TABLE_HEADER_FG);
        for (let i = 0; i < dHeaders.length; i++) {""",
    """        let x = MARGIN;
        doc.font(FONT_BOLD).fontSize(6.5).fillColor(TABLE_HEADER_FG);
        for (let i = 0; i < dHeaders.length; i++) {""",
    2,
)

# Consumable table widths back to previous
rep("? [86, 130, 200, 130, Math.max(100, consUsable - 86 - 130 - 200 - 130)]",
    "? [70, 130, 210, 130, Math.max(100, consUsable - 70 - 130 - 210 - 130)]", 2)
rep(": [70, 90, 150, 90, Math.max(80, consUsable - 70 - 90 - 150 - 90)]",
    ": [55, 90, 150, 90, Math.max(80, consUsable - 55 - 90 - 150 - 90)]", 2)

# DPT details: Size of Indication column back to previous
rep('const vSizeW = orientation === "landscape" ? 124 : 100;',
    'const vSizeW = orientation === "landscape" ? 90 : 80;')
rep('const vSizeW = orientation === "landscape" ? 124 : 100;',
    'const vSizeW = orientation === "landscape" ? 85 : 75;', 3)

# Thickness measurement table columns back to previous
rep(
    '''  { key: "diaInch",   header: "Dia mm\\n(inch)",            width: 54 },
  { key: "schedule",  header: "Pipe\\nSchedule",             width: 66 },
  { key: "nominal",   header: "Nominal\\nThickness\\n(mm)",   width: 66 },
  { key: "component", header: "Component\\nType",            width: 74 },
  { key: "pointNo",   header: "Point\\nNo",                   width: 48 },
  { key: "north",     header: "12 o'clock\\nNorth\\n(mm)",     width: 58, vertical: true },
  { key: "east",      header: "3 o'clock\\nEast\\n(mm)",       width: 58, vertical: true },
  { key: "south",     header: "6 o'clock\\nSouth\\n(mm)",      width: 58, vertical: true },
  { key: "west",      header: "9 o'clock\\nWest\\n(mm)",       width: 58, vertical: true },
  { key: "obsMin",    header: "Observed\\nMinimum\\n(mm)",     width: 62, vertical: true },''',
    '''  { key: "diaInch",   header: "Dia mm\\n(inch)",            width: 50 },
  { key: "schedule",  header: "Pipe\\nSchedule",             width: 55 },
  { key: "nominal",   header: "Nominal\\nThickness\\n(mm)",   width: 55 },
  { key: "component", header: "Component\\nType",            width: 60 },
  { key: "pointNo",   header: "Point\\nNo",                   width: 40 },
  { key: "north",     header: "12 o'clock\\nNorth\\n(mm)",     width: 55, vertical: true },
  { key: "east",      header: "3 o'clock\\nEast\\n(mm)",       width: 55, vertical: true },
  { key: "south",     header: "6 o'clock\\nSouth\\n(mm)",      width: 55, vertical: true },
  { key: "west",      header: "9 o'clock\\nWest\\n(mm)",       width: 55, vertical: true },
  { key: "obsMin",    header: "Observed\\nMinimum\\n(mm)",     width: 60, vertical: true },''',
)

# Certificate sheet titles back to 11pt
rep('doc.font(FONT_BOLD).fontSize(FONT_SIZE_SUB).fillColor("#000");\n      doc.text(cert.title || "Certificate", MARGIN, MARGIN, { width: usableW, align: "center" });',
    'doc.font(FONT_BOLD).fontSize(11).fillColor("#000");\n      doc.text(cert.title || "Certificate", MARGIN, MARGIN, { width: usableW, align: "center" });', 2)
rep('doc.font(FONT_BOLD).fontSize(FONT_SIZE_SUB).fillColor("#000");\n            doc.text(cert.title || "Certificate", MARGIN, MARGIN, { width: usableW, align: "center" });',
    'doc.font(FONT_BOLD).fontSize(11).fillColor("#000");\n            doc.text(cert.title || "Certificate", MARGIN, MARGIN, { width: usableW, align: "center" });')
rep('doc.font(FONT_BOLD).fontSize(FONT_SIZE_SUB).fillColor("#000");\n                    doc.text(cert.title || "Certificate", MARGIN, MARGIN, { width: usableW, align: "center" });',
    'doc.font(FONT_BOLD).fontSize(11).fillColor("#000");\n                    doc.text(cert.title || "Certificate", MARGIN, MARGIN, { width: usableW, align: "center" });', 2)
rep('doc.font(FONT_BOLD).fontSize(FONT_SIZE_SUB).fillColor("#000");\n          doc.text(cert.title || "Certificate", MARGIN, certHeaderY, { width: usableW, align: "center" });',
    'doc.font(FONT_BOLD).fontSize(11).fillColor("#000");\n          doc.text(cert.title || "Certificate", MARGIN, certHeaderY, { width: usableW, align: "center" });', 2)

# Condition assessment grid back to previous label/value size (9pt)
rep("const minRowH = 22;\n  const fontSizeInfo = 12;",
    "const minRowH = 16;\n  const fontSizeInfo = 9;")

open(P, "w").write(s)
print("\n".join(log))
print(f"DONE — {len(log)} edits")
