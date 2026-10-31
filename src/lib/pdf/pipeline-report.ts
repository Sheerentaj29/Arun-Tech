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
  VisualInspectionObservation,
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

// ─── Font registration: Geist Sans ───
// The Geist font package provides TTF files. We register them with pdfkit
// so the generated PDF uses Geist Sans consistently.
const GEIST_REGULAR = "/home/z/my-project/node_modules/geist/dist/fonts/geist-sans/Geist-Regular.ttf";
const GEIST_BOLD = "/home/z/my-project/node_modules/geist/dist/fonts/geist-sans/Geist-Bold.ttf";
const GEIST_MEDIUM = "/home/z/my-project/node_modules/geist/dist/fonts/geist-sans/Geist-Medium.ttf";

// Fall back to Helvetica if Geist TTFs are not found (shouldn't happen)
const FONT_REGULAR = existsSync(GEIST_REGULAR) ? "GeistSans" : "Helvetica";
const FONT_BOLD = existsSync(GEIST_BOLD) ? "GeistSans-Bold" : "Helvetica-Bold";
const FONT_MEDIUM = existsSync(GEIST_MEDIUM) ? "GeistSans-Medium" : "Helvetica-Bold";

// Default body font size per the spec: 10.5pt
const BODY_FONT_SIZE = 10.5;

// Service company logo path (uploaded by admin via /api/settings/service-logo)
function findServiceLogo(): string | null {
  const dir = "/home/z/my-project/storage/logos";
  for (const ext of ["png", "jpg", "jpeg", "webp", "gif"]) {
    const p = join(dir, `service-company.${ext}`);
    if (existsSync(p)) return p;
  }
  return null;
}

// ─── Report type metadata ───
// The title is the only piece used directly by the PDF generator; the
// shortLabel / accent are used by the UI (not here).
type ReportType = "PIPELINE_THICKNESS" | "PIPELINE_VISUAL" | "PIPELINE_CONDITION" | "PIPELINE_DPT";

const REPORT_TYPE_TITLE: Record<ReportType, string> = {
  PIPELINE_THICKNESS: "PIPELINE THICKNESS MEASUREMENT REPORT",
  PIPELINE_VISUAL:    "PIPELINE VISUAL INSPECTION REPORT",
  PIPELINE_CONDITION: "PIPELINE CONDITION ASSESSMENT REPORT",
  PIPELINE_DPT:       "DYE PENETRANT TESTING REPORT",
};

function getReportType(raw: any): ReportType {
  const v = String(raw ?? "PIPELINE_THICKNESS");
  if (v === "PIPELINE_VISUAL" || v === "PIPELINE_CONDITION" || v === "PIPELINE_DPT") return v;
  return "PIPELINE_THICKNESS";
}

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
    client: Pick<Client, "id" | "name" | "logoPath">;
    plant: Pick<Plant, "id" | "name" | "location" | "address">;
    inspector: Pick<User, "id" | "name" | "email">;
    approver: Pick<User, "id" | "name" | "email"> | null;
    reportPhotos?: ReportPhoto[];
    visualObservations?: VisualInspectionObservation[];
    certificates?: Array<{
      id: string;
      category: string;
      title: string;
      fileName: string;
      filePath: string;
      fileExtension: string;
      mimeType: string;
      sortOrder: number;
    }>;
    dptObservations?: Array<{
      id: string;
      serialNo: number;
      sortOrder: number;
      description: string | null;
      weldType: string | null;
      result: string;
      remarks: string | null;
      customColumnValues: string | null;
    }>;
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

  // Determine the report type → drives the title and the body content
  // (thickness table vs visual observations table vs condition assessment fields).
  const reportType = getReportType((input.report as any).reportType);
  const titleText = REPORT_TYPE_TITLE[reportType];

  const doc = new PDFDocument({
    size: pageSize,           // ← [w, h] array, NO `layout` flag (it would re-swap)
    margins: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
    info: {
      Title: `${titleText} ${input.report.reportNumber}`,
      Author: input.report.inspectorName,
      Subject: input.report.pipelineDescription ?? "Pipeline Inspection",
      Producer: "Inspection Report Automation System",
    },
  });

  // Register Geist Sans fonts (if available)
  if (existsSync(GEIST_REGULAR)) doc.registerFont("GeistSans", GEIST_REGULAR);
  if (existsSync(GEIST_BOLD)) doc.registerFont("GeistSans-Bold", GEIST_BOLD);
  if (existsSync(GEIST_MEDIUM)) doc.registerFont("GeistSans-Medium", GEIST_MEDIUM);

  doc.pipe(out);

  const report = input.report;
  const measurements = input.measurements;
  const visualObservations =
    input.report.visualObservations ?? (report as any).visualObservations ?? [];
  const allPhotos = input.photos ?? input.report.reportPhotos ?? [];
  const customCols = getCustomColumns(report);
  const linkedDrawings = input.linkedDrawings ?? (report as any).linkedDrawings ?? [];
  const certificates: Array<{
    id: string; category: string; title: string; fileName: string;
    filePath: string; fileExtension: string; mimeType: string; sortOrder: number;
  }> = (report as any).certificates ?? [];

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
  doc.font(FONT_BOLD).fontSize(titleFontSize).fillColor("#000");
  const titleHeight = doc.heightOfString(titleText, { width: usableW, align: "center" });
  doc.text(titleText, MARGIN, cursorY, { width: usableW, align: "center" });
  cursorY += titleHeight + 8;  // explicit 8pt gap below title

  // ── SUBTITLE (Report No | Rev | Date Range | Status) ──
  const subtitleFontSize = orientation === "landscape" ? 9 : 8;
  const fromDateStr = (report as any).fromDate
    ? new Date((report as any).fromDate).toISOString().slice(0, 10)
    : new Date(report.inspectionDate).toISOString().slice(0, 10);
  const toDateStr = (report as any).toDate
    ? new Date((report as any).toDate).toISOString().slice(0, 10)
    : fromDateStr;
  const dateRange = fromDateStr === toDateStr ? fromDateStr : `${fromDateStr} – ${toDateStr}`;
  const subtitleText =
    `Report No: ${report.reportNumber}    |    Rev: ${report.revisionNumber}    |    ` +
    `Date: ${dateRange}    |    ` +
    `Status: ${report.status}`;
  doc.font(FONT_REGULAR).fontSize(subtitleFontSize).fillColor("#333");
  const subtitleHeight = doc.heightOfString(subtitleText, { width: usableW, align: "center" });
  doc.text(subtitleText, MARGIN, cursorY, { width: usableW, align: "center" });
  cursorY += subtitleHeight + 10;  // explicit 10pt gap below subtitle

  // ── LOGOS (positioned strictly below subtitle) ──
  // Left: service company logo (if uploaded), otherwise a text placeholder.
  // Right: client company logo (if uploaded), otherwise a text placeholder.
  // Both logos preserve aspect ratio and fit within a fixed-size box.
  const logoH = 40;
  const logoW = 120;
  const serviceLogoPath = findServiceLogo();
  const clientLogoPath = report.client.logoPath ?? null;

  // Left logo box (service company)
  doc.rect(MARGIN, cursorY, logoW, logoH).stroke("#ccc");
  if (serviceLogoPath && existsSync(serviceLogoPath)) {
    try {
      const logoBuf = readFileSync(serviceLogoPath);
      doc.image(logoBuf, MARGIN, cursorY, { fit: [logoW - 4, logoH - 4], align: "center", valign: "center" });
    } catch {
      doc.fontSize(7).fillColor("#999").font(FONT_REGULAR);
      doc.text("Service Company\nLogo", MARGIN, cursorY + 10, { width: logoW, align: "center" });
    }
  } else {
    doc.fontSize(7).fillColor("#999").font(FONT_REGULAR);
    doc.text("Service Company\nLogo", MARGIN, cursorY + 10, { width: logoW, align: "center" });
  }

  // Right logo box (client)
  doc.rect(pageW - MARGIN - logoW, cursorY, logoW, logoH).stroke("#ccc");
  if (clientLogoPath && existsSync(clientLogoPath)) {
    try {
      const logoBuf = readFileSync(clientLogoPath);
      doc.image(logoBuf, pageW - MARGIN - logoW, cursorY, { fit: [logoW - 4, logoH - 4], align: "center", valign: "center" });
    } catch {
      const clientShort = report.client.name.length > 28
        ? report.client.name.slice(0, 28)
        : report.client.name;
      doc.fontSize(7).fillColor("#999").font(FONT_REGULAR);
      doc.text(`${clientShort}\nClient Logo`, pageW - MARGIN - logoW, cursorY + 10, {
        width: logoW, align: "center",
      });
    }
  } else {
    const clientShort = report.client.name.length > 28
      ? report.client.name.slice(0, 28)
      : report.client.name;
    doc.fontSize(7).fillColor("#999").font(FONT_REGULAR);
    doc.text(`${clientShort}\nClient Logo`, pageW - MARGIN - logoW, cursorY + 10, {
      width: logoW, align: "center",
    });
  }
  doc.fillColor("#000");
  cursorY += logoH + 10;  // explicit 10pt gap below logos

  // ── HEADER INFO GRID ──
  // Larger, easy-to-read client details for senior reviewers.
  // Client Name and Plant Name are rendered in a larger bold font.
  // Two pairs of (label, value) per row with generous spacing.
  const labelW = orientation === "landscape" ? 170 : 120;
  const valueW = (pageW - 2 * MARGIN - 2 * labelW) / 2;
  const minRowH = 22;       // increased from 14 → 22 for readability
  const fontSizeInfo = orientation === "landscape" ? 10 : 9;  // increased from 8 → 10
  const fontSizeProminent = orientation === "landscape" ? 11 : 10; // for Client Name + Plant Name
  const cellPad = 5;

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

  // The sign-off block height (heading + boxes + padding)
  const signOffBlockH = 16 + 48 + 8; // heading + box + gap = 72pt
  // Position the sign-off at the bottom of the first page, above the footer
  const signOffY = pageH - MARGIN - signOffBlockH - 8; // 8pt gap above footer
  const maxRowY = signOffY - 12; // info grid must end 12pt above the sign-off
  // For pages AFTER the first page (no sign-off), the available space
  // extends to just above the footer.
  const pageMaxY = pageH - MARGIN - 8;

  for (let i = 0; i < infoRows.length; i += 2) {
    const left = infoRows[i];
    const right = infoRows[i + 1] ?? ["", "—"];

    // Determine if this row contains prominent fields (Client Name, Plant Name)
    const leftProminent = left[0] === "Client" || left[0] === "Plant Name";
    const rightProminent = right[0] === "Client" || right[0] === "Plant Name";

    // Calculate wrapped heights for each cell
    const leftFontSize = leftProminent ? fontSizeProminent : fontSizeInfo;
    const rightFontSize = rightProminent ? fontSizeProminent : fontSizeInfo;

    doc.font(FONT_BOLD).fontSize(fontSizeInfo);
    const leftLabelH = doc.heightOfString(left[0] ?? "", { width: labelW - 2 * cellPad });
    const rightLabelH = doc.heightOfString(right[0] ?? "", { width: labelW - 2 * cellPad });
    doc.font(leftProminent ? FONT_BOLD : FONT_REGULAR).fontSize(leftFontSize);
    const leftValStr = left[1] ?? "—";
    const rightValStr = right[1] ?? "—";
    const leftValH = doc.heightOfString(leftValStr, { width: valueW - 2 * cellPad });
    doc.font(rightProminent ? FONT_BOLD : FONT_REGULAR).fontSize(rightFontSize);
    const rightValH = doc.heightOfString(rightValStr, { width: valueW - 2 * cellPad });

    const maxContentH = Math.max(leftLabelH, leftValH, rightLabelH, rightValH);
    const rowH = Math.max(minRowH, maxContentH + cellPad * 2);

    // If this row would overlap the sign-off area, stop the info grid here
    if (cursorY + rowH > maxRowY) {
      // Not enough room for all rows on the first page — the remaining
      // rows will be on the next page (rare case with very long values).
      // For now, break the loop and let the sign-off be positioned at the bottom.
      break;
    }

    // Draw left label cell
    doc.font(FONT_BOLD).fontSize(fontSizeInfo).fillColor("#000");
    doc.rect(MARGIN, cursorY, labelW, rowH).stroke("#888");
    doc.text(left[0] ?? "", MARGIN + cellPad, cursorY + cellPad, {
      width: labelW - 2 * cellPad, align: "left", height: rowH - 2 * cellPad,
    });
    // Draw left value cell — prominent fields use larger bold font
    doc.font(leftProminent ? FONT_BOLD : FONT_REGULAR).fontSize(leftFontSize);
    doc.rect(MARGIN + labelW, cursorY, valueW, rowH).stroke("#888");
    doc.text(leftValStr, MARGIN + labelW + cellPad, cursorY + cellPad, {
      width: valueW - 2 * cellPad, align: "left", height: rowH - 2 * cellPad,
    });

    // Draw right label cell
    const rightX = MARGIN + labelW + valueW;
    doc.font(FONT_BOLD).fontSize(fontSizeInfo);
    doc.rect(rightX, cursorY, labelW, rowH).stroke("#888");
    doc.text(right[0] ?? "", rightX + cellPad, cursorY + cellPad, {
      width: labelW - 2 * cellPad, align: "left", height: rowH - 2 * cellPad,
    });
    // Draw right value cell — prominent fields use larger bold font
    doc.font(rightProminent ? FONT_BOLD : FONT_REGULAR).fontSize(rightFontSize);
    doc.rect(rightX + labelW, cursorY, valueW, rowH).stroke("#888");
    doc.text(rightValStr, rightX + labelW + cellPad, cursorY + cellPad, {
      width: valueW - 2 * cellPad, align: "left", height: rowH - 2 * cellPad,
    });

    cursorY += rowH;
  }

  // ═══════════════════════════════════════════════════════════════
  // PRIMARY INSPECTION PHOTO — displayed on the first page, between
  // the client details and the sign-off block.
  //
  // The photo is dynamically sized to fill the AVAILABLE vertical space
  // between the bottom of the client details and the top of the
  // sign-off block — NOT capped at a small fixed height.
  //
  // The image's intrinsic aspect ratio is always preserved. The photo
  // is centered horizontally within the usable page width.
  // ═══════════════════════════════════════════════════════════════
  const primaryPhotoPath = (report as any).primaryPhotoPath ?? null;
  if (primaryPhotoPath && existsSync(primaryPhotoPath)) {
    // Calculate the available vertical space:
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
        const imageTopY = cursorY + gapBelowLabel;

        // Get the intrinsic pixel dimensions of the image
        const dims = imageSize(photoBuf, doc);
        const imgW = dims.w;
        const imgH = dims.h;

        if (imgW > 0 && imgH > 0) {
          // Calculate the best fit that maximizes the image size within
          // the available area while preserving aspect ratio.
          // ratio = min(availW / imgW, availH / imgH)
          const ratio = Math.min(photoAvailW / imgW, photoAvailH / imgH);
          const drawW = imgW * ratio;
          const drawH = imgH * ratio;

          // Center horizontally within the usable width
          const drawX = MARGIN + (photoAvailW - drawW) / 2;
          const drawY = imageTopY;

          // Draw a faint border around the image area for a professional look
          doc.rect(drawX - 2, drawY - 2, drawW + 4, drawH + 4).stroke("#e0e0e0");

          // Draw the image using pdfkit's fit option (more reliable than
          // manual width+height for preserving aspect ratio)
          doc.image(photoBuf, drawX, drawY, {
            fit: [drawW, drawH],
            align: "center",
            valign: "top",
          });

          cursorY = drawY + drawH + 4;
        } else {
          // Couldn't parse image dimensions — use pdfkit's fit as fallback
          doc.image(photoBuf, MARGIN, imageTopY, {
            fit: [photoAvailW, photoAvailH],
            align: "center",
            valign: "top",
          });
          cursorY = imageTopY + photoAvailH + 4;
        }
      } catch {
        // Skip if image can't be read
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // SIGN-OFF — positioned at the BOTTOM of the first page.
  // Three signatories: Inspected By, Second Reviewed By, Approved By.
  // Each with name, designation, and date. Visually separated from the
  // client details above by a gap. The sign-off is anchored to the
  // bottom of the page (above the footer) regardless of how tall the
  // info grid is.
  // ═══════════════════════════════════════════════════════════════
  {
    const signW = (pageW - 2 * MARGIN - 2 * 4) / 3;
    const signBlocks = [
      {
        label: "Inspected By",
        name: report.inspectorName ?? "—",
        designation: (report as any).inspectorDesignation ?? "",
        dateVal: fromDateStr,
      },
      {
        label: "Second Reviewed By",
        name: (report as any).secondReviewedByName ?? "—",
        designation: (report as any).secondReviewedByDesignation ?? "",
        dateVal: (report as any).secondReviewedAt
          ? new Date((report as any).secondReviewedAt).toISOString().slice(0, 10)
          : "—",
      },
      {
        label: "Approved By",
        name: report.approver?.name ?? "—",
        designation: (report as any).approvedByDesignation ?? "",
        dateVal: report.approvedAt
          ? new Date(report.approvedAt).toISOString().slice(0, 10)
          : "—",
      },
    ];

    // Draw a horizontal separator line above the sign-off
    doc.moveTo(MARGIN, signOffY - 6)
      .lineTo(pageW - MARGIN, signOffY - 6)
      .stroke("#ccc");

    // Draw sign-off heading
    doc.font(FONT_BOLD).fontSize(10).fillColor("#000");
    doc.text("Sign-Off", MARGIN, signOffY);
    const boxY = signOffY + 18;

    for (let i = 0; i < signBlocks.length; i++) {
      const b = signBlocks[i];
      const x = MARGIN + i * (signW + 4);
      // Draw bordered box for each signatory
      doc.font(FONT_REGULAR).fontSize(8).fillColor("#666");
      doc.rect(x, boxY, signW, 48).stroke("#999");
      doc.text(b.label, x + 4, boxY + 4, { width: signW - 8 });
      doc.fillColor("#000");
      doc.font(FONT_BOLD).fontSize(9);
      doc.text(b.name, x + 4, boxY + 16, { width: signW - 8 });
      doc.font(FONT_REGULAR).fontSize(8).fillColor("#444");
      doc.text(b.designation || "—", x + 4, boxY + 27, { width: signW - 8 });
      doc.fontSize(8).fillColor("#666");
      doc.text(`Date: ${b.dateVal}`, x + 4, boxY + 39, { width: signW - 8 });
      doc.fillColor("#000");
    }
  }

  // After the first page (header + sign-off), start a new page for
  // the remaining sections.
  // Declare y here (before the findings sections use it) to avoid the
  // temporal dead zone. It gets properly initialized by startBodyOnFreshPage
  // for the measurement table, and set to MARGIN for the findings sections.
  let y: number = 0;
  addNewPage();
  // Initialize y for the findings sections (startBodyOnFreshPage is
  // called later for the measurement table, but the findings sections
  // need y to be set to the top of the new page).
  y = MARGIN;

  // ═══════════════════════════════════════════════════════════════
  // SECTION ORDER (per latest spec):
  //   1. Inspection Description
  //   2. Summary Of Site Observations
  //   3. Results
  //   4. Conclusion
  //   5. Engineering Drawings
  //   6. Thickness Measurement Table / Inspection Data
  //   7. Inspection Photographs
  //   8. Certification (Equipment + Personnel)
  // ═══════════════════════════════════════════════════════════════

  // ── 1. INSPECTION DESCRIPTION ──
  if (report.inspectionDescription) {
    if (y + 60 > pageMaxY) { addNewPage(); y = MARGIN; }
    y += 10;
    doc.font(FONT_BOLD).fontSize(9).fillColor("#000");
    doc.text("Inspection Description", MARGIN, y);
    y += 14;
    doc.font(FONT_REGULAR).fontSize(8);
    const descHeight = doc.heightOfString(report.inspectionDescription, { width: pageW - 2 * MARGIN });
    if (y + descHeight > pageMaxY) { addNewPage(); y = MARGIN; }
    doc.text(report.inspectionDescription, MARGIN, y, { width: pageW - 2 * MARGIN, align: "left" });
    y += descHeight + 6;
  }

  // ── 2. SUMMARY OF SITE OBSERVATIONS ──
  {
    const text = ((report as any).siteObservationSummary ?? "").trim();
    if (text) {
      if (y + 40 > pageMaxY) { addNewPage(); y = MARGIN; }
      y += 8;
      doc.font(FONT_BOLD).fontSize(9).fillColor("#000");
      doc.text("Summary Of Site Observations", MARGIN, y);
      y += 14;
      doc.font(FONT_REGULAR).fontSize(8);
      const h = doc.heightOfString(text, { width: pageW - 2 * MARGIN });
      if (y + h > pageMaxY) { addNewPage(); y = MARGIN; }
      doc.text(text, MARGIN, y, { width: pageW - 2 * MARGIN, align: "left" });
      y += h + 6;
    }
  }

  // ── 3. RESULTS ──
  {
    const text = ((report as any).results ?? "").trim();
    if (text) {
      if (y + 40 > pageMaxY) { addNewPage(); y = MARGIN; }
      y += 8;
      doc.font(FONT_BOLD).fontSize(9);
      doc.text("Results", MARGIN, y);
      y += 14;
      doc.font(FONT_REGULAR).fontSize(8);
      const h = doc.heightOfString(text, { width: pageW - 2 * MARGIN });
      if (y + h > pageMaxY) { addNewPage(); y = MARGIN; }
      doc.text(text, MARGIN, y, { width: pageW - 2 * MARGIN, align: "left" });
      y += h + 6;
    }
  }

  // ── 4. CONCLUSION ──
  {
    const text = ((report as any).conclusion ?? "").trim();
    if (text) {
      if (y + 40 > pageMaxY) { addNewPage(); y = MARGIN; }
      y += 8;
      doc.font(FONT_BOLD).fontSize(9);
      doc.text("Conclusion", MARGIN, y);
      y += 14;
      doc.font(FONT_REGULAR).fontSize(8);
      const h = doc.heightOfString(text, { width: pageW - 2 * MARGIN });
      if (y + h > pageMaxY) { addNewPage(); y = MARGIN; }
      doc.text(text, MARGIN, y, { width: pageW - 2 * MARGIN, align: "left" });
      y += h + 6;
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // 5. DRAWING PAGES — each drawing image (or each page of a PDF drawing)
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
  // BODY CONTENT — type-specific
  //   • PIPELINE_THICKNESS → measurement table (11 columns + custom)
  //   • PIPELINE_VISUAL    → visual observations table
  //   • PIPELINE_CONDITION → condition assessment fields (labeled grid)
  //
  // If drawings were emitted, the body starts on a fresh page.
  // Otherwise, continue on the same page if there's room, else a new page.
  // ═══════════════════════════════════════════════════════════════
  const tableHeaderH = 36;
  const rowH2 = orientation === "landscape" ? 28 : 22;
  // `y` was already declared above (before the findings sections).

  // Helper: decide whether to start on a fresh page or continue.
  // Uses pageMaxY (not maxRowY) because these pages don't have a sign-off.
  const startBodyOnFreshPage = (neededSpace: number) => {
    if (linkedDrawings.length > 0) {
      addNewPage();
      y = MARGIN;
    } else if (y + neededSpace > pageMaxY) {
      addNewPage();
      y = MARGIN;
    } else {
      y += 10;
    }
  };

  if (reportType === "PIPELINE_THICKNESS") {
    // ─── MEASUREMENT TABLE ───
    startBodyOnFreshPage(tableHeaderH + rowH2);
    drawTableHeader(doc, allCols, colWidths, y, pageW);
    y += tableHeaderH;
    for (const m of measurements) {
      if (y + rowH2 > pageMaxY) {
        addNewPage();
        drawTableHeader(doc, allCols, colWidths, MARGIN, pageW);
        y = MARGIN + tableHeaderH;
      }
      drawMeasurementRow(doc, m, allCols, colWidths, y, report, customCols);
      y += rowH2;
    }
  } else if (reportType === "PIPELINE_VISUAL") {
    // ─── VISUAL OBSERVATIONS TABLE ───
    // Render a multi-column table with one row per observation point.
    // Landscape orientation is strongly recommended for this table
    // (it has 13 columns).
    const visCols: Column[] = [
      { key: "vPtNo",        header: "Pt No",              width: 40 },
      { key: "vLocation",    header: "Location",            width: 80 },
      { key: "vPipeCond",    header: "Pipeline\nCondition", width: 60 },
      { key: "vExtSurf",     header: "External\nSurface",   width: 60 },
      { key: "vCoatPaint",   header: "Coating /\nPaint",    width: 60 },
      { key: "vCorrosion",   header: "Corrosion",            width: 55 },
      { key: "vLeakage",     header: "Leakage",              width: 50 },
      { key: "vDamage",      header: "Damage /\nDeformation", width: 70 },
      { key: "vSupports",    header: "Supports /\nHangers",  width: 60 },
      { key: "vWeld",        header: "Weld\nJoint",          width: 55 },
      { key: "vInsulation",  header: "Insulation",           width: 55 },
      { key: "vFindings",    header: "Findings",             width: 0 },
      { key: "vRecs",        header: "Recommendations",      width: 0 },
      { key: "vComments",    header: "Inspector\nComments",  width: 0 },
    ];
    const visColWidths = calcColumnWidths(visCols, pageW);
    startBodyOnFreshPage(tableHeaderH + rowH2);
    drawVisualTableHeader(doc, visCols, visColWidths, y, pageW);
    y += tableHeaderH;
    for (const o of visualObservations) {
      if (y + rowH2 > pageMaxY) {
        addNewPage();
        drawVisualTableHeader(doc, visCols, visColWidths, MARGIN, pageW);
        y = MARGIN + tableHeaderH;
      }
      drawVisualObservationRow(doc, o, visCols, visColWidths, y);
      y += rowH2;
    }
    // If no observations, emit a placeholder row
    if (visualObservations.length === 0) {
      doc.font(FONT_REGULAR).fontSize(8).fillColor("#666");
      doc.rect(MARGIN, y, pageW - 2 * MARGIN, rowH2).stroke("#bbb");
      doc.text("No visual observations recorded.", MARGIN + 4, y + 9, {
        width: pageW - 2 * MARGIN - 8, align: "center",
      });
      doc.fillColor("#000");
      y += rowH2;
    }
  } else if (reportType === "PIPELINE_CONDITION") {
    // ─── CONDITION ASSESSMENT FIELDS ───
    startBodyOnFreshPage(80);
    y = drawConditionAssessment(doc, report as any, y, pageW, pageH, MARGIN, pageMaxY, addNewPage);
  } else if (reportType === "PIPELINE_DPT") {
    // ─── DPT / DPPT INSPECTION TABLE ───
    // Render DPT-specific header (testing materials) + observation table
    startBodyOnFreshPage(120);

    // DPT testing materials header
    const dptReport = report as any;
    if (dptReport.dptDateOfExamination || dptReport.dptSolventCleaner || dptReport.dptPenetrant || dptReport.dptDeveloper) {
      if (y + 80 > pageMaxY) { addNewPage(); y = MARGIN; }
      y += 10;
      doc.font(FONT_BOLD).fontSize(10).fillColor("#000");
      doc.text("Testing Materials", MARGIN, y);
      y += 16;

      const dptLabelW = 140;
      const dptValueW = (pageW - 2 * MARGIN - 2 * dptLabelW) / 2;
      const dptRowH = 20;
      const dptInfo: Array<[string, string | null]> = [
        ["Date of Examination", dptReport.dptDateOfExamination ? new Date(dptReport.dptDateOfExamination).toISOString().slice(0, 10) : "—"],
        ["Solvent / Cleaner", dptReport.dptSolventCleaner],
        ["Penetrant", dptReport.dptPenetrant],
        ["Developer", dptReport.dptDeveloper],
      ];
      for (let i = 0; i < dptInfo.length; i += 2) {
        const left = dptInfo[i];
        const right = dptInfo[i + 1] ?? ["", "—"];
        if (y + dptRowH > pageMaxY) { addNewPage(); y = MARGIN; }
        // Left
        doc.font(FONT_BOLD).fontSize(9);
        doc.rect(MARGIN, y, dptLabelW, dptRowH).stroke("#888");
        doc.text(left[0], MARGIN + 4, y + 5, { width: dptLabelW - 8 });
        doc.font(FONT_REGULAR).fontSize(9);
        doc.rect(MARGIN + dptLabelW, y, dptValueW, dptRowH).stroke("#888");
        doc.text(left[1] ?? "—", MARGIN + dptLabelW + 4, y + 5, { width: dptValueW - 8 });
        // Right
        const rx = MARGIN + dptLabelW + dptValueW;
        doc.font(FONT_BOLD).fontSize(9);
        doc.rect(rx, y, dptLabelW, dptRowH).stroke("#888");
        doc.text(right[0] ?? "", rx + 4, y + 5, { width: dptLabelW - 8 });
        doc.font(FONT_REGULAR).fontSize(9);
        doc.rect(rx + dptLabelW, y, dptValueW, dptRowH).stroke("#888");
        doc.text(right[1] ?? "—", rx + dptLabelW + 4, y + 5, { width: dptValueW - 8 });
        y += dptRowH;
      }
      y += 8;
    }

    // DPT observation table
    const dptObs = dptReport.dptObservations ?? report.dptObservations ?? [];
    // Parse custom columns
    let dptCustomCols: Array<{ id: string; name: string; unit: string }> = [];
    try {
      const cc = JSON.parse(dptReport.dptCustomColumns ?? "[]");
      if (Array.isArray(cc)) dptCustomCols = cc;
    } catch {}

    // Table header
    const dptHeaderH = 36;
    const dptRowH = 28;
    const slColW = 40;
    const descColW = 200;
    const weldColW = 80;
    const resultColW = 60;
    const remarksColW = 0; // fill remaining
    const customColW = 60;

    // Calculate column widths
    const dptFixedW = slColW + descColW + weldColW + resultColW;
    const dptCustomTotalW = dptCustomCols.length * customColW;
    const dptRemarksW = Math.max(100, pageW - 2 * MARGIN - dptFixedW - dptCustomTotalW);
    const dptColWidths = [slColW, descColW, weldColW, resultColW, ...dptCustomCols.map(() => customColW), dptRemarksW];
    const dptColHeaders = ["Sl.\nNo", "Description", "Weld\nType", "Result", ...dptCustomCols.map(c => c.name + (c.unit ? `\n(${c.unit})` : "")), "Remarks"];

    // Draw header
    if (y + dptHeaderH + dptRowH > pageMaxY) { addNewPage(); y = MARGIN; }
    drawDptTableHeader(doc, dptColHeaders, dptColWidths, y, pageW);
    y += dptHeaderH;

    // Draw rows
    for (const obs of dptObs) {
      if (y + dptRowH > pageMaxY) {
        addNewPage();
        drawDptTableHeader(doc, dptColHeaders, dptColWidths, MARGIN, pageW);
        y = MARGIN + dptHeaderH;
      }
      drawDptRow(doc, obs, dptColHeaders, dptColWidths, y, dptCustomCols);
      y += dptRowH;
    }

    // Placeholder if no observations
    if (dptObs.length === 0) {
      doc.font(FONT_REGULAR).fontSize(8).fillColor("#666");
      doc.rect(MARGIN, y, pageW - 2 * MARGIN, dptRowH).stroke("#bbb");
      doc.text("No DPT observations recorded.", MARGIN + 4, y + 9, { width: pageW - 2 * MARGIN - 8, align: "center" });
      doc.fillColor("#000");
      y += dptRowH;
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // 7. PHOTOGRAPHS (gallery) — after the measurement table, before
  // certification.
  // Sequential layout: render photos one at a time, tracking the current
  // column position within the row and the current row Y position.
  // When a photo + caption doesn't fit in the remaining space, move the
  // ENTIRE photo (image + caption) to the next page — never split.
  // ═══════════════════════════════════════════════════════════════
  if (allPhotos.length > 0) {
    if (y + 30 > pageMaxY) { addNewPage(); y = MARGIN; }
    y += 10;
    doc.font(FONT_BOLD).fontSize(10).fillColor("#000");
    doc.text("Inspection Photographs", MARGIN, y);
    y += 20;

    // Fixed thumbnail size — consistent across all photos
    const photoW = orientation === "landscape" ? 180 : 140;
    const photoH = orientation === "landscape" ? 120 : 95;
    const captionH = 16; // space reserved for caption below each photo
    const cellH = photoH + captionH; // total height per photo cell
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
  }

  // ═══════════════════════════════════════════════════════════════
  // 8. CERTIFICATION SECTION — after inspection photographs.
  // Layout rules:
  //   - "Certification" heading + sub-heading go on the SAME page as
  //     the first certificate (never alone at the bottom of a page).
  //   - Each certificate gets its own page.
  //   - PDF certificates are rasterized page-by-page.
  //   - No blank pages when no certificates are uploaded.
  // ═══════════════════════════════════════════════════════════════
  if (certificates.length > 0) {
    const equipCerts = certificates.filter((c) => c.category === "EQUIPMENT");
    const personnelCerts = certificates.filter((c) => c.category === "PERSONNEL");

    // Helper: render a certificate on the current page (assumes a new page
    // has already been created). Returns nothing — each cert is on its own page.
    const renderCertificateOnPage = async (cert: typeof certificates[0]) => {
      const ext = (cert.fileExtension || "").toLowerCase();
      if (!cert.filePath || !existsSync(cert.filePath)) {
        // Draw a placeholder
        doc.font(FONT_REGULAR).fontSize(9).fillColor("#999");
        doc.text(`[File missing: ${cert.fileName}]`, MARGIN, MARGIN + 36, { width: usableW, align: "center" });
        doc.fillColor("#000");
        return;
      }

      // Certificate header (title + file name) at the top of the page
      doc.font(FONT_BOLD).fontSize(11).fillColor("#000");
      doc.text(cert.title || "Certificate", MARGIN, MARGIN, { width: usableW, align: "center" });
      doc.font(FONT_REGULAR).fontSize(8).fillColor("#444");
      doc.text(`File: ${cert.fileName}`, MARGIN, MARGIN + 16, { width: usableW, align: "center" });
      doc.fillColor("#000");

      // Available area for the certificate image
      const certY = MARGIN + 32;
      const certH = pageMaxY - certY;

      if (ext === ".pdf") {
        // Rasterize each page of the PDF certificate
        const pageBuffers = await rasterizePdfPages(cert.filePath);
        if (pageBuffers.length === 0) {
          doc.fillColor("#999").fontSize(9).font(FONT_REGULAR);
          doc.text("[Could not rasterize PDF certificate]", MARGIN, certY + certH / 2, { width: usableW, align: "center" });
          doc.fillColor("#000");
          return;
        }
        for (let p = 0; p < pageBuffers.length; p++) {
          if (p > 0) addNewPage(); // subsequent pages of the same PDF cert
          // Re-draw the header on subsequent pages
          if (p > 0) {
            doc.font(FONT_BOLD).fontSize(11).fillColor("#000");
            doc.text(cert.title || "Certificate", MARGIN, MARGIN, { width: usableW, align: "center" });
            doc.font(FONT_REGULAR).fontSize(8).fillColor("#444");
            doc.text(`File: ${cert.fileName}  |  Page ${p + 1} of ${pageBuffers.length}`, MARGIN, MARGIN + 16, { width: usableW, align: "center" });
            doc.fillColor("#000");
          }
          doc.rect(MARGIN, certY, usableW, certH).stroke("#ddd");
          try {
            doc.image(pageBuffers[p], MARGIN, certY, { fit: [usableW, certH], align: "center", valign: "center" });
          } catch {}
        }
      } else if ([".png", ".jpg", ".jpeg"].includes(ext)) {
        // Image certificate — render on this page
        doc.rect(MARGIN, certY, usableW, certH).stroke("#ddd");
        try {
          const imgBuf = readFileSync(cert.filePath);
          doc.image(imgBuf, MARGIN, certY, { fit: [usableW, certH], align: "center", valign: "center" });
        } catch {
          doc.fillColor("#999").fontSize(9).font(FONT_REGULAR);
          doc.text("[Could not embed image]", MARGIN, certY + certH / 2, { width: usableW, align: "center" });
          doc.fillColor("#000");
        }
      }
    };

    // Equipment / Instrument Certificates
    if (equipCerts.length > 0) {
      // Start a new page for the certification section — ensures the
      // heading is never alone at the bottom of the measurement table page.
      addNewPage();
      // Draw "Certification" heading + sub-heading at the top of this page
      doc.font(FONT_BOLD).fontSize(14).fillColor("#000");
      doc.text("Certification", MARGIN, MARGIN, { width: usableW });
      doc.font(FONT_BOLD).fontSize(11);
      doc.text(`Equipment / Instrument Certificates (${equipCerts.length})`, MARGIN, MARGIN + 20, { width: usableW });

      // First certificate on THIS page (below the headings)
      // Subsequent certificates on new pages
      for (let i = 0; i < equipCerts.length; i++) {
        if (i > 0) addNewPage();
        // For the first cert, render below the headings (offset Y)
        // For subsequent certs, render at the top of the new page
        if (i === 0) {
          // Render the certificate header + image starting below the sub-heading
          const cert = equipCerts[i];
          const ext = (cert.fileExtension || "").toLowerCase();
          const certHeaderY = MARGIN + 36; // below the two headings
          const certY = certHeaderY + 30; // 30pt gap for title + file name text
          const certH = pageMaxY - certY;

          doc.font(FONT_BOLD).fontSize(11).fillColor("#000");
          doc.text(cert.title || "Certificate", MARGIN, certHeaderY, { width: usableW, align: "center" });
          doc.font(FONT_REGULAR).fontSize(8).fillColor("#444");
          doc.text(`File: ${cert.fileName}`, MARGIN, certHeaderY + 16, { width: usableW, align: "center" });
          doc.fillColor("#000");

          if (cert.filePath && existsSync(cert.filePath)) {
            doc.rect(MARGIN, certY, usableW, certH).stroke("#ddd");
            if (ext === ".pdf") {
              try {
                const pages = await rasterizePdfPages(cert.filePath);
                for (let p = 0; p < pages.length; p++) {
                  if (p > 0) addNewPage();
                  if (p > 0) {
                    doc.font(FONT_BOLD).fontSize(11).fillColor("#000");
                    doc.text(cert.title || "Certificate", MARGIN, MARGIN, { width: usableW, align: "center" });
                    doc.font(FONT_REGULAR).fontSize(8).fillColor("#444");
                    doc.text(`File: ${cert.fileName}  |  Page ${p + 1} of ${pages.length}`, MARGIN, MARGIN + 16, { width: usableW, align: "center" });
                    doc.fillColor("#000");
                    const newCertY = MARGIN + 32;
                    const newCertH = pageMaxY - newCertY;
                    doc.rect(MARGIN, newCertY, usableW, newCertH).stroke("#ddd");
                    try { doc.image(pages[p], MARGIN, newCertY, { fit: [usableW, newCertH], align: "center", valign: "center" }); } catch {}
                  } else {
                    try { doc.image(pages[p], MARGIN, certY, { fit: [usableW, certH], align: "center", valign: "center" }); } catch {}
                  }
                }
              } catch {}
            } else if ([".png", ".jpg", ".jpeg"].includes(ext)) {
              try {
                const imgBuf = readFileSync(cert.filePath);
                doc.image(imgBuf, MARGIN, certY, { fit: [usableW, certH], align: "center", valign: "center" });
              } catch {}
            }
          }
        } else {
          // Subsequent certificates: render on their own page
          await renderCertificateOnPage(equipCerts[i]);
        }
      }
    }

    // Personnel / Inspector Certificates
    if (personnelCerts.length > 0) {
      // Always start on a new page
      addNewPage();
      doc.font(FONT_BOLD).fontSize(11).fillColor("#000");
      doc.text(`Personnel / Inspector Certificates (${personnelCerts.length})`, MARGIN, MARGIN, { width: usableW });

      // First certificate on THIS page (below the heading)
      for (let i = 0; i < personnelCerts.length; i++) {
        if (i > 0) addNewPage();
        if (i === 0) {
          const cert = personnelCerts[i];
          const ext = (cert.fileExtension || "").toLowerCase();
          const certHeaderY = MARGIN + 20;
          const certY = certHeaderY + 30; // 30pt gap for title + file name
          const certH = pageMaxY - certY;

          doc.font(FONT_BOLD).fontSize(11).fillColor("#000");
          doc.text(cert.title || "Certificate", MARGIN, certHeaderY, { width: usableW, align: "center" });
          doc.font(FONT_REGULAR).fontSize(8).fillColor("#444");
          doc.text(`File: ${cert.fileName}`, MARGIN, certHeaderY + 16, { width: usableW, align: "center" });
          doc.fillColor("#000");

          if (cert.filePath && existsSync(cert.filePath)) {
            doc.rect(MARGIN, certY, usableW, certH).stroke("#ddd");
            if (ext === ".pdf") {
              try {
                const pages = await rasterizePdfPages(cert.filePath);
                for (let p = 0; p < pages.length; p++) {
                  if (p > 0) addNewPage();
                  if (p > 0) {
                    doc.font(FONT_BOLD).fontSize(11).fillColor("#000");
                    doc.text(cert.title || "Certificate", MARGIN, MARGIN, { width: usableW, align: "center" });
                    doc.font(FONT_REGULAR).fontSize(8).fillColor("#444");
                    doc.text(`File: ${cert.fileName}  |  Page ${p + 1} of ${pages.length}`, MARGIN, MARGIN + 16, { width: usableW, align: "center" });
                    doc.fillColor("#000");
                    const newCertY = MARGIN + 32;
                    const newCertH = pageMaxY - newCertY;
                    doc.rect(MARGIN, newCertY, usableW, newCertH).stroke("#ddd");
                    try { doc.image(pages[p], MARGIN, newCertY, { fit: [usableW, newCertH], align: "center", valign: "center" }); } catch {}
                  } else {
                    try { doc.image(pages[p], MARGIN, certY, { fit: [usableW, certH], align: "center", valign: "center" }); } catch {}
                  }
                }
              } catch {}
            } else if ([".png", ".jpg", ".jpeg"].includes(ext)) {
              try {
                const imgBuf = readFileSync(cert.filePath);
                doc.image(imgBuf, MARGIN, certY, { fit: [usableW, certH], align: "center", valign: "center" });
              } catch {}
            }
          }
        } else {
          await renderCertificateOnPage(personnelCerts[i]);
        }
      }
    }

    // After certificates, set y to pageMaxY so the next section starts on a new page
    y = pageMaxY;
  }

  // ── OVERRIDE NOTE ──
  if (report.overrideReason) {
    y += 60;
    doc.font(FONT_BOLD).fontSize(8).fillColor("#a00");
    doc.text("Override Applied (Recorded):", MARGIN, y, { width: 200 });
    doc.font(FONT_REGULAR).fillColor("#000").fontSize(7);
    doc.text(report.overrideReason, MARGIN + 140, y, {
      width: pageW - 2 * MARGIN - 140,
    });
  }

  // NOTE: The sign-off is now on the first page (after the info grid),
  // not at the end of the document. See the "SIGN-OFF" block above.

  doc.end();
}

// ─── PHOTO CELL HELPER ───
// Draws a single photo cell: bordered rectangle, fitted image (centered,
// aspect ratio preserved), and caption below — all within a fixed-size
// cell. No overlap with adjacent cells.

function drawPhotoCell(
  doc: Doc,
  photo: ReportPhoto,
  x: number,
  y: number,
  photoW: number,
  photoH: number,
  fontRegular: string,
) {
  // Draw the bordered cell
  doc.rect(x, y, photoW, photoH).stroke("#999");

  // Embed the image (fitted, centered, aspect ratio preserved)
  if (photo.filePath && existsSync(photo.filePath)) {
    try {
      const imgBuf = readFileSync(photo.filePath);
      doc.image(imgBuf, x + 1, y + 1, {
        fit: [photoW - 2, photoH - 2],
        align: "center",
        valign: "center",
      });
    } catch {
      doc.fillColor("#999").fontSize(7).font(fontRegular);
      doc.text("[Image Unreadable]", x + 4, y + photoH / 2 - 5, {
        width: photoW - 8, align: "center",
      });
      doc.fillColor("#000");
    }
  } else {
    doc.fillColor("#999").fontSize(7).font(fontRegular);
    doc.text(`[File Missing: ${photo.fileName}]`, x + 4, y + photoH / 2 - 5, {
      width: photoW - 8, align: "center",
    });
    doc.fillColor("#000");
  }

  // Draw caption below the photo (within the cell's allocated caption space)
  doc.font(fontRegular).fontSize(7).fillColor("#333");
  const caption = photo.caption || photo.fileName;
  doc.text(caption, x, y + photoH + 2, { width: photoW, align: "center" });
  doc.fillColor("#000");
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
  doc.font(FONT_BOLD).fontSize(11).fillColor("#000");
  doc.text(drawing.title || "Drawing", MARGIN, MARGIN, {
    width: availW, align: "center",
  });
  doc.font(FONT_REGULAR).fontSize(8).fillColor("#444");
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
  doc.font(FONT_REGULAR).fontSize(7).fillColor("#666");
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
  doc.font(FONT_BOLD).fontSize(11).fillColor("#000");
  doc.text(drawing.title || "Drawing", MARGIN, MARGIN, {
    width: availW, align: "center",
  });
  doc.font(FONT_REGULAR).fontSize(8).fillColor("#444");
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

// ─── VISUAL OBSERVATION TABLE HELPERS ───
// These mirror drawTableHeader / drawMeasurementRow but for the visual
// inspection observation rows. The header uses a blue accent instead of
// green to visually distinguish the report type.

const VISUAL_HEADER_BG = "#1e4d8b";
const VISUAL_HEADER_FG = "#ffffff";

function drawVisualTableHeader(doc: Doc, columns: Column[], colWidths: number[], y: number, pageW: number) {
  const usable = pageW - 2 * MARGIN;
  doc.rect(MARGIN, y, usable, 36).fill(VISUAL_HEADER_BG).fillColor(VISUAL_HEADER_FG);
  let x = MARGIN;
  doc.font(FONT_BOLD).fontSize(7).fillColor(VISUAL_HEADER_FG);
  for (let i = 0; i < columns.length; i++) {
    const c = columns[i];
    const w = colWidths[i];
    const lines = c.header.split("\n");
    let ly = y + 4;
    for (const ln of lines) {
      doc.text(ln, x + 3, ly, { width: w - 6, align: "center" });
      ly += 9;
    }
    doc.rect(x, y, w, 36).stroke("#0e2d5b");
    x += w;
  }
  doc.fillColor("#000");
}

function drawVisualObservationRow(
  doc: Doc,
  o: VisualInspectionObservation,
  columns: Column[],
  colWidths: number[],
  y: number,
) {
  const rowH = 28;
  const usable = doc.page.width - 2 * MARGIN;
  doc.rect(MARGIN, y, usable, rowH).stroke("#999");
  let x = MARGIN;
  const cellPad = 3;
  doc.font(FONT_REGULAR).fontSize(7).fillColor("#000");

  for (let i = 0; i < columns.length; i++) {
    const c = columns[i];
    const w = colWidths[i];
    let text = "";
    switch (c.key) {
      case "vPtNo":       text = o.pointNo; break;
      case "vLocation":   text = o.location ?? ""; break;
      case "vPipeCond":   text = o.pipelineCondition ?? ""; break;
      case "vExtSurf":    text = o.externalSurfaceCondition ?? ""; break;
      case "vCoatPaint":  text = o.coatingPaintCondition ?? ""; break;
      case "vCorrosion":  text = o.corrosionObserved ?? ""; break;
      case "vLeakage":    text = o.leakageObserved ?? ""; break;
      case "vDamage":     text = o.damageOrDeformation ?? ""; break;
      case "vSupports":   text = o.supportsHangersCondition ?? ""; break;
      case "vWeld":       text = o.weldJointCondition ?? ""; break;
      case "vInsulation": text = o.insulationCondition ?? ""; break;
      case "vFindings":   text = o.findings ?? ""; break;
      case "vRecs":       text = o.recommendations ?? ""; break;
      case "vComments":   text = o.inspectorComments ?? ""; break;
    }
    doc.rect(x, y, w, rowH).stroke("#bbb");
    const maxW = w - 2 * cellPad;
    // Truncate with ellipsis if too long
    const wrapped = doc.widthOfString(text) > maxW
      ? text.slice(0, Math.floor((maxW / Math.max(1, doc.widthOfString(text))) * text.length)) + "…"
      : text;
    doc.text(wrapped, x + cellPad, y + 9, {
      width: maxW, align: "left",
    });
    x += w;
  }
}

// ─── CONDITION ASSESSMENT HELPER ───
// Renders the condition assessment fields as a labeled grid (single-line
// fields) followed by multi-line text blocks for the longer fields.
// Returns the new y cursor after drawing all fields.

function drawConditionAssessment(
  doc: Doc,
  report: any,
  startY: number,
  pageW: number,
  _pageH: number,
  margin: number,
  maxRowY: number,
  addNewPage: () => void,
): number {
  let y = startY;

  // Section heading
  if (y + 20 > maxRowY) { addNewPage(); y = margin; }
  doc.font(FONT_BOLD).fontSize(11).fillColor("#000");
  doc.text("Condition Assessment", margin, y, { width: pageW - 2 * margin, align: "left" });
  y += 22;

  // Single-line fields rendered as a 2-column label/value grid
  const singleLineFields: Array<[string, string | null | undefined]> = [
    ["Pipeline Age (years)", report.pipelineAgeYears != null ? String(report.pipelineAgeYears) : "—"],
    ["Service / Fluid", report.serviceFluid],
    ["Operating Condition", report.operatingCondition],
    ["Overall Condition Rating", report.overallConditionRating],
    ["Risk / Priority Level", report.riskPriorityLevel],
    ["Previous Inspection Reference", report.previousInspectionRef],
  ];

  const labelW = 180;
  const valueW = (pageW - 2 * margin - 2 * labelW) / 2;
  const minRowH = 16;
  const fontSizeInfo = 9;
  const cellPad = 4;

  for (let i = 0; i < singleLineFields.length; i += 2) {
    const left = singleLineFields[i];
    const right = singleLineFields[i + 1] ?? ["", "—"];

    doc.font(FONT_BOLD).fontSize(fontSizeInfo);
    const leftLabelH = doc.heightOfString(left[0] ?? "", { width: labelW - 2 * cellPad });
    const rightLabelH = doc.heightOfString(right[0] ?? "", { width: labelW - 2 * cellPad });
    doc.font(FONT_REGULAR).fontSize(fontSizeInfo);
    const leftValStr = left[1] ?? "—";
    const rightValStr = right[1] ?? "—";
    const leftValH = doc.heightOfString(leftValStr, { width: valueW - 2 * cellPad });
    const rightValH = doc.heightOfString(rightValStr, { width: valueW - 2 * cellPad });
    const rowH = Math.max(minRowH, Math.max(leftLabelH, leftValH, rightLabelH, rightValH) + cellPad * 2);

    if (y + rowH > maxRowY) { addNewPage(); y = margin; }

    // Left label
    doc.font(FONT_BOLD).fontSize(fontSizeInfo).fillColor("#000");
    doc.rect(margin, y, labelW, rowH).stroke("#888");
    doc.text(left[0] ?? "", margin + cellPad, y + cellPad, { width: labelW - 2 * cellPad, align: "left" });
    // Left value
    doc.font(FONT_REGULAR).fontSize(fontSizeInfo);
    doc.rect(margin + labelW, y, valueW, rowH).stroke("#888");
    doc.text(leftValStr, margin + labelW + cellPad, y + cellPad, { width: valueW - 2 * cellPad, align: "left" });

    // Right label
    const rightX = margin + labelW + valueW;
    doc.font(FONT_BOLD).fontSize(fontSizeInfo);
    doc.rect(rightX, y, labelW, rowH).stroke("#888");
    doc.text(right[0] ?? "", rightX + cellPad, y + cellPad, { width: labelW - 2 * cellPad, align: "left" });
    // Right value
    doc.font(FONT_REGULAR).fontSize(fontSizeInfo);
    doc.rect(rightX + labelW, y, valueW, rowH).stroke("#888");
    doc.text(rightValStr, rightX + labelW + cellPad, y + cellPad, { width: valueW - 2 * cellPad, align: "left" });

    y += rowH;
  }

  // Multi-line text blocks
  const multiLineFields: Array<[string, string | null | undefined]> = [
    ["Corrosion Condition", report.corrosionCondition],
    ["Damage Assessment", report.damageAssessment],
    ["Current Inspection Findings", report.currentInspectionFindings],
    ["Recommendations", report.recommendations],
    ["Next Inspection Recommendation", report.nextInspectionRecommendation],
  ];

  for (const [label, value] of multiLineFields) {
    const text = (value ?? "").trim();
    if (!text) continue;  // skip empty fields entirely
    doc.font(FONT_REGULAR).fontSize(8);
    const textH = doc.heightOfString(text, { width: pageW - 2 * margin - 8 });
    const blockH = 18 + textH + 8;  // label + gap + text + bottom pad
    if (y + blockH > maxRowY) { addNewPage(); y = margin; }
    // Label
    doc.font(FONT_BOLD).fontSize(9).fillColor("#000");
    doc.text(label, margin, y);
    y += 14;
    // Bordered text box
    doc.rect(margin, y, pageW - 2 * margin, textH + 8).stroke("#bbb");
    doc.font(FONT_REGULAR).fontSize(8);
    doc.text(text, margin + 4, y + 4, { width: pageW - 2 * margin - 8, align: "left" });
    y += textH + 8 + 8;
  }

  return y;
}

// ─── DPT TABLE HELPERS ───

const DPT_HEADER_BG = "#5b2c6f";
const DPT_HEADER_FG = "#ffffff";

function drawDptTableHeader(doc: Doc, headers: string[], colWidths: number[], y: number, pageW: number) {
  const usable = pageW - 2 * MARGIN;
  doc.rect(MARGIN, y, usable, 36).fill(DPT_HEADER_BG).fillColor(DPT_HEADER_FG);
  let x = MARGIN;
  doc.font(FONT_BOLD).fontSize(7).fillColor(DPT_HEADER_FG);
  for (let i = 0; i < headers.length; i++) {
    const w = colWidths[i];
    const lines = headers[i].split("\n");
    let ly = y + 4;
    for (const ln of lines) {
      doc.text(ln, x + 3, ly, { width: w - 6, align: "center" });
      ly += 9;
    }
    doc.rect(x, y, w, 36).stroke("#3a1d4a");
    x += w;
  }
  doc.fillColor("#000");
}

function drawDptRow(
  doc: Doc,
  obs: { serialNo: number; description: string | null; weldType: string | null; result: string; remarks: string | null; customColumnValues: string | null },
  headers: string[],
  colWidths: number[],
  y: number,
  customCols: Array<{ id: string; name: string; unit: string }>,
) {
  const rowH = 28;
  const usable = doc.page.width - 2 * MARGIN;
  doc.rect(MARGIN, y, usable, rowH).stroke("#999");
  let x = MARGIN;
  const cellPad = 3;
  doc.font(FONT_REGULAR).fontSize(8).fillColor("#000");

  for (let i = 0; i < headers.length; i++) {
    const w = colWidths[i];
    let text = "";
    if (i === 0) text = String(obs.serialNo);
    else if (i === 1) text = obs.description ?? "—";
    else if (i === 2) text = obs.weldType ?? "—";
    else if (i === 3) {
      text = obs.result;
      // Color-code the result
      if (obs.result === "Reject") {
        doc.rect(x, y, w, rowH).fill("#fee2e2");
        doc.fillColor("#991b1b");
      } else {
        doc.rect(x, y, w, rowH).fill("#dcfce7");
        doc.fillColor("#166534");
      }
    } else if (i === headers.length - 1) {
      text = obs.remarks ?? "—";
    } else {
      // Custom column
      const colIdx = i - 4; // offset by the 4 system columns
      if (colIdx >= 0 && colIdx < customCols.length) {
        try {
          const vals = JSON.parse(obs.customColumnValues || "{}");
          text = vals[customCols[colIdx].id] ?? "—";
        } catch { text = "—"; }
      }
    }

    // Draw border (for non-result columns)
    if (i !== 3) {
      doc.rect(x, y, w, rowH).stroke("#bbb");
      doc.fillColor("#000");
    }

    const maxW = w - 2 * cellPad;
    const wrapped = doc.widthOfString(text) > maxW
      ? text.slice(0, Math.floor((maxW / Math.max(1, doc.widthOfString(text))) * text.length)) + "…"
      : text;
    doc.font(i === 3 ? FONT_BOLD : FONT_REGULAR).fontSize(8);
    doc.text(wrapped, x + cellPad, y + 9, {
      width: maxW, align: i === 0 || i === 3 ? "center" : "left",
    });
    doc.fillColor("#000");
    x += w;
  }
}

// ─── TABLE HELPERS ───

function drawTableHeader(doc: Doc, columns: Column[], colWidths: number[], y: number, pageW: number) {
  const usable = pageW - 2 * MARGIN;
  doc.rect(MARGIN, y, usable, 36).fill(HEADER_BG).fillColor(HEADER_FG);
  let x = MARGIN;
  doc.font(FONT_BOLD).fontSize(7).fillColor(HEADER_FG);
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
  doc.font(FONT_REGULAR).fontSize(8).fillColor("#000");

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
