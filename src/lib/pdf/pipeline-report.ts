// Server-side PDF generator for the Pipeline Thickness Measurement Report.
// Uses pdfkit (pure JS, no native deps) and the system `pdftoppm` binary
// (poppler-utils) to rasterize PDF drawing pages into PNG buffers.
//
// Design principles:
//   1. Header layout is fully deterministic — every y position is
//      calculated from the previous block's measured height plus an
//      explicit gap. No text is ever drawn at a "magic" y coordinate,
//      so the title can NEVER overlap the subtitle, logos, or info grid.
//   2. Orientation handling: pdfkit's `size` (a 2-element [w,h] array)
//      is the source of truth for page dimensions. We do NOT also pass
//      `layout: orientation`, because that flag tells pdfkit to swap
//      width/height — which (combined with the array form of `size`)
//      produced portrait dimensions even when landscape was requested.
//   3. Drawings appear BEFORE the measurement table. Each drawing image
//      (PNG/JPG/JPEG/WEBP) gets one full page, centered, preserving
//      aspect ratio. Each page of an uploaded PDF drawing is rasterized
//      via pdftoppm and embedded as a separate page, preserving the
//      source page's orientation and aspect ratio.
//   4. If no drawings are attached, the measurement table starts on the
//      same page as the header (if there's room) or on a fresh page.
//   5. Page order: cover/header → drawings (one per page) → measurement
//      table → inspection description → findings → comments → photos →
//      sign-off.

import PDFDocument from "pdfkit";
import type { Writable } from "stream";
import type {
  PipelineInspection,
  ThicknessMeasurement,
  Client,
  Plant,
  User,
  ReportPhoto,
} from "@prisma/client";
import { readFileSync, existsSync } from "fs";
import { execFile } from "child_process";
import { promisify } from "util";
import { tmpdir } from "os";
import { join } from "path";
import { mkdtempSync, readdirSync, unlinkSync, rmdirSync } from "fs";

const execFileAsync = promisify(execFile);

export interface LinkedDrawing {
  id: string;
  title: string;
  drawingNumber: string;
  drawingType: string;
  revisionNumber: string;
  fileName: string;
  filePath: string;
  fileExtension: string;
  mimeType: string;
  clientName?: string | null;
  plantName?: string | null;
}

export interface PdfReportInput {
  report: PipelineInspection & {
    client: Pick<Client, "id" | "name">;
    plant: Pick<Plant, "id" | "name" | "location" | "address">;
    inspector: Pick<User, "id" | "name" | "email">;
    approver: Pick<User, "id" | "name" | "email"> | null;
    reportPhotos?: ReportPhoto[];
  };
  measurements: ThicknessMeasurement[];
  photos?: ReportPhoto[];
  linkedDrawings?: LinkedDrawing[];
}

type Doc = PDFDocument.PDFDocument;

// A4 in points (1pt = 1/72 inch). We pass the [w,h] array directly as
// `size`, so for landscape we use [841.89, 595.28] (w>h) and for portrait
// [595.28, 841.89]. We do NOT also pass `layout`, because that flag
// re-swaps the dimensions.
const PAGE_SIZES = {
  landscape: [841.89, 595.28] as [number, number],
  portrait: [595.28, 841.89] as [number, number],
};

const MARGIN = 28;
const HEADER_BG = "#3a7d3a";
const HEADER_FG = "#ffffff";

interface Column {
  key: string;
  header: string;
  width: number;
  vertical?: boolean;
}

const SYSTEM_COLUMNS_LANDSCAPE: Column[] = [
  { key: "diaInch",   header: "Dia mm\n(inch)",            width: 50 },
  { key: "schedule",  header: "Pipe\nSchedule",             width: 55 },
  { key: "nominal",   header: "Nominal\nThickness\n(mm)",   width: 55 },
  { key: "component", header: "Component\nType",            width: 60 },
  { key: "pointNo",   header: "Point\nNo",                   width: 40 },
  { key: "north",     header: "12 o'clock\nNorth\n(mm)",     width: 55, vertical: true },
  { key: "east",      header: "3 o'clock\nEast\n(mm)",       width: 55, vertical: true },
  { key: "south",     header: "6 o'clock\nSouth\n(mm)",      width: 55, vertical: true },
  { key: "west",      header: "9 o'clock\nWest\n(mm)",       width: 55, vertical: true },
  { key: "obsMin",    header: "Observed\nMinimum\n(mm)",     width: 60, vertical: true },
  { key: "findings",  header: "Findings / Comments",         width: 0 },
];

const SYSTEM_COLUMNS_PORTRAIT: Column[] = [
  { key: "diaInch",   header: "Dia\n(inch)",    width: 35 },
  { key: "schedule",  header: "Schedule",        width: 42 },
  { key: "nominal",   header: "Nominal\n(mm)",   width: 42 },
  { key: "component", header: "Type",            width: 40 },
  { key: "pointNo",   header: "Pt\nNo",          width: 28 },
  { key: "north",     header: "N\n(mm)",         width: 38 },
  { key: "east",      header: "E\n(mm)",         width: 38 },
  { key: "south",     header: "S\n(mm)",         width: 38 },
  { key: "west",      header: "W\n(mm)",         width: 38 },
  { key: "obsMin",    header: "Min\n(mm)",       width: 42 },
  { key: "findings",  header: "Findings / Comments", width: 0 },
];

function calcColumnWidths(columns: Column[], pageWidth: number): number[] {
  const usable = pageWidth - 2 * MARGIN;
  let fixed = 0;
  for (const c of columns) if (c.width > 0) fixed += c.width;
  const fillW = usable - fixed;
  return columns.map((c) => (c.width > 0 ? c.width : Math.max(100, fillW)));
}

function getCustomColumns(report: any): Array<{ id: string; name: string; unit: string }> {
  try {
    const cc = JSON.parse(report.customColumns || "[]");
    if (Array.isArray(cc)) return cc;
  } catch {}
  return [];
}

function getCustomColumnValue(measurement: any, colId: string): string {
  try {
    const vals = JSON.parse(measurement.customColumnValues || "{}");
    return vals[colId] ?? "";
  } catch { return ""; }
}

function fmtMeasurement(v: number | null, status: string): string {
  if (status === "NotApplicable") return "N/A";
  if (status === "NotMeasured" || v === null || v === undefined) return "—";
  return v.toFixed(2);
}

/**
 * Render every page of a PDF file to PNG buffers using the system
 * `pdftoppm` (poppler-utils) binary. Returns an array of PNG buffers
 * in page order (one buffer per page).
 *
 * Falls back to an empty array if the binary or file is unavailable,
 * so the rest of the report can still be generated.
 */
async function rasterizePdfPages(pdfPath: string): Promise<Buffer[]> {
  if (!existsSync(pdfPath)) return [];
  const tmpDir = mkdtempSync(join(tmpdir(), "pdf-raster-"));
  const outPrefix = join(tmpDir, "page");
  try {
    // -png : output PNG
    // -r 150 : 150 DPI — high enough for print, low enough for fast raster
    await execFileAsync("pdftoppm", [
      "-png",
      "-r", "150",
      pdfPath,
      outPrefix,
    ], { timeout: 60_000, maxBuffer: 20 * 1024 * 1024 });
    // pdftoppm pads page numbers with leading zeros. List and sort.
    const files = readdirSync(tmpDir)
      .filter((f) => f.startsWith("page-") && f.endsWith(".png"))
      .sort((a, b) => {
        const na = parseInt(a.replace(/[^0-9]/g, ""), 10);
        const nb = parseInt(b.replace(/[^0-9]/g, ""), 10);
        return na - nb;
      });
    return files.map((f) => readFileSync(join(tmpDir, f)));
  } catch (err) {
    console.error(`[pdf] rasterizePdfPages failed for ${pdfPath}:`, (err as Error).message);
    return [];
  } finally {
    // Clean up tmp dir
    try {
      const files = readdirSync(tmpDir);
      for (const f of files) {
        try { unlinkSync(join(tmpDir, f)); } catch {}
      }
      try { rmdirSync(tmpDir); } catch {}
    } catch {}
  }
}

/**
 * Read an image file into a buffer. Returns null if the file is missing
 * or unreadable.
 */
function readImageBuffer(filePath: string): Buffer | null {
  try {
    if (!existsSync(filePath)) return null;
    return readFileSync(filePath);
  } catch {
    return null;
  }
}

/**
 * Compute the (width, height) at which to draw an image inside a
 * bounding box, preserving aspect ratio (no stretching, no cropping).
 */
function fitInside(
  imgW: number,
  imgH: number,
  boxW: number,
  boxH: number,
): { w: number; h: number; x: number; y: number } {
  if (imgW <= 0 || imgH <= 0) {
    // Unreadable image dimensions — fill the box minimally
    return { w: boxW, h: boxH * 0.6, x: 0, y: boxH * 0.2 };
  }
  const ratio = Math.min(boxW / imgW, boxH / imgH);
  const w = imgW * ratio;
  const h = imgH * ratio;
  // Center inside the box
  const x = (boxW - w) / 2;
  const y = (boxH - h) / 2;
  return { w, h, x, y };
}

/**
 * Get the intrinsic pixel dimensions of an image buffer so we can
 * preserve its aspect ratio when fitting it on a page.
 */
function imageSize(buf: Buffer, doc: Doc): { w: number; h: number } {
  try {
    // pdfkit exposes `doc.image` which can compute the intrinsic size
    // by passing `fit: [1, 1]` and reading back. But the simplest
    // approach is to call `doc.image(buf, 0, 0, { fit: [1, 1] })` then
    // check `doc.y` — that's brittle. Instead, parse PNG/JPEG headers.
    if (buf.length < 24) return { w: 0, h: 0 };
    // PNG: bytes 0-7 = signature, then IHDR chunk with width (4 bytes BE) + height (4 bytes BE)
    if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
      const w = buf.readUInt32BE(16);
      const h = buf.readUInt32BE(20);
      return { w, h };
    }
    // JPEG: scan for SOF0 (0xFFC0) or SOF2 (0xFFC2) marker
    if (buf[0] === 0xff && buf[1] === 0xd8) {
      let i = 2;
      while (i < buf.length - 9) {
        if (buf[i] !== 0xff) { i++; continue; }
        const marker = buf[i + 1];
        // SOF0, SOF1, SOF2, SOF3 etc carry the dimensions
        if (
          (marker >= 0xc0 && marker <= 0xc3) ||
          (marker >= 0xc5 && marker <= 0xc7) ||
          (marker >= 0xc9 && marker <= 0xcb) ||
          (marker >= 0xcd && marker <= 0xcf)
        ) {
          const h = buf.readUInt16BE(i + 5);
          const w = buf.readUInt16BE(i + 7);
          return { w, h };
        }
        // Skip this marker segment
        const segLen = buf.readUInt16BE(i + 2);
        i += 2 + segLen;
      }
    }
    // WebP / TIFF / others — fall back to pdfkit's own probing by
    // drawing invisibly with fit:[1,1] and reading the resulting size.
    // This is a last resort and may not be accurate.
    return { w: 0, h: 0 };
  } catch {
    return { w: 0, h: 0 };
  }
}

export async function generatePipelineReportPdf(
  input: PdfReportInput,
  out: Writable,
  orientation: "landscape" | "portrait" = "landscape",
): Promise<void> {
  const pageSize = PAGE_SIZES[orientation];
  const pageW = pageSize[0];
  const pageH = pageSize[1];

  const doc = new PDFDocument({
    size: pageSize,           // ← [w, h] array, NO `layout` flag (it would re-swap)
    margins: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
    info: {
      Title: `Pipeline Thickness Measurement Report ${input.report.reportNumber}`,
      Author: input.report.inspectorName,
      Subject: input.report.pipelineDescription ?? "UT Thickness Measurement",
      Producer: "Inspection Report Automation System",
    },
  });
  doc.pipe(out);

  const report = input.report;
  const measurements = input.measurements;
  const allPhotos = input.photos ?? input.report.reportPhotos ?? [];
  const customCols = getCustomColumns(report);
  const linkedDrawings = input.linkedDrawings ?? (report as any).linkedDrawings ?? [];

  // Determine columns: system + custom
  const systemCols = orientation === "landscape"
    ? SYSTEM_COLUMNS_LANDSCAPE
    : SYSTEM_COLUMNS_PORTRAIT;
  const allCols: Column[] = [
    ...systemCols,
    ...customCols.map((cc) => ({
      key: `custom_${cc.id}`,
      header: cc.name + (cc.unit ? `\n(${cc.unit})` : ""),
      width: orientation === "landscape" ? 60 : 40,
    })),
  ];
  const colWidths = calcColumnWidths(allCols, pageW);

  let pageNo = 0;
  const drawFooter = () => {
    pageNo += 1;
    doc.fontSize(7).fillColor("#666").font("Helvetica");
    const footerText =
      `Page ${pageNo} | Generated ${new Date().toISOString().slice(0, 19).replace("T", " ")} | Inspection Report Automation System`;
    // IMPORTANT: we draw the footer BELOW the printable area (y = pageH - 18,
    // while the printable bottom is pageH - MARGIN = pageH - 28). If we used
    // `doc.text(footerText, x, y, { width, align: 'center' })`, pdfkit would
    // create a LineWrapper whose `maxY = pageH - bottomMargin`, then check
    // `document.y > maxY` (577 > 567) and trigger an automatic page-break,
    // pushing the footer (and every subsequent draw) onto a brand-new page —
    // producing a phantom empty page before every content page.
    //
    // To avoid that, we draw the footer without `width` and with
    // `lineBreak: false`. With no `width`, pdfkit skips the LineWrapper and
    // calls `_fragment` directly at the exact (x, y) — no page-break check.
    // We manually center the text by computing its width with `widthOfString`
    // and offsetting x.
    const footerW = doc.widthOfString(footerText);
    const footerX = MARGIN + (pageW - 2 * MARGIN - footerW) / 2;
    doc.text(footerText, footerX, pageH - 18, { lineBreak: false });
    doc.fillColor("#000");
  };

  const addNewPage = () => {
    doc.addPage({
      size: pageSize,
      margins: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
    });
    drawFooter();
  };

  // Footer for page 1
  drawFooter();

  // ═══════════════════════════════════════════════════════════════
  // PAGE 1: TITLE + SUBTITLE + LOGOS + HEADER INFO GRID
  //
  // Every y position is computed from the previous block's measured
  // height + an explicit gap. The title can NEVER overlap anything
  // else, no matter how long it is or how many lines it wraps to.
  // ═══════════════════════════════════════════════════════════════
  const usableW = pageW - 2 * MARGIN;
  let cursorY = MARGIN;

  // ── TITLE ──
  const titleFontSize = orientation === "landscape" ? 14 : 12;
  doc.font("Helvetica-Bold").fontSize(titleFontSize).fillColor("#000");
  const titleText = "PIPELINE THICKNESS MEASUREMENT REPORT";
  const titleHeight = doc.heightOfString(titleText, { width: usableW, align: "center" });
  doc.text(titleText, MARGIN, cursorY, { width: usableW, align: "center" });
  cursorY += titleHeight + 8;  // explicit 8pt gap below title

  // ── SUBTITLE (Report No | Rev | Date | Status) ──
  const subtitleFontSize = orientation === "landscape" ? 9 : 8;
  const subtitleText =
    `Report No: ${report.reportNumber}    |    Rev: ${report.revisionNumber}    |    ` +
    `Date: ${new Date(report.inspectionDate).toISOString().slice(0, 10)}    |    ` +
    `Status: ${report.status}`;
  doc.font("Helvetica").fontSize(subtitleFontSize).fillColor("#333");
  const subtitleHeight = doc.heightOfString(subtitleText, { width: usableW, align: "center" });
  doc.text(subtitleText, MARGIN, cursorY, { width: usableW, align: "center" });
  cursorY += subtitleHeight + 10;  // explicit 10pt gap below subtitle

  // ── LOGOS (positioned strictly below subtitle) ──
  const logoH = 34;
  const logoW = 110;
  // Left logo box
  doc.rect(MARGIN, cursorY, logoW, logoH).stroke("#999");
  doc.fontSize(7).fillColor("#666").font("Helvetica");
  doc.text("SERVICE COMPANY\nLOGO", MARGIN, cursorY + 10, {
    width: logoW, align: "center",
  });
  // Right logo box
  doc.rect(pageW - MARGIN - logoW, cursorY, logoW, logoH).stroke("#999");
  const clientShort = report.client.name.length > 28
    ? report.client.name.slice(0, 28)
    : report.client.name;
  doc.text(`${clientShort}\nCLIENT LOGO`, pageW - MARGIN - logoW, cursorY + 10, {
    width: logoW, align: "center",
  });
  doc.fillColor("#000");
  cursorY += logoH + 10;  // explicit 10pt gap below logos

  // ── HEADER INFO GRID ──
  // Two pairs of (label, value) per row. Each row's height is the
  // max wrapped height of its 4 cells, plus padding. Long values
  // (e.g. MOC) wrap to multiple lines without overlapping the next row.
  const labelW = orientation === "landscape" ? 150 : 110;
  const valueW = (pageW - 2 * MARGIN - 2 * labelW) / 2;
  const minRowH = 14;
  const fontSizeInfo = orientation === "landscape" ? 8 : 7;
  const cellPad = 4;

  const infoRows: Array<[string, string | null | undefined]> = [
    ["Client", report.client.name],
    ["Location", report.plant.location],
    ["Plant Name", report.plant.name],
    ["Inspection Area", report.inspectionArea],
    ["Pipeline Description", report.pipelineDescription],
    ["Pipeline Identification No.", report.pipelineIdentificationNumber],
    ["Isometric Drawing No.", report.isometricDrawingNumber],
    ["Material of Construction (MOC)", report.materialOfConstruction],
    ["Applicable Standard",
      `${report.applicableStandard ?? "—"} ${report.standardEdition ?? ""}`.trim()],
    ["Inspector", report.inspectorName],
  ];

  const maxRowY = pageH - MARGIN - 20;

  for (let i = 0; i < infoRows.length; i += 2) {
    const left = infoRows[i];
    const right = infoRows[i + 1] ?? ["", "—"];

    // Calculate wrapped heights for each cell in this pair
    doc.font("Helvetica-Bold").fontSize(fontSizeInfo);
    const leftLabelH = doc.heightOfString(left[0] ?? "", { width: labelW - 2 * cellPad });
    const rightLabelH = doc.heightOfString(right[0] ?? "", { width: labelW - 2 * cellPad });
    doc.font("Helvetica").fontSize(fontSizeInfo);
    const leftValStr = left[1] ?? "—";
    const rightValStr = right[1] ?? "—";
    const leftValH = doc.heightOfString(leftValStr, { width: valueW - 2 * cellPad });
    const rightValH = doc.heightOfString(rightValStr, { width: valueW - 2 * cellPad });

    const maxContentH = Math.max(leftLabelH, leftValH, rightLabelH, rightValH);
    const rowH = Math.max(minRowH, maxContentH + cellPad * 2);

    // If this row would overflow the page, push to next page
    if (cursorY + rowH > maxRowY) {
      addNewPage();
      cursorY = MARGIN;
    }

    // Draw left label cell
    doc.font("Helvetica-Bold").fontSize(fontSizeInfo).fillColor("#000");
    doc.rect(MARGIN, cursorY, labelW, rowH).stroke("#888");
    doc.text(left[0] ?? "", MARGIN + cellPad, cursorY + cellPad, {
      width: labelW - 2 * cellPad, align: "left", height: rowH - 2 * cellPad,
    });
    // Draw left value cell
    doc.font("Helvetica").fontSize(fontSizeInfo);
    doc.rect(MARGIN + labelW, cursorY, valueW, rowH).stroke("#888");
    doc.text(leftValStr, MARGIN + labelW + cellPad, cursorY + cellPad, {
      width: valueW - 2 * cellPad, align: "left", height: rowH - 2 * cellPad,
    });

    // Draw right label cell
    const rightX = MARGIN + labelW + valueW;
    doc.font("Helvetica-Bold").fontSize(fontSizeInfo);
    doc.rect(rightX, cursorY, labelW, rowH).stroke("#888");
    doc.text(right[0] ?? "", rightX + cellPad, cursorY + cellPad, {
      width: labelW - 2 * cellPad, align: "left", height: rowH - 2 * cellPad,
    });
    // Draw right value cell
    doc.font("Helvetica").fontSize(fontSizeInfo);
    doc.rect(rightX + labelW, cursorY, valueW, rowH).stroke("#888");
    doc.text(rightValStr, rightX + labelW + cellPad, cursorY + cellPad, {
      width: valueW - 2 * cellPad, align: "left", height: rowH - 2 * cellPad,
    });

    cursorY += rowH;
  }

  // ═══════════════════════════════════════════════════════════════
  // DRAWING PAGES — each drawing image (or each page of a PDF drawing)
  // gets its own full PDF page, centered, preserving aspect ratio.
  // Drawings appear BEFORE the measurement table.
  // ═══════════════════════════════════════════════════════════════
  for (const drawing of linkedDrawings) {
    const ext = (drawing.fileExtension || "").toLowerCase();
    const filePath = drawing.filePath;

    if (!filePath || !existsSync(filePath)) {
      // Missing file — still emit a placeholder page so the structure
      // is visible
      addNewPage();
      drawDrawingPlaceholder(
        doc, drawing,
        `[File missing on disk: ${drawing.fileName}]\n\nThe drawing file could not be found.`,
        pageW, pageH,
      );
      continue;
    }

    if (ext === ".pdf") {
      // Rasterize each page of the PDF drawing
      const pageBuffers = await rasterizePdfPages(filePath);
      if (pageBuffers.length === 0) {
        addNewPage();
        drawDrawingPlaceholder(
          doc, drawing,
          `[Could not rasterize PDF: ${drawing.fileName}]\n\n` +
          `The PDF could not be converted to images. The file may be corrupted ` +
          `or the conversion tool is unavailable.`,
          pageW, pageH,
        );
        continue;
      }
      // One output page per source PDF page
      for (let p = 0; p < pageBuffers.length; p++) {
        addNewPage();
        drawDrawingImagePage(doc, drawing, pageBuffers[p], p + 1, pageBuffers.length, pageW, pageH);
      }
    } else if (
      ext === ".png" || ext === ".jpg" || ext === ".jpeg" ||
      ext === ".webp" || ext === ".tif" || ext === ".tiff"
    ) {
      // Embed the image directly on its own page
      const imgBuf = readImageBuffer(filePath);
      if (!imgBuf) {
        addNewPage();
        drawDrawingPlaceholder(
          doc, drawing,
          `[Could not read image: ${drawing.fileName}]`,
          pageW, pageH,
        );
        continue;
      }
      addNewPage();
      drawDrawingImagePage(doc, drawing, imgBuf, 1, 1, pageW, pageH);
    } else {
      // DWG / DXF / unsupported — show a placeholder
      addNewPage();
      drawDrawingPlaceholder(
        doc, drawing,
        `[${ext.toUpperCase()} File: ${drawing.fileName}]\n\n` +
        `Preview is not available for native CAD formats. The original file ` +
        `is preserved on disk and can be downloaded separately.`,
        pageW, pageH,
      );
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // MEASUREMENT TABLE
  // If drawings were emitted, the table starts on a fresh page.
  // Otherwise, continue on the same page if there's room, else a new page.
  // ═══════════════════════════════════════════════════════════════
  const tableHeaderH = 36;
  const rowH2 = orientation === "landscape" ? 28 : 22;
  let y: number;

  if (linkedDrawings.length > 0) {
    addNewPage();
    drawTableHeader(doc, allCols, colWidths, MARGIN, pageW);
    y = MARGIN + tableHeaderH;
  } else {
    if (cursorY + tableHeaderH + rowH2 > maxRowY) {
      addNewPage();
      drawTableHeader(doc, allCols, colWidths, MARGIN, pageW);
      y = MARGIN + tableHeaderH;
    } else {
      cursorY += 10;
      drawTableHeader(doc, allCols, colWidths, cursorY, pageW);
      y = cursorY + tableHeaderH;
    }
  }

  // Table rows
  for (const m of measurements) {
    if (y + rowH2 > maxRowY) {
      addNewPage();
      drawTableHeader(doc, allCols, colWidths, MARGIN, pageW);
      y = MARGIN + tableHeaderH;
    }
    drawMeasurementRow(doc, m, allCols, colWidths, y, report, customCols);
    y += rowH2;
  }

  // ── INSPECTION DESCRIPTION ──
  if (report.inspectionDescription) {
    if (y + 60 > maxRowY) { addNewPage(); y = MARGIN; }
    y += 10;
    doc.font("Helvetica-Bold").fontSize(9).fillColor("#000");
    doc.text("Inspection Description", MARGIN, y);
    y += 14;
    doc.font("Helvetica").fontSize(8);
    const descHeight = doc.heightOfString(report.inspectionDescription, { width: pageW - 2 * MARGIN });
    doc.text(report.inspectionDescription, MARGIN, y, { width: pageW - 2 * MARGIN, align: "left" });
    y += descHeight + 6;
  }

  // ── FINDINGS SUMMARY ──
  if (report.findingsSummary) {
    if (y + 40 > maxRowY) { addNewPage(); y = MARGIN; }
    y += 8;
    doc.font("Helvetica-Bold").fontSize(9);
    doc.text("Findings Summary", MARGIN, y);
    y += 14;
    doc.font("Helvetica").fontSize(8);
    const findingsH = doc.heightOfString(report.findingsSummary ?? "—", { width: pageW - 2 * MARGIN });
    doc.text(report.findingsSummary ?? "—", MARGIN, y, { width: pageW - 2 * MARGIN, align: "left" });
    y += findingsH + 6;
  }

  // ── COMMENTS ──
  if (report.comments) {
    if (y + 30 > maxRowY) { addNewPage(); y = MARGIN; }
    y += 6;
    doc.font("Helvetica-Bold").fontSize(9);
    doc.text("Comments", MARGIN, y);
    y += 14;
    doc.font("Helvetica").fontSize(8);
    const commentsH = doc.heightOfString(report.comments ?? "—", { width: pageW - 2 * MARGIN });
    doc.text(report.comments ?? "—", MARGIN, y, { width: pageW - 2 * MARGIN, align: "left" });
    y += commentsH + 6;
  }

  // ── PHOTOGRAPHS (gallery) ──
  if (allPhotos.length > 0) {
    if (y + 100 > maxRowY) { addNewPage(); y = MARGIN; }
    y += 10;
    doc.font("Helvetica-Bold").fontSize(10).fillColor("#000");
    doc.text("Photographs", MARGIN, y);
    y += 20;

    const photoW = orientation === "landscape" ? 180 : 140;
    const photoH = orientation === "landscape" ? 120 : 95;
    const gap = 10;
    let photosPerRow = Math.floor((pageW - 2 * MARGIN + gap) / (photoW + gap));
    if (photosPerRow < 1) photosPerRow = 1;

    for (let i = 0; i < allPhotos.length; i++) {
      const photo = allPhotos[i];
      const col = i % photosPerRow;
      const row = Math.floor(i / photosPerRow);
      const px = MARGIN + col * (photoW + gap);
      const py = y + row * (photoH + 30);

      if (py + photoH + 20 > maxRowY) {
        addNewPage();
        y = MARGIN + 20;
      }

      doc.rect(px, py, photoW, photoH).stroke("#999");
      if (photo.filePath && existsSync(photo.filePath)) {
        try {
          const imgBuf = readFileSync(photo.filePath);
          doc.image(imgBuf, px + 1, py + 1, {
            fit: [photoW - 2, photoH - 2],
            align: "center",
            valign: "center",
          });
        } catch {
          doc.fillColor("#999").fontSize(7).font("Helvetica");
          doc.text("[Image unreadable]", px + 4, py + photoH / 2 - 5, {
            width: photoW - 8, align: "center",
          });
          doc.fillColor("#000");
        }
      } else {
        doc.fillColor("#999").fontSize(7).font("Helvetica");
        doc.text(`[File missing: ${photo.fileName}]`, px + 4, py + photoH / 2 - 5, {
          width: photoW - 8, align: "center",
        });
        doc.fillColor("#000");
      }

      doc.font("Helvetica").fontSize(7).fillColor("#333");
      const caption = photo.caption || photo.fileName;
      doc.text(caption, px, py + photoH + 2, { width: photoW, align: "center" });
      doc.fillColor("#000");
    }
    y += Math.ceil(allPhotos.length / photosPerRow) * (photoH + 30);
  }

  // ── SIGN-OFF ──
  if (y + 80 > maxRowY) { addNewPage(); y = MARGIN; }
  y += 10;
  doc.font("Helvetica-Bold").fontSize(9).fillColor("#000");
  doc.text("Sign-off", MARGIN, y);
  y += 18;

  const signW = (pageW - 2 * MARGIN - 2 * 8) / 3;
  const signBlocks = [
    {
      label: "Inspected by",
      name: report.inspectorName,
      dateVal: new Date(report.inspectionDate).toISOString().slice(0, 10),
    },
    {
      label: "Reviewed / Approved by",
      name: report.approver?.name ?? "—",
      dateVal: report.approvedAt
        ? new Date(report.approvedAt).toISOString().slice(0, 10)
        : "—",
    },
    {
      label: "Revision",
      name: `Rev ${report.revisionNumber}`,
      dateVal: report.status,
    },
  ];
  for (let i = 0; i < signBlocks.length; i++) {
    const b = signBlocks[i];
    const x = MARGIN + i * (signW + 8);
    doc.font("Helvetica").fontSize(7).fillColor("#666");
    doc.rect(x, y, signW, 50).stroke("#999");
    doc.text(b.label, x + 4, y + 4, { width: signW - 8 });
    doc.fillColor("#000");
    doc.font("Helvetica-Bold").fontSize(8);
    doc.text(b.name, x + 4, y + 16, { width: signW - 8 });
    doc.font("Helvetica").fontSize(7).fillColor("#666");
    doc.text(`Date / Status: ${b.dateVal}`, x + 4, y + 36, { width: signW - 8 });
    doc.fillColor("#000");
  }

  // ── OVERRIDE NOTE ──
  if (report.overrideReason) {
    y += 60;
    doc.font("Helvetica-Bold").fontSize(8).fillColor("#a00");
    doc.text("OVERRIDE APPLIED (recorded):", MARGIN, y, { width: 200 });
    doc.font("Helvetica").fillColor("#000").fontSize(7);
    doc.text(report.overrideReason, MARGIN + 140, y, {
      width: pageW - 2 * MARGIN - 140,
    });
  }

  doc.end();
}

// ─── DRAWING PAGE HELPERS ───

function drawDrawingImagePage(
  doc: Doc,
  drawing: LinkedDrawing,
  imgBuf: Buffer,
  pageNo: number,
  totalPages: number,
  pageW: number,
  pageH: number,
) {
  // Reserve top band for header (title + drawing number) and bottom
  // band for caption.
  const headerH = 36;
  const captionH = 18;
  const availW = pageW - 2 * MARGIN;
  const availH = pageH - MARGIN - headerH - captionH;
  const boxX = MARGIN;
  const boxY = MARGIN + headerH;

  // Drawing header
  doc.font("Helvetica-Bold").fontSize(11).fillColor("#000");
  doc.text(drawing.title || "Drawing", MARGIN, MARGIN, {
    width: availW, align: "center",
  });
  doc.font("Helvetica").fontSize(8).fillColor("#444");
  const subLine =
    `Drawing No: ${drawing.drawingNumber}    |    Revision: ${drawing.revisionNumber}    |    ` +
    `Type: ${drawing.drawingType}` +
    (totalPages > 1 ? `    |    Page ${pageNo} of ${totalPages}` : "");
  doc.text(subLine, MARGIN, MARGIN + 16, { width: availW, align: "center" });

  if (drawing.clientName || drawing.plantName) {
    const locLine = [drawing.clientName, drawing.plantName].filter(Boolean).join(" — ");
    doc.fontSize(7).fillColor("#666");
    doc.text(locLine, MARGIN, MARGIN + 30, { width: availW, align: "center" });
  }
  doc.fillColor("#000");

  // Image area (faint outline so the printable area is visible)
  doc.rect(boxX, boxY, availW, availH).stroke("#ddd");

  // Determine intrinsic image dimensions and fit preserving aspect ratio
  const dims = imageSize(imgBuf, doc);
  const fit = fitInside(dims.w, dims.h, availW, availH);

  // Draw image centered inside the box
  try {
    doc.image(imgBuf, boxX + fit.x, boxY + fit.y, { width: fit.w, height: fit.h });
  } catch (err) {
    // If pdfkit can't decode the buffer, show a clear message
    doc.fillColor("#999").fontSize(9).font("Helvetica");
    doc.text(
      `[Could not embed image: ${(err as Error).message}]`,
      boxX + 20, boxY + availH / 2 - 10,
      { width: availW - 40, align: "center" },
    );
    doc.fillColor("#000");
  }

  // Caption at the bottom (same lineBreak:false trick as the footer to
  // avoid triggering a phantom page-break when y is below the printable area)
  doc.font("Helvetica").fontSize(7).fillColor("#666");
  const captionText = `${drawing.fileName}  ·  ${drawing.fileExtension?.toUpperCase() ?? ""}`;
  const captionW = doc.widthOfString(captionText);
  const captionX = MARGIN + (pageW - 2 * MARGIN - captionW) / 2;
  doc.text(captionText, captionX, pageH - MARGIN - captionH + 2, { lineBreak: false });
  doc.fillColor("#000");
}

function drawDrawingPlaceholder(
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
  doc.font("Helvetica-Bold").fontSize(11).fillColor("#000");
  doc.text(drawing.title || "Drawing", MARGIN, MARGIN, {
    width: availW, align: "center",
  });
  doc.font("Helvetica").fontSize(8).fillColor("#444");
  doc.text(
    `Drawing No: ${drawing.drawingNumber}    |    Revision: ${drawing.revisionNumber}    |    Type: ${drawing.drawingType}`,
    MARGIN, MARGIN + 16,
    { width: availW, align: "center" },
  );
  doc.fillColor("#000");

  // Box
  doc.rect(MARGIN, boxY, availW, boxH).stroke("#ccc");
  doc.fillColor("#999").fontSize(10).font("Helvetica");
  doc.text(message, MARGIN + 20, boxY + boxH / 2 - 30, {
    width: availW - 40, align: "center",
  });
  doc.fillColor("#000");
}

// ─── TABLE HELPERS ───

function drawTableHeader(doc: Doc, columns: Column[], colWidths: number[], y: number, pageW: number) {
  const usable = pageW - 2 * MARGIN;
  doc.rect(MARGIN, y, usable, 36).fill(HEADER_BG).fillColor(HEADER_FG);
  let x = MARGIN;
  doc.font("Helvetica-Bold").fontSize(7).fillColor(HEADER_FG);
  for (let i = 0; i < columns.length; i++) {
    const c = columns[i];
    const w = colWidths[i];
    if (c.vertical) {
      const lines = c.header.split("\n");
      const joined = lines.join(" ");
      doc.save();
      doc.translate(x + w / 2 + 3, y + 32);
      doc.rotate(-90);
      doc.text(joined, 0, 0, { width: 30, align: "left" });
      doc.restore();
    } else {
      const lines = c.header.split("\n");
      let ly = y + 4;
      for (const ln of lines) {
        doc.text(ln, x + 3, ly, { width: w - 6, align: "center" });
        ly += 9;
      }
    }
    doc.rect(x, y, w, 36).stroke("#1b4d1b");
    x += w;
  }
  doc.fillColor("#000");
}

function drawMeasurementRow(
  doc: Doc,
  m: ThicknessMeasurement,
  columns: Column[],
  colWidths: number[],
  y: number,
  _report: any,
  _customCols: any[],
) {
  const rowH = 28;
  const usable = doc.page.width - 2 * MARGIN;
  doc.rect(MARGIN, y, usable, rowH).stroke("#999");
  let x = MARGIN;
  const cellPad = 3;
  doc.font("Helvetica").fontSize(8).fillColor("#000");

  for (let i = 0; i < columns.length; i++) {
    const c = columns[i];
    const w = colWidths[i];
    let text = "";
    switch (c.key) {
      case "diaInch":   text = m.pipeSizeInch; break;
      case "schedule":  text = m.pipeSchedule; break;
      case "nominal":   text = m.nominalThicknessMm !== null ? m.nominalThicknessMm.toFixed(2) : "—"; break;
      case "component": text = m.componentTypeCode; break;
      case "pointNo":   text = m.pointNo; break;
      case "north":     text = fmtMeasurement(m.northMm, m.northStatus); break;
      case "east":      text = fmtMeasurement(m.eastMm, m.eastStatus); break;
      case "south":     text = fmtMeasurement(m.southMm, m.southStatus); break;
      case "west":      text = fmtMeasurement(m.westMm, m.westStatus); break;
      case "obsMin":    text = m.observedMinimumMm !== null ? m.observedMinimumMm.toFixed(2) : "—"; break;
      case "findings":  text = m.findingsComments ?? ""; break;
      default:
        if (c.key.startsWith("custom_")) {
          const colId = c.key.replace("custom_", "");
          text = getCustomColumnValue(m, colId);
        }
        break;
    }
    doc.rect(x, y, w, rowH).stroke("#bbb");
    const maxW = w - 2 * cellPad;
    const wrapped = doc.widthOfString(text) > maxW
      ? text.slice(0, Math.floor((maxW / Math.max(1, doc.widthOfString(text))) * text.length)) + "…"
      : text;
    doc.text(wrapped, x + cellPad, y + 9, {
      width: maxW, align: c.key === "findings" ? "left" : "center",
    });
    x += w;
  }
}
