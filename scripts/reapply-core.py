"""Re-apply core PDF features (final styling) — part 1:
two-pass TOC, constants, TOC page, primary-photo heading removal,
drawHeadingAndBody registration, findings/drawings/thickness/visual/condition
TOC wiring, body page-break fix, sharp image loading.
All anchors asserted; aborts before writing on any mismatch.
"""
P = "/home/z/my-project/src/lib/pdf/pipeline-report.ts"
s = open(P).read()
log = []


def rep(old, new, expected=1):
    global s
    n = s.count(old)
    assert n == expected, f"expected {expected}, found {n}: {old[:90]!r}"
    s = s.replace(old, new)
    log.append(f"[{n}x] {old[:60]!r}")


# A. stream import
rep(
    'import PDFDocument from "pdfkit";\nimport type { Writable } from "stream";',
    'import PDFDocument from "pdfkit";\nimport type { Writable } from "stream";\nimport { PassThrough } from "stream";',
)

# B. Font-size hierarchy constants + TocEntry
rep(
    """// Fall back to Helvetica if Geist TTFs are not found (shouldn't happen)
const FONT_REGULAR = existsSync(GEIST_REGULAR) ? "GeistSans" : "Helvetica";
const FONT_BOLD = existsSync(GEIST_BOLD) ? "GeistSans-Bold" : "Helvetica-Bold";""",
    """// Fall back to Helvetica if Geist TTFs are not found (shouldn't happen)
const FONT_REGULAR = existsSync(GEIST_REGULAR) ? "GeistSans" : "Helvetica";
const FONT_BOLD = existsSync(GEIST_BOLD) ? "GeistSans-Bold" : "Helvetica-Bold";

// ─── Heading hierarchy: main section headings 16pt, subsection/table-group
// headings 14pt. Table headings and table contents keep their established
// compact engineering sizes (see the individual table helpers).
const FONT_SIZE_MAIN = 16;
const FONT_SIZE_SUB = 14;
const FONT_SIZE_BODY = 12;

// ─── Table of Contents entries (collected during the first render pass) ───
interface TocEntry {
  num: string;      // "1", "2.1", ...
  title: string;
  page: number;     // absolute page number where the heading is drawn
  level: 1 | 2;     // 1 = main section, 2 = subsection
}""",
)

# C. Two-pass wrapper + internal runGeneration
rep(
    """export async function generatePipelineReportPdf(
  input: PdfReportInput,
  out: Writable,
  orientation: "landscape" | "portrait" = "landscape",
): Promise<void> {""",
    """export async function generatePipelineReportPdf(
  input: PdfReportInput,
  out: Writable,
  orientation: "landscape" | "portrait" = "landscape",
): Promise<void> {
  // ── Two-pass generation (accurate Table of Contents page numbers) ──
  //   Pass 1 renders the whole report into a discard sink with the TOC page
  //   reserved (one page, heading only) and records the exact page number of
  //   every section heading along the way. Pass 2 re-renders with the
  //   collected entries written onto the reserved TOC page — the body layout
  //   is identical in both passes, so the recorded page numbers are exact.
  const collected: TocEntry[] = [];
  {
    const sink = new PassThrough();
    sink.resume();
    await new Promise<void>((resolve, reject) => {
      sink.on("finish", () => resolve());
      sink.on("error", reject);
      runGeneration(input, sink, orientation, null, collected).catch(reject);
    });
  }
  await runGeneration(input, out, orientation, collected, []);
}

async function runGeneration(
  input: PdfReportInput,
  out: Writable,
  orientation: "landscape" | "portrait",
  tocData: TocEntry[] | null,
  collected: TocEntry[],
): Promise<void> {""",
)

# D. TOC counters/helpers before the page-1 footer
rep(
    """  // Footer for page 1
  drawFooter();""",
    """  // ── TOC registration (fills `collected` during both passes) ──
  // `pageNo` is maintained by drawFooter() — it is the exact page number
  // printed in the footer, which is what the TOC must show.
  let tocMainCount = 0;
  const tocSubCounts = new Map<number, number>();
  const tocMainEntry = (title: string): number => {
    const num = ++tocMainCount;
    collected.push({ num: String(num), title, page: pageNo, level: 1 });
    return num;
  };
  const tocSubEntry = (mainNum: number, title: string): string => {
    const sub = (tocSubCounts.get(mainNum) ?? 0) + 1;
    tocSubCounts.set(mainNum, sub);
    collected.push({ num: `${mainNum}.${sub}`, title, page: pageNo, level: 2 });
    return `${mainNum}.${sub}`;
  };
  // A test-type branch registers its main section lazily (at the page where
  // its first subsection heading is drawn) and exposes `sub()` returning the
  // rendered "3.1"-style number so drawn headings always match the TOC.
  const makeTocBranch = (title: string) => {
    let mainNum: number | null = null;
    const main = (): number => {
      if (mainNum === null) mainNum = tocMainEntry(title);
      return mainNum;
    };
    return {
      main,
      sub: (subTitle: string): string => tocSubEntry(main(), subTitle),
    };
  };
  // The test-type branch currently being rendered — the shared photo gallery
  // registers itself as a subsection of it.
  let currentTestBranch: ReturnType<typeof makeTocBranch> | null = null;

  // Footer for page 1
  drawFooter();""",
)

# E. General Information entry + reserved TOC page
rep(
    """  // After the first page (header + sign-off), start a new page for
  // the remaining sections.""",
    """  // ── TOC entry 1: General Information (the front page just rendered) ──
  tocMainEntry("General Information");

  // ═══════════════════════════════════════════════════════════════
  // TABLE OF CONTENTS — page 2, immediately after the front page.
  // Pass 1 draws only the heading (the page is reserved so every body
  // page number is already final); pass 2 fills in the collected section
  // entries with their exact page numbers.
  // ═══════════════════════════════════════════════════════════════
  addNewPage();
  {
    let ty = MARGIN;
    doc.font(FONT_BOLD).fontSize(FONT_SIZE_MAIN).fillColor("#000");
    doc.text("TABLE OF CONTENTS", MARGIN, ty, { width: usableW });
    ty += 28;
    doc.moveTo(MARGIN, ty - 8).lineTo(pageW - MARGIN, ty - 8).stroke(TABLE_OUTER_BORDER);
    ty += 8;
    if (tocData) {
      for (const e of tocData) {
        const isMain = e.level === 1;
        const indent = isMain ? 0 : 18;
        const label = isMain ? `${e.num}. ${e.title}` : `${e.num}  ${e.title}`;
        const pageStr = String(e.page);
        const pageStrW = doc.widthOfString(pageStr);
        // Manual truncation keeps every entry on one line (drawing without
        // `width` avoids pdfkit's LineWrapper and any phantom page breaks).
        const maxLabelW = pageW - 2 * MARGIN - indent - pageStrW - 30;
        let label2 = label;
        if (doc.widthOfString(label2) > maxLabelW) {
          const keep = Math.floor((maxLabelW / Math.max(1, doc.widthOfString(label2))) * label2.length);
          label2 = label2.slice(0, Math.max(1, keep - 1)) + "…";
        }
        doc.font(isMain ? FONT_BOLD : FONT_REGULAR).fontSize(FONT_SIZE_BODY).fillColor("#000");
        const labelX = MARGIN + indent;
        doc.text(label2, labelX, ty, { lineBreak: false });
        // Dotted leader between the title and the right-aligned page number.
        const dotStart = labelX + doc.widthOfString(label2) + 6;
        const dotEnd = pageW - MARGIN - pageStrW - 6;
        if (dotEnd > dotStart + 8) {
          doc.font(FONT_REGULAR).fontSize(FONT_SIZE_BODY).fillColor("#9ca3af");
          const dot = " .";
          const dotW = doc.widthOfString(dot);
          for (let dx = dotStart; dx + dotW < dotEnd; dx += dotW) {
            doc.text(dot, dx, ty, { lineBreak: false });
          }
          doc.fillColor("#000");
        }
        doc.font(isMain ? FONT_BOLD : FONT_REGULAR).fontSize(FONT_SIZE_BODY).fillColor("#000");
        doc.text(pageStr, pageW - MARGIN - pageStrW, ty, { lineBreak: false });
        ty += isMain ? 22 : 17;
      }
    }
    doc.fillColor("#000");
  }

  // After the first page (header + sign-off), start a new page for
  // the remaining sections.""",
)

# F. Primary photo heading removal (photo stays)
rep(
    """    // Calculate the available vertical space:
    //   signOffY      = top of the sign-off block (anchored to page bottom)
    //   cursorY       = bottom of the client details grid
    //   12pt gap      = breathing room above the sign-off separator line
    //   20pt label    = "Primary Inspection Photo" heading height
    //   8pt margin    = small gap below the heading before the image
    const labelH = 20;
    const gapAboveSignOff = 14;
    const gapBelowLabel = 8;
    const photoAvailH = signOffY - gapAboveSignOff - cursorY - labelH - gapBelowLabel;

    if (photoAvailH > 40) {
      try {
        const photoBuf = readFileSync(primaryPhotoPath);

        // Draw the label heading
        doc.font(FONT_BOLD).fontSize(10).fillColor("#000");
        doc.text("Primary Inspection Photo", MARGIN, cursorY + 4, {
          width: usableW, align: "left",
        });
        cursorY += labelH;

        // Available area for the image
        const photoAvailW = usableW;
        const imageTopY = cursorY + gapBelowLabel;""",
    """    // Calculate the available vertical space:
    //   signOffY      = top of the sign-off block (anchored to page bottom)
    //   cursorY       = bottom of the client details grid
    //   12pt gap      = breathing room above the sign-off separator line
    //   (the "Primary Inspection Photo" heading is intentionally NOT drawn
    //   per report spec — the photograph itself stays on the front page)
    //   8pt margin    = small gap above the image
    const gapAboveSignOff = 14;
    const gapBelowLabel = 8;
    const photoAvailH = signOffY - gapAboveSignOff - cursorY - gapBelowLabel;

    if (photoAvailH > 40) {
      try {
        const photoBuf = await loadEmbeddableImage(primaryPhotoPath);
        if (!photoBuf) throw new Error("primary photo unreadable");

        // Available area for the image
        const photoAvailW = usableW;
        const imageTopY = cursorY + gapBelowLabel;""",
)

# G. loadEmbeddableImage helper (after readImageBuffer)
rep(
    """function readImageBuffer(filePath: string): Buffer | null {
  try {
    if (!existsSync(filePath)) return null;
    return readFileSync(filePath);
  } catch {
    return null;
  }
}""",
    """function readImageBuffer(filePath: string): Buffer | null {
  try {
    if (!existsSync(filePath)) return null;
    return readFileSync(filePath);
  } catch {
    return null;
  }
}

// Load an image file as a buffer pdfkit can embed. PNG/JPEG pass through
// untouched; other formats (e.g. webp — which pdfkit cannot embed and would
// otherwise render as "[Image Unreadable]") are rasterized to PNG via sharp.
async function loadEmbeddableImage(filePath: string): Promise<Buffer | null> {
  const buf = readImageBuffer(filePath);
  if (!buf) return null;
  const ext = (filePath.split(".").pop() ?? "").toLowerCase();
  if (ext === "png" || ext === "jpg" || ext === "jpeg") return buf;
  try {
    const mod = await import("sharp");
    // sharp's CJS/ESM interop: the callable factory may sit on .default
    type SharpFn = (b: Buffer) => { png: () => { toBuffer: () => Promise<Buffer> } };
    const sharp = (((mod as unknown as { default?: SharpFn }).default ?? mod) as unknown) as SharpFn;
    return await sharp(buf).png().toBuffer();
  } catch {
    return buf; // fall back to the raw buffer; embed failure is handled by the caller
  }
}""",
)

# H. drawPhotoCell: pre-loaded buffer + wrapper-proof caption
rep(
    """function drawPhotoCell(
  doc: Doc,
  photo: ReportPhoto,
  x: number,
  y: number,
  photoW: number,
  photoH: number,
  fontRegular: string,
) {
  // 1. Fill the cell with white first — handles transparent PNGs and gives
  //    a consistent background regardless of the image's own background.
  doc.rect(x, y, photoW, photoH).fill("#ffffff");

  // 2. Embed the image (fitted, centered, aspect ratio preserved).
  //    The image is drawn inside a 2pt inset so the border stays crisp.
  if (photo.filePath && existsSync(photo.filePath)) {
    try {
      const imgBuf = readFileSync(photo.filePath);
      doc.image(imgBuf, x + 2, y + 2, {""",
    """function drawPhotoCell(
  doc: Doc,
  photo: ReportPhoto,
  x: number,
  y: number,
  photoW: number,
  photoH: number,
  fontRegular: string,
  preBuf?: Buffer | null,
) {
  // 1. Fill the cell with white first — handles transparent PNGs and gives
  //    a consistent background regardless of the image's own background.
  doc.rect(x, y, photoW, photoH).fill("#ffffff");

  // 2. Embed the image (fitted, centered, aspect ratio preserved).
  //    The image is drawn inside a 2pt inset so the border stays crisp.
  if (photo.filePath && (preBuf !== undefined ? preBuf : existsSync(photo.filePath))) {
    try {
      const imgBuf = preBuf !== undefined ? preBuf : readFileSync(photo.filePath);
      if (!imgBuf) throw new Error("unreadable");
      doc.image(imgBuf, x + 2, y + 2, {""",
)
rep(
    """  doc.font(fontRegular).fontSize(7).fillColor("#333");
  let caption = photo.caption || photo.fileName || "";
  const maxCaptionW = photoW;
  if (doc.widthOfString(caption) > maxCaptionW) {
    const charsToKeep = Math.floor(
      (maxCaptionW / Math.max(1, doc.widthOfString(caption))) * caption.length,
    );
    caption = caption.slice(0, Math.max(1, charsToKeep - 1)) + "…";
  }
  doc.text(caption, x, y + photoH + 2, { width: photoW, align: "center" });
  doc.fillColor("#000");""",
    """  doc.font(fontRegular).fontSize(FONT_SIZE_BODY).fillColor("#333");
  let caption = photo.caption || photo.fileName || "";
  const maxCaptionW = photoW;
  if (doc.widthOfString(caption) > maxCaptionW) {
    const charsToKeep = Math.floor(
      (maxCaptionW / Math.max(1, doc.widthOfString(caption))) * caption.length,
    );
    caption = caption.slice(0, Math.max(1, charsToKeep - 1)) + "…";
  }
  // Center manually and draw WITHOUT `width`/LineWrapper: a caption near the
  // page bottom must never trigger pdfkit's automatic page-break (which
  // would silently move the current page and misplace the following cells).
  const capW = doc.widthOfString(caption);
  const capX = capW >= maxCaptionW ? x : x + (maxCaptionW - capW) / 2;
  doc.text(caption, capX, y + photoH + 2, { lineBreak: false });
  doc.fillColor("#000");""",
)

open(P, "w").write(s)
print("\\n".join(log))
print(f"PART 1 DONE — {len(log)} edits")
