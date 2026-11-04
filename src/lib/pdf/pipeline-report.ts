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
type ReportType =
  | "PIPELINE_THICKNESS"
  | "PIPELINE_VISUAL"
  | "PIPELINE_CONDITION"
  | "PIPELINE_DPT"
  | "PIPELINE_MPT"
  | "PIPELINE_WELD_SCAN"
  | "PIPELINE_UT";

const REPORT_TYPE_TITLE: Record<ReportType, string> = {
  PIPELINE_THICKNESS: "PIPELINE THICKNESS MEASUREMENT REPORT",
  PIPELINE_VISUAL:    "PIPELINE VISUAL INSPECTION REPORT",
  PIPELINE_CONDITION: "PIPELINE CONDITION ASSESSMENT REPORT",
  PIPELINE_DPT:       "DYE PENETRANT TESTING REPORT",
  PIPELINE_MPT:       "MAGNETIC PARTICLE TESTING REPORT",
  PIPELINE_WELD_SCAN: "WELD SCAN REPORT",
  PIPELINE_UT:        "ULTRASONIC TEST REPORT",
};

function getReportType(raw: any): ReportType {
  const v = String(raw ?? "PIPELINE_THICKNESS");
  if (
    v === "PIPELINE_VISUAL" ||
    v === "PIPELINE_CONDITION" ||
    v === "PIPELINE_DPT" ||
    v === "PIPELINE_MPT" ||
    v === "PIPELINE_WELD_SCAN" ||
    v === "PIPELINE_UT"
  ) return v;
  return "PIPELINE_THICKNESS";
}

// Report types that DO NOT include engineering drawing uploads. For these
// types the PDF skips the drawing-pages section entirely and goes straight
// from the cover/findings to the inspection table.
const NO_DRAWINGS_REPORT_TYPES: ReportType[] = [
  "PIPELINE_DPT",
  "PIPELINE_MPT",
  "PIPELINE_WELD_SCAN",
  "PIPELINE_CONDITION",
];

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

// ─── Table colour palette (clean, professional, engineering-report style) ───
// All tables in the report use the same neutral palette:
//   • Header background: very light grey (#f1f5f9) — readable, not distracting
//   • Header text: dark grey / near-black (#1f2937) — high contrast
//   • Outer border: dark grey (#374151) — solid, clearly visible
//   • Internal cell borders: medium grey (#9ca3af) — distinct but not heavy
//   • Row data text: black (#000)
//
// The previous palette used report-type-specific accent colours (green for
// thickness, blue for visual, purple for DPT). Per spec, those heavy
// colours have been removed in favour of a single clean engineering style
// across all tables. The only colour exception is the DPT result cell,
// which keeps its Accept (green tint) / Reject (red tint) colour coding
// because it conveys meaningful pass/fail information.

const MARGIN = 28;
const TABLE_HEADER_BG = "#f1f5f9";        // very light grey
const TABLE_HEADER_FG = "#1f2937";        // dark grey
const TABLE_OUTER_BORDER = "#374151";     // dark grey outer border
const TABLE_INNER_BORDER = "#9ca3af";     // medium grey inner borders
const TABLE_ROW_ALT_BG = "#fafafa";       // very faint alt-row tint (readability)

// Legacy aliases kept for backward compatibility with any code that still
// references them — they now point to the clean palette.
const HEADER_BG = TABLE_HEADER_BG;
const HEADER_FG = TABLE_HEADER_FG;

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
  // Exclude PRIMARY-category photos from the Inspection Photographs gallery.
  // PRIMARY photos are shown on the first page in their designated position;
  // they must NOT also appear in the gallery section.
  const allPhotos = (input.photos ?? input.report.reportPhotos ?? []).filter(
    (p: any) => p.category !== "PRIMARY",
  );
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
    ["Unit Name", report.inspectionArea],
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
        // Use the editable approvedByName field; fall back to approver.name
        name: (report as any).approvedByName ?? report.approver?.name ?? "—",
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

  // Only create a new page for findings if there IS findings content to
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
  }

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
  //
  // PAGE-BREAK RULE (applies to ALL sections):
  //   A heading must NEVER appear alone at the bottom of a page with its
  //   content starting on the next page. The helper below computes the
  //   body height BEFORE drawing the heading, then checks whether heading
  //   + body fit together on the current page. If they don't, BOTH move
  //   to a new page. This guarantees the heading is always visually
  //   connected to at least the beginning of its content.
  // ═══════════════════════════════════════════════════════════════

  // Helper: draw a bold heading followed by a body paragraph, ensuring the
  // heading is never left alone at the bottom of a page.
  //
  // Parameters:
  //   headingText    — the bold heading to render
  //   bodyText       — the body paragraph (plain text, will wrap)
  //   gapBefore      — vertical gap before the heading (default 8pt)
  //   gapAfter       — vertical gap between heading and body (default 14pt)
  //   headingFontSize — font size for the heading (default 9pt)
  //   bodyFontSize   — font size for the body (default 8pt)
  //
  // Behaviour:
  //   • Computes bodyH = wrapped height of bodyText at bodyFontSize.
  //   • Computes headingH ≈ 12pt (single line at 9pt).
  //   • totalH = gapBefore + headingH + gapAfter + bodyH + 6.
  //   • If y + totalH > pageMaxY, BOTH heading and body move to a new page.
  //   • If bodyH itself exceeds a full page, the body is rendered with
  //     pdfkit's auto-flow (the heading stays with the first portion of
  //     the body, the rest flows across pages naturally).
  const drawHeadingAndBody = (
    headingText: string,
    bodyText: string,
    gapBefore = 8,
    gapAfter = 14,
    headingFontSize = 9,
    bodyFontSize = 8,
  ) => {
    if (!bodyText || !bodyText.trim()) return;
    const usableW = pageW - 2 * MARGIN;
    // Compute body height at the body font size (BEFORE drawing the heading,
    // so we can decide whether to move to a new page first).
    doc.font(FONT_REGULAR).fontSize(bodyFontSize);
    const bodyH = doc.heightOfString(bodyText, { width: usableW });
    // Heading is a single line at headingFontSize (approximate height)
    const headingH = headingFontSize + 3;
    // PAGE-BREAK RULE: if heading + body don't fit on the current page,
    // move BOTH to a new page. This is the key rule — a heading must
    // NEVER appear alone at the bottom of a page.
    // If the body alone is taller than a full page, only require that the
    // heading + ~3 lines of body fit (the rest flows across pages naturally).
    const minBodyPreviewH = bodyFontSize * 3 + 4; // ~3 lines of body text
    const minNeeded = gapBefore + headingH + gapAfter + minBodyPreviewH;
    const totalNeeded = gapBefore + headingH + gapAfter + bodyH + 6;
    const needed = bodyH > pageMaxY - MARGIN ? minNeeded : totalNeeded;
    if (y + needed > pageMaxY) {
      addNewPage();
      y = MARGIN;
    }
    // Draw heading
    y += gapBefore;
    doc.font(FONT_BOLD).fontSize(headingFontSize).fillColor("#000");
    doc.text(headingText, MARGIN, y, { width: usableW });
    // Move to body_top (heading height + gap-after)
    y += headingH + gapAfter;
    // Draw body — pdfkit will auto-flow across pages if the body is long.
    // The heading has already been drawn above on the same page, so it
    // stays visually connected to the start of the body.
    doc.font(FONT_REGULAR).fontSize(bodyFontSize);
    doc.text(bodyText, MARGIN, y, { width: usableW, align: "left" });
    // After pdfkit renders the text (possibly across multiple pages), doc.y
    // is the current y position. Sync our local y.
    y = doc.y + 6;
    doc.fillColor("#000");
  };

  // ── 1. INSPECTION DESCRIPTION ──
  if (report.inspectionDescription) {
    drawHeadingAndBody(
      "Inspection Description",
      report.inspectionDescription,
      10,  // larger gap before this section
      14,
      9,
      8,
    );
  }

  // ── 2. SUMMARY OF SITE OBSERVATIONS ──
  {
    const text = ((report as any).siteObservationSummary ?? "").trim();
    if (text) {
      drawHeadingAndBody(
        "Summary Of Site Observations",
        text,
        8,
        14,
        9,
        8,
      );
    }
  }

  // ── 3. RESULTS ──
  {
    const text = ((report as any).results ?? "").trim();
    if (text) {
      drawHeadingAndBody(
        "Results",
        text,
        8,
        14,
        9,
        8,
      );
    }
  }

  // ── 4. CONCLUSION ──
  {
    const text = ((report as any).conclusion ?? "").trim();
    if (text) {
      drawHeadingAndBody(
        "Conclusion",
        text,
        8,
        14,
        9,
        8,
      );
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // 5. DRAWING PAGES — each drawing image (or each page of a PDF drawing)
  // gets its own full PDF page, centered, preserving aspect ratio.
  // Drawings appear BEFORE the measurement table.
  //
  // IMPORTANT: DPT / DPPT, MPT, Weld Scan, and Condition Assessment
  // reports DO NOT include engineering drawing uploads. For those report
  // types the linkedDrawings array is ignored entirely (the form hides
  // the drawing upload step too), so the PDF jumps straight from the
  // cover / findings to the inspection table.
  // ═══════════════════════════════════════════════════════════════
  const includeDrawings = !NO_DRAWINGS_REPORT_TYPES.includes(reportType);
  if (includeDrawings) {
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
  // If y === 0, no page was created after the first page (because there
  // was no findings content), so we MUST create a new page here — the
  // first page is full with the cover/sign-off and can't hold body content.
  // If drawings were emitted (only possible when includeDrawings is true
  // AND at least one drawing was attached), the body always starts on a
  // fresh page. Otherwise, continue on the same page if there's room,
  // else a new page.
  const startBodyOnFreshPage = (neededSpace: number) => {
    if (y === 0) {
      // No page exists after the first page — create one now.
      addNewPage();
      y = MARGIN;
    } else if (includeDrawings && linkedDrawings.length > 0) {
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
    // ─── DPT / DPPT REPORT BODY ───
    // Renders, in this order:
    //   1. "3. DYE PENETRANT PROCEDURE" — two-column table with 17 rows
    //      (Date of Examination + 16 typeable procedure fields).
    //   2. "Consumable Details" — two-column table with 3 rows
    //      (Solvent, Penetrant, Developer).
    //   3. DPT Inspection Results — observation table with auto-serial
    //      numbers, Accept / Reject result, custom columns.
    //
    // DPT reports do NOT include engineering drawing uploads — the
    // drawing section is skipped entirely above for this report type.
    startBodyOnFreshPage(160);

    const dptReport = report as any;

    // ─── 3. DYE PENETRANT PROCEDURE ───
    // Two-column table: left = field name (bold), right = value.
    // All values are typeable text from the form (or "—" if blank).
    // PAGE-BREAK RULE: ensure heading + first row fit together.
    {
      const procRowH_local = 18;
      if (y + 24 + procRowH_local > pageMaxY) { addNewPage(); y = MARGIN; }
      y += 6;
      doc.font(FONT_BOLD).fontSize(11).fillColor("#3a1d4a");
      doc.text("3. DYE PENETRANT PROCEDURE", MARGIN, y);
      doc.fillColor("#000");
      y += 18;

      // 17 rows: Date of Examination + 16 typeable procedure fields.
      // Each row is a [label, value] tuple. The value comes straight from
      // the corresponding dpt* field on the report.
      const procedureRows: Array<[string, string | null]> = [
        ["Date of Examination", dptReport.dptDateOfExamination
          ? new Date(dptReport.dptDateOfExamination).toISOString().slice(0, 10)
          : null],
        ["Testing Standard", dptReport.dptTestingStandard],
        ["Acceptance Criteria", dptReport.dptAcceptanceCriteria],
        ["Surface Preparation", dptReport.dptSurfacePreparation],
        ["Surface Temperature", dptReport.dptSurfaceTemperature],
        ["Penetrant Type", dptReport.dptPenetrantType],
        ["Penetrant Process", dptReport.dptPenetrantProcess],
        ["Method of Pre-cleaning", dptReport.dptMethodOfPreCleaning],
        ["Drying Time After Pre-cleaning", dptReport.dptDryingTimeAfterPreCleaning],
        ["Method of Applying Penetrant", dptReport.dptMethodOfApplyingPenetrant],
        ["Penetrating Time", dptReport.dptPenetratingTime],
        ["Method of Removing Excess Penetrant", dptReport.dptMethodOfRemovingExcessPenetrant],
        ["Method of Applying Developer", dptReport.dptMethodOfApplyingDeveloper],
        ["Development Time", dptReport.dptDevelopmentTime],
        ["Interpretation Time", dptReport.dptInterpretationTime],
        ["Lighting Equipment", dptReport.dptLightingEquipment],
        ["Post Cleaning", dptReport.dptPostCleaning],
      ];

      // Two-column table: label column ~38% of usable width, value column ~62%.
      // Each row is drawn as a self-contained bordered unit (outer dark border
      // + inner column separator), so the table renders correctly even when
      // it spans multiple pages.
      const procLabelW = (pageW - 2 * MARGIN) * 0.38;
      const procValueW = (pageW - 2 * MARGIN) - procLabelW;
      const procRowH = 18;
      const procUsableW = pageW - 2 * MARGIN;

      for (const [label, value] of procedureRows) {
        if (y + procRowH > pageMaxY) { addNewPage(); y = MARGIN; }
        // Fill label cell (left) — light purple-tinted background
        doc.rect(MARGIN, y, procLabelW, procRowH).fill("#f3e8fb");
        // Fill value cell (right) — white background
        doc.rect(MARGIN + procLabelW, y, procValueW, procRowH).fill("#ffffff");
        // Outer border around the whole row
        doc.rect(MARGIN, y, procUsableW, procRowH).stroke(TABLE_OUTER_BORDER);
        // Column separator between label and value
        doc.moveTo(MARGIN + procLabelW, y).lineTo(MARGIN + procLabelW, y + procRowH).stroke(TABLE_INNER_BORDER);
        // Label text
        doc.font(FONT_BOLD).fontSize(8.5).fillColor("#000");
        doc.text(label, MARGIN + 4, y + 5, { width: procLabelW - 8 });
        // Value text
        doc.font(FONT_REGULAR).fontSize(8.5).fillColor("#000");
        const valueText = value && value.trim() ? value.trim() : "—";
        const maxW = procValueW - 8;
        let displayText = valueText;
        if (doc.widthOfString(displayText) > maxW) {
          const charsToKeep = Math.floor((maxW / Math.max(1, doc.widthOfString(displayText))) * displayText.length);
          displayText = displayText.slice(0, Math.max(1, charsToKeep - 1)) + "…";
        }
        doc.text(displayText, MARGIN + procLabelW + 4, y + 5, { width: maxW });
        y += procRowH;
      }
      y += 8;
    }

    // ─── CONSUMABLE DETAILS ───
    // Three rows: Solvent, Penetrant, Developer. Same two-column layout
    // as the procedure section. The values are the actual product / make
    // / material entered by the user (or selected from the dropdown).
    // PAGE-BREAK RULE: ensure heading + first row fit together.
    {
      const consRowH_local = 18;
      if (y + 24 + consRowH_local > pageMaxY) { addNewPage(); y = MARGIN; }
      y += 4;
      doc.font(FONT_BOLD).fontSize(11).fillColor("#3a1d4a");
      doc.text("Consumable Details", MARGIN, y);
      doc.fillColor("#000");
      y += 18;

      const consumableRows: Array<[string, string | null]> = [
        ["Solvent", dptReport.dptSolventCleaner],
        ["Penetrant", dptReport.dptPenetrant],
        ["Developer", dptReport.dptDeveloper],
      ];

      const consLabelW = (pageW - 2 * MARGIN) * 0.38;
      const consValueW = (pageW - 2 * MARGIN) - consLabelW;
      const consRowH = 18;
      const consUsableW = pageW - 2 * MARGIN;

      for (const [label, value] of consumableRows) {
        if (y + consRowH > pageMaxY) { addNewPage(); y = MARGIN; }
        // Fill label cell (left)
        doc.rect(MARGIN, y, consLabelW, consRowH).fill("#f3e8fb");
        // Fill value cell (right)
        doc.rect(MARGIN + consLabelW, y, consValueW, consRowH).fill("#ffffff");
        // Outer border around the row
        doc.rect(MARGIN, y, consUsableW, consRowH).stroke(TABLE_OUTER_BORDER);
        // Column separator
        doc.moveTo(MARGIN + consLabelW, y).lineTo(MARGIN + consLabelW, y + consRowH).stroke(TABLE_INNER_BORDER);
        // Label text
        doc.font(FONT_BOLD).fontSize(8.5).fillColor("#000");
        doc.text(label, MARGIN + 4, y + 5, { width: consLabelW - 8 });
        // Value text
        doc.font(FONT_REGULAR).fontSize(8.5).fillColor("#000");
        const valueText = value && value.trim() ? value.trim() : "—";
        const maxW = consValueW - 8;
        let displayText = valueText;
        if (doc.widthOfString(displayText) > maxW) {
          const charsToKeep = Math.floor((maxW / Math.max(1, doc.widthOfString(displayText))) * displayText.length);
          displayText = displayText.slice(0, Math.max(1, charsToKeep - 1)) + "…";
        }
        doc.text(displayText, MARGIN + consLabelW + 4, y + 5, { width: maxW });
        y += consRowH;
      }
      y += 10;
    }

    // ─── DPT INSPECTION RESULTS TABLE ───
    // Dynamic table: system columns (Sl. No, Description, Weld Type,
    // Result, Remarks) + any user-added custom columns. Serial numbers
    // are auto-generated. Result is Accept / Reject.
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
    const indicationSizeColW = 60;
    const resultColW = 60;
    const customColW = 60;

    // Calculate column widths
    const dptFixedW = slColW + descColW + weldColW + indicationSizeColW + resultColW;
    const dptCustomTotalW = dptCustomCols.length * customColW;
    const dptRemarksW = Math.max(100, pageW - 2 * MARGIN - dptFixedW - dptCustomTotalW);
    const dptColWidths = [slColW, descColW, weldColW, indicationSizeColW, resultColW, ...dptCustomCols.map(() => customColW), dptRemarksW];
    const dptColHeaders = ["Sl.\nNo", "Description", "Weld\nType", "Indication\nSize\n(mm)", "Result", ...dptCustomCols.map(c => c.name + (c.unit ? `\n(${c.unit})` : "")), "Remarks"];

    // Section heading — ensure heading + table header + first row fit together
    // (a heading must never appear alone at the bottom of a page).
    if (y + 24 + dptHeaderH + dptRowH > pageMaxY) { addNewPage(); y = MARGIN; }
    y += 4;
    doc.font(FONT_BOLD).fontSize(11).fillColor("#3a1d4a");
    doc.text("DPT Inspection Results", MARGIN, y);
    doc.fillColor("#000");
    y += 16;

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
  } else if (reportType === "PIPELINE_MPT") {
    // ─── MPT (MAGNETIC PARTICLE TESTING) REPORT BODY ───
    // Renders, in this order:
    //   1. "5.1 Magnetic Particle Testing Parameters" — two-column table
    //      with Date of Examination + 20 typeable parameter fields.
    //   2. "Consumable Details" — two-column table with 2 fields.
    //   3. MPT Inspection Results — observation table with auto-serial
    //      numbers, Accept / Reject result, custom columns.
    startBodyOnFreshPage(160);

    const mptReport = report as any;

    // ─── 5.1 MAGNETIC PARTICLE TESTING PARAMETERS ───
    {
      const procRowH = 18;
      if (y + 24 + procRowH > pageMaxY) { addNewPage(); y = MARGIN; }
      y += 6;
      doc.font(FONT_BOLD).fontSize(11).fillColor("#7c2d12");
      doc.text("5.1 Magnetic Particle Testing Parameters", MARGIN, y);
      doc.fillColor("#000");
      y += 18;

      const mptParams: Array<[string, string | null]> = [
        ["Date of Examination", mptReport.mptDateOfExamination
          ? new Date(mptReport.mptDateOfExamination).toISOString().slice(0, 10)
          : null],
        ["Testing Standard", mptReport.mptTestingStandard],
        ["Acceptance Criteria", mptReport.mptAcceptanceCriteria],
        ["Surface preparation", mptReport.mptSurfacePreparation],
        ["Surface temperature", mptReport.mptSurfaceTemperature],
        ["Type of Instrument / SI.No", mptReport.mptInstrumentSerialNo],
        ["Instrument / Calibration Date", mptReport.mptCalibrationDate
          ? new Date(mptReport.mptCalibrationDate).toISOString().slice(0, 10)
          : null],
        ["MPT Method", mptReport.mptMethod],
        ["Type of Current", mptReport.mptTypeOfCurrent],
        ["AC Yoke Lifting Capacity", mptReport.mptAcYokeLiftingCapacity],
        ["Contrast Medium", mptReport.mptContrastMedium],
        ["Method of Pre cleaning", mptReport.mptMethodOfPreCleaning],
        ["Method of applying White Contrast", mptReport.mptMethodOfApplyingWhiteContrast],
        ["AC Yoke Pole Spacing", mptReport.mptAcYokePoleSpacing],
        ["Magnetic Medium", mptReport.mptMagneticMedium],
        ["Method of applying Magnetic Medium", mptReport.mptMethodOfApplyingMagneticMedium],
        ["Development time", mptReport.mptDevelopmentTime],
        ["Interpretation time", mptReport.mptInterpretationTime],
        ["Lightning Equipment", mptReport.mptLightingEquipment],
        ["Post cleaning", mptReport.mptPostCleaning],
      ];

      const labelW = (pageW - 2 * MARGIN) * 0.38;
      const valueW = (pageW - 2 * MARGIN) - labelW;
      const usableW = pageW - 2 * MARGIN;

      for (const [label, value] of mptParams) {
        if (y + procRowH > pageMaxY) { addNewPage(); y = MARGIN; }
        doc.rect(MARGIN, y, labelW, procRowH).fill("#fff7ed");
        doc.rect(MARGIN + labelW, y, valueW, procRowH).fill("#ffffff");
        doc.rect(MARGIN, y, usableW, procRowH).stroke(TABLE_OUTER_BORDER);
        doc.moveTo(MARGIN + labelW, y).lineTo(MARGIN + labelW, y + procRowH).stroke(TABLE_INNER_BORDER);
        doc.font(FONT_BOLD).fontSize(8.5).fillColor("#000");
        doc.text(label, MARGIN + 4, y + 5, { width: labelW - 8 });
        doc.font(FONT_REGULAR).fontSize(8.5).fillColor("#000");
        const valueText = value && value.trim() ? value.trim() : "—";
        const maxW = valueW - 8;
        let displayText = valueText;
        if (doc.widthOfString(displayText) > maxW) {
          const charsToKeep = Math.floor((maxW / Math.max(1, doc.widthOfString(displayText))) * displayText.length);
          displayText = displayText.slice(0, Math.max(1, charsToKeep - 1)) + "…";
        }
        doc.text(displayText, MARGIN + labelW + 4, y + 5, { width: maxW });
        y += procRowH;
      }
      y += 8;
    }

    // ─── CONSUMABLE DETAILS ───
    {
      const consRowH = 18;
      if (y + 24 + consRowH > pageMaxY) { addNewPage(); y = MARGIN; }
      y += 4;
      doc.font(FONT_BOLD).fontSize(11).fillColor("#7c2d12");
      doc.text("Consumable Details", MARGIN, y);
      doc.fillColor("#000");
      y += 18;

      const consumableRows: Array<[string, string | null]> = [
        ["White Contrast", mptReport.mptWhiteContrast],
        ["Wet Particle Iron Ink", mptReport.mptWetParticleIronInk],
      ];

      const labelW = (pageW - 2 * MARGIN) * 0.38;
      const valueW = (pageW - 2 * MARGIN) - labelW;
      const usableW = pageW - 2 * MARGIN;

      for (const [label, value] of consumableRows) {
        if (y + consRowH > pageMaxY) { addNewPage(); y = MARGIN; }
        doc.rect(MARGIN, y, labelW, consRowH).fill("#fff7ed");
        doc.rect(MARGIN + labelW, y, valueW, consRowH).fill("#ffffff");
        doc.rect(MARGIN, y, usableW, consRowH).stroke(TABLE_OUTER_BORDER);
        doc.moveTo(MARGIN + labelW, y).lineTo(MARGIN + labelW, y + consRowH).stroke(TABLE_INNER_BORDER);
        doc.font(FONT_BOLD).fontSize(8.5).fillColor("#000");
        doc.text(label, MARGIN + 4, y + 5, { width: labelW - 8 });
        doc.font(FONT_REGULAR).fontSize(8.5).fillColor("#000");
        const valueText = value && value.trim() ? value.trim() : "—";
        const maxW = valueW - 8;
        let displayText = valueText;
        if (doc.widthOfString(displayText) > maxW) {
          const charsToKeep = Math.floor((maxW / Math.max(1, doc.widthOfString(displayText))) * displayText.length);
          displayText = displayText.slice(0, Math.max(1, charsToKeep - 1)) + "…";
        }
        doc.text(displayText, MARGIN + labelW + 4, y + 5, { width: maxW });
        y += consRowH;
      }
      y += 10;
    }

    // ─── MPT INSPECTION RESULTS TABLE ───
    // Reuses the same DPT observation infrastructure (the DptObservation
    // model and API are shared between DPT and MPT reports).
    {
      const mptObs = mptReport.dptObservations ?? [];
      let mptCustomCols: Array<{ id: string; name: string; unit: string }> = [];
      try {
        const cc = JSON.parse(mptReport.mptCustomColumns ?? "[]");
        if (Array.isArray(cc)) mptCustomCols = cc;
      } catch {}

      const headerH = 36;
      const rowH = 28;
      const slColW = 40;
      const descColW = 200;
      const weldColW = 80;
      const indicationSizeColW = 60;
      const resultColW = 60;
      const customColW = 60;
      const fixedW = slColW + descColW + weldColW + indicationSizeColW + resultColW;
      const customTotalW = mptCustomCols.length * customColW;
      const remarksW = Math.max(100, pageW - 2 * MARGIN - fixedW - customTotalW);
      const colWidths = [slColW, descColW, weldColW, indicationSizeColW, resultColW, ...mptCustomCols.map(() => customColW), remarksW];
      const colHeaders = ["Sl.\nNo", "Description", "Weld\nType", "Indication\nSize\n(mm)", "Result", ...mptCustomCols.map(c => c.name + (c.unit ? `\n(${c.unit})` : "")), "Remarks"];

      // Section heading — ensure heading + table header + first row fit together
      if (y + 24 + headerH + rowH > pageMaxY) { addNewPage(); y = MARGIN; }
      y += 4;
      doc.font(FONT_BOLD).fontSize(11).fillColor("#7c2d12");
      doc.text("MPT Inspection Results", MARGIN, y);
      doc.fillColor("#000");
      y += 16;

      if (y + headerH + rowH > pageMaxY) { addNewPage(); y = MARGIN; }
      drawDptTableHeader(doc, colHeaders, colWidths, y, pageW);
      y += headerH;

      for (const obs of mptObs) {
        if (y + rowH > pageMaxY) {
          addNewPage();
          drawDptTableHeader(doc, colHeaders, colWidths, MARGIN, pageW);
          y = MARGIN + headerH;
        }
        drawDptRow(doc, obs, colHeaders, colWidths, y, mptCustomCols);
        y += rowH;
      }

      if (mptObs.length === 0) {
        doc.font(FONT_REGULAR).fontSize(8).fillColor("#666");
        doc.rect(MARGIN, y, pageW - 2 * MARGIN, rowH).stroke("#bbb");
        doc.text("No MPT observations recorded.", MARGIN + 4, y + 9, { width: pageW - 2 * MARGIN - 8, align: "center" });
        doc.fillColor("#000");
        y += rowH;
      }
    }
  } else if (reportType === "PIPELINE_UT") {
    // ─── UT (ULTRASONIC TEST) REPORT BODY ───
    // Renders all UT sections: Report Identification Details, UFD Details,
    // Equipment Details, Test Probe Details, Scanning Details, Test Results,
    // Inspection Note.
    startBodyOnFreshPage(200);

    const utReport = report as any;
    const usableW = pageW - 2 * MARGIN;

    // Helper: draw a two-column "label | value" table for the given rows
    const drawTwoColTable = (heading: string, rows: Array<[string, string | null]>) => {
      const rowH = 18;
      const labelW = usableW * 0.35;
      const valueW = usableW - labelW;
      if (y + 24 + rowH > pageMaxY) { addNewPage(); y = MARGIN; }
      y += 6;
      doc.font(FONT_BOLD).fontSize(10).fillColor("#000");
      doc.text(heading, MARGIN, y);
      doc.fillColor("#000");
      y += 16;
      for (const [label, value] of rows) {
        if (y + rowH > pageMaxY) { addNewPage(); y = MARGIN; }
        doc.rect(MARGIN, y, labelW, rowH).fill("#eff6ff");
        doc.rect(MARGIN + labelW, y, valueW, rowH).fill("#ffffff");
        doc.rect(MARGIN, y, usableW, rowH).stroke(TABLE_OUTER_BORDER);
        doc.moveTo(MARGIN + labelW, y).lineTo(MARGIN + labelW, y + rowH).stroke(TABLE_INNER_BORDER);
        doc.font(FONT_BOLD).fontSize(7.5).fillColor("#000");
        doc.text(label, MARGIN + 3, y + 5, { width: labelW - 6 });
        doc.font(FONT_REGULAR).fontSize(7.5);
        const val = value && String(value).trim() ? String(value).trim() : "—";
        let disp = val;
        if (doc.widthOfString(disp) > valueW - 6) {
          const c = Math.floor((valueW - 6) / Math.max(1, doc.widthOfString(disp)) * disp.length);
          disp = disp.slice(0, Math.max(1, c - 1)) + "…";
        }
        doc.text(disp, MARGIN + labelW + 3, y + 5, { width: valueW - 6 });
        y += rowH;
      }
      y += 6;
    };

    // Helper: draw a multi-column data table from JSON rows
    const drawMultiColTable = (heading: string, headers: string[], rowFields: string[], jsonStr: string, dateFields: string[] = []) => {
      const headerH = 28;
      const rowH = 22;
      const colCount = headers.length;
      const colW = usableW / colCount;
      if (y + 24 + headerH + rowH > pageMaxY) { addNewPage(); y = MARGIN; }
      y += 6;
      doc.font(FONT_BOLD).fontSize(10).fillColor("#000");
      doc.text(heading, MARGIN, y);
      doc.fillColor("#000");
      y += 16;

      // Parse rows
      let dataRows: any[] = [];
      try { const parsed = JSON.parse(jsonStr || "[]"); if (Array.isArray(parsed)) dataRows = parsed; } catch {}

      // Draw header
      const drawHeader = (headerY: number) => {
        doc.rect(MARGIN, headerY, usableW, headerH).fill(TABLE_HEADER_BG);
        doc.rect(MARGIN, headerY, usableW, headerH).stroke(TABLE_OUTER_BORDER);
        let x = MARGIN;
        doc.font(FONT_BOLD).fontSize(6).fillColor(TABLE_HEADER_FG);
        for (let i = 0; i < headers.length; i++) {
          if (i > 0) doc.moveTo(x, headerY).lineTo(x, headerY + headerH).stroke(TABLE_INNER_BORDER);
          doc.text(headers[i], x + 2, headerY + 8, { width: colW - 4, align: "center" });
          x += colW;
        }
        doc.fillColor("#000");
      };
      drawHeader(y);
      y += headerH;

      // Draw rows
      for (let r = 0; r < dataRows.length; r++) {
        if (y + rowH > pageMaxY) {
          addNewPage();
          y = MARGIN;
          drawHeader(y);
          y += headerH;
        }
        let x = MARGIN;
        for (let i = 0; i < headers.length; i++) {
          if (i > 0) doc.moveTo(x, y).lineTo(x, y + rowH).stroke(TABLE_INNER_BORDER);
          let val = "";
          if (i === 0 && heading.includes("Test Results")) {
            val = String(r + 1);
          } else {
            const fieldIdx = heading.includes("Test Results") ? i - 1 : i;
            const field = rowFields[fieldIdx];
            val = dataRows[r][field] ?? "—";
            if (dateFields.includes(field) && val && val !== "—") {
              try { val = new Date(val).toISOString().slice(0, 10); } catch {}
            }
          }
          doc.rect(x, y, colW, rowH).stroke(TABLE_INNER_BORDER);
          doc.font(FONT_REGULAR).fontSize(6.5).fillColor("#000");
          let disp = String(val);
          if (doc.widthOfString(disp) > colW - 4) {
            const c = Math.floor((colW - 4) / Math.max(1, doc.widthOfString(disp)) * disp.length);
            disp = disp.slice(0, Math.max(1, c - 1)) + "…";
          }
          doc.text(disp, x + 2, y + 7, { width: colW - 4, align: "center" });
          x += colW;
        }
        doc.rect(MARGIN, y, usableW, rowH).stroke(TABLE_OUTER_BORDER);
        y += rowH;
      }
      if (dataRows.length === 0) {
        doc.font(FONT_REGULAR).fontSize(7).fillColor("#666");
        doc.rect(MARGIN, y, usableW, rowH).stroke("#bbb");
        doc.text("No entries recorded.", MARGIN + 4, y + 7, { width: usableW - 8, align: "center" });
        doc.fillColor("#000");
        y += rowH;
      }
      y += 6;
    };

    // 1. Report Identification Details
    drawTwoColTable("Report Identification Details", [
      ["Client", report.client?.name ?? null],
      ["Test Report No.", report.reportNumber],
      ["Sub Contract", utReport.utSubContract],
      ["Test Date", utReport.fromDate ? new Date(utReport.fromDate).toISOString().slice(0, 10) : null],
      ["Project", utReport.utProject],
      ["Job Location", utReport.utJobLocation],
      ["Material", utReport.utMaterial],
      ["Job Description", utReport.utJobDescription],
      ["Couplant", utReport.utCouplant],
      ["Reference Documents", utReport.utReferenceDocuments],
      ["UT Procedure No.", utReport.utProcedureNo],
      ["Acceptance Standard", utReport.utAcceptanceStandard],
    ]);

    // 2. UFD Details
    {
      const text = (utReport.utUfdDetails ?? "").trim();
      if (y + 24 + 30 > pageMaxY) { addNewPage(); y = MARGIN; }
      y += 4;
      doc.font(FONT_BOLD).fontSize(10).fillColor("#000");
      doc.text("UFD Details", MARGIN, y);
      y += 16;
      if (text) {
        doc.font(FONT_REGULAR).fontSize(8);
        const h = doc.heightOfString(text, { width: usableW });
        if (y + h > pageMaxY) { addNewPage(); y = MARGIN; }
        doc.rect(MARGIN, y, usableW, h + 8).stroke(TABLE_OUTER_BORDER);
        doc.text(text, MARGIN + 4, y + 4, { width: usableW - 8 });
        y += h + 8 + 4;
      } else {
        doc.rect(MARGIN, y, usableW, 20).stroke(TABLE_OUTER_BORDER);
        doc.font(FONT_REGULAR).fontSize(7).fillColor("#999");
        doc.text("—", MARGIN + 4, y + 7, { width: usableW - 8 });
        y += 20 + 4;
      }
      doc.fillColor("#000");
      y += 4;
    }

    // 3. Equipment Details
    drawMultiColTable(
      "Equipment Details",
      ["Equipment Type", "Machine Make", "Model", "M/c Sr. No.", "Calibration Due Date"],
      ["equipmentType", "machineMake", "model", "mcSrNo", "calibrationDueDate"],
      utReport.utEquipmentRows ?? "[]",
      ["calibrationDueDate"],
    );

    // 4. Test Probe Details
    drawMultiColTable(
      "Test Probe Details",
      ["Probe Type", "Probe Angle", "Frequency", "Size", "Probe No.", "Range", "Ref dB", "Scan dB"],
      ["probeType", "probeAngle", "frequency", "size", "probeNo", "range", "referenceDb", "scanningDb"],
      utReport.utProbeRows ?? "[]",
    );

    // 5. Scanning Details (two-column 2x2 layout)
    {
      const rowH = 18;
      const labelW = usableW * 0.25;
      const valueW = (usableW - 2 * labelW) / 2;
      if (y + 24 + rowH * 3 > pageMaxY) { addNewPage(); y = MARGIN; }
      y += 4;
      doc.font(FONT_BOLD).fontSize(10).fillColor("#000");
      doc.text("Scanning Details", MARGIN, y);
      y += 16;
      const scanPairs: Array<[string, string | null]> = [
        ["Calibration Block (DAC Block)", utReport.utCalibrationBlock],
        ["Extent of Examination", utReport.utExtentOfExamination],
        ["Surface Condition", utReport.utSurfaceCondition],
        ["Reference Level", utReport.utReferenceLevel],
        ["Flaw Sizing Technique", utReport.utFlawSizingTechnique],
        ["", null],
      ];
      for (let i = 0; i < scanPairs.length; i += 2) {
        if (y + rowH > pageMaxY) { addNewPage(); y = MARGIN; }
        const left = scanPairs[i];
        const right = scanPairs[i + 1] ?? ["", null];
        // Left label
        doc.rect(MARGIN, y, labelW, rowH).fill("#eff6ff");
        doc.font(FONT_BOLD).fontSize(7).fillColor("#000");
        doc.text(left[0], MARGIN + 3, y + 5, { width: labelW - 6 });
        // Left value
        doc.rect(MARGIN + labelW, y, valueW, rowH).fill("#ffffff");
        doc.font(FONT_REGULAR).fontSize(7);
        const lv = left[1] && String(left[1]).trim() ? String(left[1]).trim() : "—";
        doc.text(lv, MARGIN + labelW + 3, y + 5, { width: valueW - 6 });
        // Right label
        doc.rect(MARGIN + labelW + valueW, y, labelW, rowH).fill("#eff6ff");
        doc.font(FONT_BOLD).fontSize(7);
        doc.text(right[0], MARGIN + labelW + valueW + 3, y + 5, { width: labelW - 6 });
        // Right value
        doc.rect(MARGIN + 2 * labelW + valueW, y, valueW, rowH).fill("#ffffff");
        doc.font(FONT_REGULAR).fontSize(7);
        const rv = right[1] && String(right[1]).trim() ? String(right[1]).trim() : "—";
        doc.text(rv, MARGIN + 2 * labelW + valueW + 3, y + 5, { width: valueW - 6 });
        // Borders
        doc.rect(MARGIN, y, usableW, rowH).stroke(TABLE_OUTER_BORDER);
        doc.moveTo(MARGIN + labelW, y).lineTo(MARGIN + labelW, y + rowH).stroke(TABLE_INNER_BORDER);
        doc.moveTo(MARGIN + labelW + valueW, y).lineTo(MARGIN + labelW + valueW, y + rowH).stroke(TABLE_INNER_BORDER);
        doc.moveTo(MARGIN + 2 * labelW + valueW, y).lineTo(MARGIN + 2 * labelW + valueW, y + rowH).stroke(TABLE_INNER_BORDER);
        y += rowH;
      }
      doc.fillColor("#000");
      y += 4;
    }

    // 6. Test Results
    drawMultiColTable(
      "Test Results",
      ["Sl. No", "Description", "Beam ID", "No. of Joints", "Thickness", "Weld Type", "MOC", "Total Meter", "Results"],
      ["description", "beamId", "noOfJoints", "thickness", "weldType", "moc", "totalMeter", "results"],
      utReport.utTestResultRows ?? "[]",
    );

    // 7. Inspection Note
    {
      const text = (utReport.utInspectionNote ?? "").trim();
      if (y + 24 + 30 > pageMaxY) { addNewPage(); y = MARGIN; }
      y += 4;
      doc.font(FONT_BOLD).fontSize(10).fillColor("#000");
      doc.text("Inspection Note", MARGIN, y);
      y += 16;
      if (text) {
        doc.font(FONT_REGULAR).fontSize(8);
        const h = doc.heightOfString(text, { width: usableW });
        if (y + h > pageMaxY) { addNewPage(); y = MARGIN; }
        doc.text(text, MARGIN, y, { width: usableW });
        y += h + 4;
      } else {
        doc.font(FONT_REGULAR).fontSize(7).fillColor("#999");
        doc.text("—", MARGIN, y);
        y += 14;
      }
      doc.fillColor("#000");
    }
  } else if (reportType === "PIPELINE_WELD_SCAN") {
    // ─── WELD SCAN OBSERVATION TABLE ───
    // Reuses the same DPT observation infrastructure (the DptObservation
    // model and API are shared between DPT, MPT, and Weld Scan reports).
    startBodyOnFreshPage(160);

    const wsReport = report as any;

    // Parse custom columns (shared with DPT)
    let wsCustomCols: Array<{ id: string; name: string; unit: string }> = [];
    try {
      const cc = JSON.parse(wsReport.dptCustomColumns ?? "[]");
      if (Array.isArray(cc)) wsCustomCols = cc;
    } catch {}

    const headerH = 36;
    const rowH = 28;
    const slColW = 40;
    const descColW = 200;
    const weldColW = 80;
    const indicationSizeColW = 60;
    const resultColW = 60;
    const customColW = 60;
    const fixedW = slColW + descColW + weldColW + indicationSizeColW + resultColW;
    const customTotalW = wsCustomCols.length * customColW;
    const remarksW = Math.max(100, pageW - 2 * MARGIN - fixedW - customTotalW);
    const colWidths = [slColW, descColW, weldColW, indicationSizeColW, resultColW, ...wsCustomCols.map(() => customColW), remarksW];
    const colHeaders = ["Sl.\nNo", "Description", "Weld\nType", "Indication\nSize\n(mm)", "Result", ...wsCustomCols.map(c => c.name + (c.unit ? `\n(${c.unit})` : "")), "Remarks"];

    // Section heading
    if (y + 24 + headerH + rowH > pageMaxY) { addNewPage(); y = MARGIN; }
    y += 4;
    doc.font(FONT_BOLD).fontSize(11).fillColor("#155e63");
    doc.text("Weld Scan Inspection Results", MARGIN, y);
    doc.fillColor("#000");
    y += 16;

    if (y + headerH + rowH > pageMaxY) { addNewPage(); y = MARGIN; }
    drawDptTableHeader(doc, colHeaders, colWidths, y, pageW);
    y += headerH;

    const wsObs = wsReport.dptObservations ?? [];
    for (const obs of wsObs) {
      if (y + rowH > pageMaxY) {
        addNewPage();
        drawDptTableHeader(doc, colHeaders, colWidths, MARGIN, pageW);
        y = MARGIN + headerH;
      }
      drawDptRow(doc, obs, colHeaders, colWidths, y, wsCustomCols);
      y += rowH;
    }

    if (wsObs.length === 0) {
      doc.font(FONT_REGULAR).fontSize(8).fillColor("#666");
      doc.rect(MARGIN, y, pageW - 2 * MARGIN, rowH).stroke("#bbb");
      doc.text("No Weld Scan observations recorded.", MARGIN + 4, y + 9, { width: pageW - 2 * MARGIN - 8, align: "center" });
      doc.fillColor("#000");
      y += rowH;
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
    doc.text("Inspection Photographs", MARGIN, y);
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

    // Instrument Calibration
    if (equipCerts.length > 0) {
      // Start a new page for the certification section — ensures the
      // heading is never alone at the bottom of the measurement table page.
      addNewPage();
      // Draw "Certification" heading + sub-heading at the top of this page
      doc.font(FONT_BOLD).fontSize(14).fillColor("#000");
      doc.text("Certification", MARGIN, MARGIN, { width: usableW });
      doc.font(FONT_BOLD).fontSize(11);
      doc.text(`Instrument Calibration (${equipCerts.length})`, MARGIN, MARGIN + 20, { width: usableW });

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

    // Inspector Certificates — split into NDT Level 3 (optional) and NDT Level 2
    // NDT Level 3 certificates appear first, then NDT Level 2.
    const ndtLevel3Certs = personnelCerts.filter((c) => (c.title || "").includes("NDT Level 3"));
    const ndtLevel2Certs = personnelCerts.filter((c) => (c.title || "").includes("NDT Level 2"));
    const otherPersonnelCerts = personnelCerts.filter((c) => !ndtLevel3Certs.includes(c) && !ndtLevel2Certs.includes(c));
    // Combine in order: NDT Level 3 first, then NDT Level 2, then any others
    const orderedPersonnelCerts = [...ndtLevel3Certs, ...ndtLevel2Certs, ...otherPersonnelCerts];

    if (orderedPersonnelCerts.length > 0) {
      // Always start on a new page
      addNewPage();
      doc.font(FONT_BOLD).fontSize(11).fillColor("#000");
      doc.text(`Inspector Certificates (${orderedPersonnelCerts.length})`, MARGIN, MARGIN, { width: usableW });

      // First certificate on THIS page (below the heading)
      for (let i = 0; i < orderedPersonnelCerts.length; i++) {
        if (i > 0) addNewPage();
        if (i === 0) {
          const cert = orderedPersonnelCerts[i];
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
          await renderCertificateOnPage(orderedPersonnelCerts[i]);
        }
      }
    }

    // After certificates, set y to pageMaxY so the override note (if any)
    // starts on a new page rather than overlapping with the last certificate.
    // NOTE: This does NOT create a new page — it just sets y to the bottom
    // of the current page so that any subsequent content (like the override
    // note below) will trigger a page break via pdfkit's auto-flow.
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
  // 1. Fill the cell with white first — handles transparent PNGs and gives
  //    a consistent background regardless of the image's own background.
  doc.rect(x, y, photoW, photoH).fill("#ffffff");

  // 2. Embed the image (fitted, centered, aspect ratio preserved).
  //    The image is drawn inside a 2pt inset so the border stays crisp.
  if (photo.filePath && existsSync(photo.filePath)) {
    try {
      const imgBuf = readFileSync(photo.filePath);
      doc.image(imgBuf, x + 2, y + 2, {
        fit: [photoW - 4, photoH - 4],
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

  // 3. Draw the cell border ON TOP of the image so it's always visible
  //    (a clean dark grey border, consistent with the table styling).
  doc.rect(x, y, photoW, photoH).stroke(TABLE_OUTER_BORDER);

  // 4. Draw caption below the photo (within the cell's allocated caption
  //    space). Truncate to fit the cell width so long captions don't bleed
  //    into neighbouring cells.
  doc.font(fontRegular).fontSize(7).fillColor("#333");
  let caption = photo.caption || photo.fileName || "";
  const maxCaptionW = photoW;
  if (doc.widthOfString(caption) > maxCaptionW) {
    const charsToKeep = Math.floor(
      (maxCaptionW / Math.max(1, doc.widthOfString(caption))) * caption.length,
    );
    caption = caption.slice(0, Math.max(1, charsToKeep - 1)) + "…";
  }
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
// inspection observation rows. The header uses the same clean engineering
// palette as the thickness table (no heavy colour accents).

function drawVisualTableHeader(doc: Doc, columns: Column[], colWidths: number[], y: number, pageW: number) {
  const usable = pageW - 2 * MARGIN;
  const headerH = 36;
  doc.rect(MARGIN, y, usable, headerH).fill(TABLE_HEADER_BG);
  doc.rect(MARGIN, y, usable, headerH).stroke(TABLE_OUTER_BORDER);
  let x = MARGIN;
  doc.font(FONT_BOLD).fontSize(7.5).fillColor(TABLE_HEADER_FG);
  for (let i = 0; i < columns.length; i++) {
    const c = columns[i];
    const w = colWidths[i];
    if (i > 0) {
      doc.moveTo(x, y).lineTo(x, y + headerH).stroke(TABLE_INNER_BORDER);
    }
    const lines = c.header.split("\n");
    const lineH = 9;
    const totalH = lines.length * lineH;
    let ly = y + (headerH - totalH) / 2 + 1;
    for (const ln of lines) {
      doc.text(ln, x + 3, ly, { width: w - 6, align: "center" });
      ly += lineH;
    }
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
  doc.rect(MARGIN, y, usable, rowH).stroke(TABLE_OUTER_BORDER);
  let x = MARGIN;
  const cellPad = 4;
  doc.font(FONT_REGULAR).fontSize(7.5).fillColor("#000");

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
    if (i > 0) {
      doc.moveTo(x, y).lineTo(x, y + rowH).stroke(TABLE_INNER_BORDER);
    }
    const maxW = w - 2 * cellPad;
    // Truncate with ellipsis if too long
    const wrapped = doc.widthOfString(text) > maxW
      ? text.slice(0, Math.floor((maxW / Math.max(1, doc.widthOfString(text))) * text.length)) + "…"
      : text;
    doc.text(wrapped, x + cellPad, y + (rowH - 10) / 2, {
      width: maxW, align: "left",
    });
    x += w;
  }
  doc.fillColor("#000");
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
// Same clean engineering palette as the thickness and visual tables.
// The ONLY colour exception is the Result cell, which keeps its Accept
// (green tint) / Reject (red tint) colour coding because that conveys
// meaningful pass/fail information at a glance.

// Result cell colour coding (kept — meaningful pass/fail signal)
const DPT_RESULT_ACCEPT_BG = "#dcfce7";   // light green
const DPT_RESULT_ACCEPT_FG = "#166534";   // dark green
const DPT_RESULT_REJECT_BG = "#fee2e2";   // light red
const DPT_RESULT_REJECT_FG = "#991b1b";   // dark red

function drawDptTableHeader(doc: Doc, headers: string[], colWidths: number[], y: number, pageW: number) {
  const usable = pageW - 2 * MARGIN;
  const headerH = 36;
  doc.rect(MARGIN, y, usable, headerH).fill(TABLE_HEADER_BG);
  doc.rect(MARGIN, y, usable, headerH).stroke(TABLE_OUTER_BORDER);
  let x = MARGIN;
  doc.font(FONT_BOLD).fontSize(7.5).fillColor(TABLE_HEADER_FG);
  for (let i = 0; i < headers.length; i++) {
    const w = colWidths[i];
    if (i > 0) {
      doc.moveTo(x, y).lineTo(x, y + headerH).stroke(TABLE_INNER_BORDER);
    }
    const lines = headers[i].split("\n");
    const lineH = 9;
    const totalH = lines.length * lineH;
    let ly = y + (headerH - totalH) / 2 + 1;
    for (const ln of lines) {
      doc.text(ln, x + 3, ly, { width: w - 6, align: "center" });
      ly += lineH;
    }
    x += w;
  }
  doc.fillColor("#000");
}

function drawDptRow(
  doc: Doc,
  obs: { serialNo: number; description: string | null; weldType: string | null; indicationSize?: string | null; result: string; remarks: string | null; customColumnValues: string | null },
  headers: string[],
  colWidths: number[],
  y: number,
  customCols: Array<{ id: string; name: string; unit: string }>,
) {
  const rowH = 28;
  const usable = doc.page.width - 2 * MARGIN;
  // Outer row border
  doc.rect(MARGIN, y, usable, rowH).stroke(TABLE_OUTER_BORDER);
  let x = MARGIN;
  const cellPad = 4;
  doc.font(FONT_REGULAR).fontSize(8).fillColor("#000");

  // The Result column is now at index 4 (after Sl.No, Description, WeldType, IndicationSize).
  const resultIdx = 4;
  const systemColCount = 5; // Sl.No, Description, WeldType, IndicationSize, Result

  // First pass: fill the Result cell background
  for (let i = 0; i < headers.length; i++) {
    if (i === resultIdx) {
      const w = colWidths[i];
      if (obs.result === "Reject") {
        doc.rect(x, y, w, rowH).fill(DPT_RESULT_REJECT_BG);
      } else {
        doc.rect(x, y, w, rowH).fill(DPT_RESULT_ACCEPT_BG);
      }
    }
    x += colWidths[i];
  }

  // Second pass: draw text and internal column separators
  x = MARGIN;
  for (let i = 0; i < headers.length; i++) {
    const w = colWidths[i];
    let text = "";
    let isResult = false;
    if (i === 0) text = String(obs.serialNo);
    else if (i === 1) text = obs.description ?? "—";
    else if (i === 2) text = obs.weldType ?? "—";
    else if (i === 3) text = obs.indicationSize ?? "—";
    else if (i === resultIdx) {
      text = obs.result;
      isResult = true;
    } else if (i === headers.length - 1) {
      text = obs.remarks ?? "—";
    } else {
      // Custom column
      const colIdx = i - systemColCount;
      if (colIdx >= 0 && colIdx < customCols.length) {
        try {
          const vals = JSON.parse(obs.customColumnValues || "{}");
          text = vals[customCols[colIdx].id] ?? "—";
        } catch { text = "—"; }
      }
    }

    // Internal column separator
    if (i > 0) {
      doc.moveTo(x, y).lineTo(x, y + rowH).stroke(TABLE_INNER_BORDER);
    }

    // Set text colour for the result cell, black for everything else
    if (isResult) {
      doc.fillColor(obs.result === "Reject" ? DPT_RESULT_REJECT_FG : DPT_RESULT_ACCEPT_FG);
      doc.font(FONT_BOLD).fontSize(8);
    } else {
      doc.fillColor("#000");
      doc.font(FONT_REGULAR).fontSize(8);
    }

    const maxW = w - 2 * cellPad;
    const wrapped = doc.widthOfString(text) > maxW
      ? text.slice(0, Math.floor((maxW / Math.max(1, doc.widthOfString(text))) * text.length)) + "…"
      : text;
    doc.text(wrapped, x + cellPad, y + (rowH - 10) / 2, {
      width: maxW, align: i === 0 || i === resultIdx ? "center" : "left",
    });
    x += w;
  }

  // Re-stroke the outer border on top of the result-cell fill so it's crisp
  doc.rect(MARGIN, y, usable, rowH).stroke(TABLE_OUTER_BORDER);
  doc.fillColor("#000");
}

// ─── TABLE HELPERS ───
// Clean, professional engineering-report style:
//   • Light header background, dark header text
//   • Solid dark outer border around the whole table
//   • Medium grey internal column borders
//   • Medium grey row separators
//   • Consistent 0.5pt border weight
//   • Cell padding 3pt horizontal, 5pt vertical (centred text)

function drawTableHeader(doc: Doc, columns: Column[], colWidths: number[], y: number, pageW: number) {
  const usable = pageW - 2 * MARGIN;
  const headerH = 36;
  // Header background — very light grey fill
  doc.rect(MARGIN, y, usable, headerH).fill(TABLE_HEADER_BG);
  // Outer border around the entire header row
  doc.rect(MARGIN, y, usable, headerH).stroke(TABLE_OUTER_BORDER);
  // Internal column separators
  let x = MARGIN;
  doc.font(FONT_BOLD).fontSize(7.5).fillColor(TABLE_HEADER_FG);
  for (let i = 0; i < columns.length; i++) {
    const c = columns[i];
    const w = colWidths[i];
    if (i > 0) {
      // Vertical separator between columns
      doc.moveTo(x, y).lineTo(x, y + headerH).stroke(TABLE_INNER_BORDER);
    }
    if (c.vertical) {
      // Vertical (rotated) heading — used for the clock-position columns
      const lines = c.header.split("\n");
      const joined = lines.join(" ");
      doc.save();
      doc.translate(x + w / 2 + 3, y + headerH - 4);
      doc.rotate(-90);
      doc.text(joined, 0, 0, { width: headerH - 8, align: "left" });
      doc.restore();
    } else {
      const lines = c.header.split("\n");
      // Vertically centre multi-line headings inside the header row
      const lineH = 9;
      const totalH = lines.length * lineH;
      let ly = y + (headerH - totalH) / 2 + 1;
      for (const ln of lines) {
        doc.text(ln, x + 3, ly, { width: w - 6, align: "center" });
        ly += lineH;
      }
    }
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
  // Row background — alternating very-faint tint for readability
  // (the caller is responsible for tracking row index if alternation is
  // desired; here we just use plain white for the row body so the table
  // looks clean and uniform.)
  // Outer border around the row
  doc.rect(MARGIN, y, usable, rowH).stroke(TABLE_OUTER_BORDER);
  let x = MARGIN;
  const cellPad = 4;
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
    // Internal column separator (skip for the first column — its left edge
    // is the table's outer border, already drawn above).
    if (i > 0) {
      doc.moveTo(x, y).lineTo(x, y + rowH).stroke(TABLE_INNER_BORDER);
    }
    // Truncate with ellipsis if too long
    const maxW = w - 2 * cellPad;
    const wrapped = doc.widthOfString(text) > maxW
      ? text.slice(0, Math.floor((maxW / Math.max(1, doc.widthOfString(text))) * text.length)) + "…"
      : text;
    // Vertically centre the text inside the cell (row height 28pt, text ~10pt tall)
    doc.text(wrapped, x + cellPad, y + (rowH - 10) / 2, {
      width: maxW, align: c.key === "findings" ? "left" : "center",
    });
    x += w;
  }
  doc.fillColor("#000");
}
