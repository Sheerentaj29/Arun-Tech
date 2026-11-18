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
import { PassThrough } from "stream";
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
import {
  vutmMinOfSpots,
  vutmRowsFromReport,
  type VutmClockRow,
  type VutmDirectionRow,
  type VesselOrientation,
} from "@/lib/vutm-rows";
import {
  resolveClientLogo,
  CLIENT_LOGO_DIR,
} from "@/lib/client-logo-mapping";
import {
  parseThicknessTablesConfig,
  DEFAULT_TABLE_ID,
  type ThicknessTableConfig,
} from "@/lib/thickness-tables";
import { fmtMeasurement } from "@/lib/measurement-utils";

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
}

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
  | "VESSEL_DPT"
  | "VESSEL_MPT"
  | "VESSEL_WELD_SCAN"
  | "VESSEL_UTM"
  | "TANK_DPT"
  | "TANK_MPT"
  | "TANK_WELD_SCAN"
  | "TANK_UTM";

const REPORT_TYPE_TITLE: Record<ReportType, string> = {
  PIPELINE_THICKNESS: "PIPELINE THICKNESS MEASUREMENT REPORT",
  PIPELINE_VISUAL:    "PIPELINE VISUAL INSPECTION REPORT",
  PIPELINE_CONDITION: "PIPELINE CONDITION ASSESSMENT REPORT",
  PIPELINE_DPT:       "DYE PENETRANT TESTING REPORT",
  PIPELINE_MPT:       "MAGNETIC PARTICLE TESTING REPORT",
  PIPELINE_WELD_SCAN: "WELD SCAN REPORT",
  VESSEL_DPT:         "VESSEL DYE PENETRANT TESTING REPORT",
  VESSEL_MPT:         "VESSEL MAGNETIC PARTICLE TESTING REPORT",
  VESSEL_WELD_SCAN:   "VESSEL WELD SCAN REPORT",
  VESSEL_UTM:         "VESSEL UT THICKNESS MEASUREMENT REPORT",
  TANK_DPT:           "STORAGE TANK DYE PENETRANT TESTING REPORT",
  TANK_MPT:           "STORAGE TANK MAGNETIC PARTICLE TESTING REPORT",
  TANK_WELD_SCAN:     "STORAGE TANK WELD SCAN REPORT",
  TANK_UTM:           "STORAGE TANK UT THICKNESS MEASUREMENT REPORT",
};

function getReportType(raw: any): ReportType {
  const v = String(raw ?? "PIPELINE_THICKNESS");
  if (
    v === "PIPELINE_VISUAL" ||
    v === "PIPELINE_CONDITION" ||
    v === "PIPELINE_DPT" ||
    v === "PIPELINE_MPT" ||
    v === "PIPELINE_WELD_SCAN" ||
    v === "VESSEL_DPT" ||
    v === "VESSEL_MPT" ||
    v === "VESSEL_WELD_SCAN" ||
    v === "VESSEL_UTM" ||
    v === "TANK_DPT" ||
    v === "TANK_MPT" ||
    v === "TANK_WELD_SCAN" ||
    v === "TANK_UTM"
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
  "VESSEL_DPT",
  "VESSEL_MPT",
  "VESSEL_WELD_SCAN",
  "VESSEL_UTM",
  "TANK_DPT",
  "TANK_MPT",
  "TANK_WELD_SCAN",
  "TANK_UTM",
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
      indicationSize?: string | null;
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
    drawLogoInBox(serviceLogoPath, MARGIN, MARGIN, cLogoW, cLogoH, "ARUNTECH\nLogo");
    drawLogoInBox(clientLogoPath, pageW - MARGIN - cLogoW, MARGIN, cLogoW, cLogoH, "Client\nLogo");

    contentTopY = MARGIN + cLogoH + 6;  // content starts below the header band
    return contentTopY;
  };

  // ── TOC registration (fills `collected` during both passes) ──
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
  // Y where page content may start on the CURRENT page. Page 1 content
  // flows from cursorY after the full header; every page created by
  // addNewPage() draws the compact repeated header and moves this down.
  let contentTopY = MARGIN;

  // Logo box dimensions — shared by both header styles below so the
  // centered title block can stay clear of the two logo boxes. Portrait
  // narrows the boxes so the 16pt company name fits between them
  // (measured: Geist Bold 16pt company name ≈ 341pt; usableW ≈ 539pt →
  // center column at logoW 92 + 5pt pad = 345pt ≥ 341pt).
  const logoH = 70;
  const logoW = orientation === "landscape" ? 130 : 92;

  // ── PAGE-1 HEADER: one horizontal row, ALL report types ──
  //   [ArunTech logo (left)] [company name + report title (center)] [client logo (right)]
  // Company name 16 pt bold, report title 14 pt bold, both centre-aligned
  // and vertically aligned with the two logo boxes drawn by the LOGOS block
  // below on this same band. The centered text is confined to the gap
  // between the two logo boxes so it can never underlap them.
  // For PIPELINE_WELD_SCAN the Report No / Rev / Date / Status metadata line
  // is intentionally NOT drawn anywhere in the header — the fields remain in
  // the database and internal report records (approval / revision workflow
  // untouched). Other report types keep their subtitle line below the
  // header band.
  {
    const companyName = "ARUN TECH INDUSTRIAL SERVICES PVT LTD";
    const hPad = orientation === "landscape" ? 14 : 5;
    const centerX = MARGIN + logoW + hPad;
    const centerW = usableW - 2 * (logoW + hPad);
    doc.font(FONT_BOLD).fontSize(16).fillColor("#000");   // company name: 16 pt bold
    doc.text(companyName, centerX, cursorY + 6, { width: centerW, align: "center" });
    doc.font(FONT_BOLD).fontSize(14).fillColor("#000");   // report title: 14 pt bold
    doc.text(titleText, centerX, cursorY + 30, { width: centerW, align: "center" });
    doc.fillColor("#000");
    // cursorY intentionally unchanged — the LOGOS block below draws the two
    // logo boxes on this same horizontal band.
  }

  // ── SUBTITLE (Report No | Rev | Date Range | Status) ── (non-weld-scan only)
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

  // ── LOGOS (positioned strictly below subtitle) ──
  // Left: Aruntech service company logo — permanently fixed.
  // Right: selected client/company logo — changes based on client name.
  // Both logos preserve aspect ratio and are dynamically scaled to fill
  // the available container space (object-fit: contain behaviour).
  // The container uses 90% of available width and 85% of available height
  // for the image, with the image centered both horizontally and vertically.
  const serviceLogoPath = findServiceLogo();
  // Resolve the client logo via the SHARED, EXACT-match resolver.
  //   Priority:
  //     1. If the client has its own uploaded logo (logoPath) and the file
  //        exists, use that — it's their real brand asset.
  //     2. Else, look up the normalized-name → logo-file map (currently
  //        EMPTY — clean slate. Will be repopulated one entry per client
  //        after the user uploads the new uniquely-named logo images).
  //     3. Else, leave it as null — the placeholder text will be drawn
  //        instead. NEVER substitute another company's logo.
  let clientLogoPath = report.client.logoPath ?? null;
  if (!clientLogoPath || !existsSync(clientLogoPath)) {
    const mappedFile = resolveClientLogo(report.client.name);
    if (mappedFile) {
      const candidate = join(CLIENT_LOGO_DIR, mappedFile);
      if (existsSync(candidate)) {
        clientLogoPath = candidate;
      } else {
        clientLogoPath = null;
      }
    } else {
      clientLogoPath = null;
    }
  }

  // Helper: draw a logo inside a fixed container, preserving aspect ratio.
  // The image is scaled to fill as much of the container as possible while
  // keeping its original proportions (object-fit: contain).
  // Uses 92% of container width and 88% of container height as the
  // available image area, then centers the image within that area.
  const drawLogoInBox = (logoPath: string | null, boxX: number, boxY: number, boxW: number, boxH: number, fallbackText: string) => {
    // Draw the container border (light grey)
    doc.rect(boxX, boxY, boxW, boxH).stroke("#ddd");
    if (logoPath && existsSync(logoPath)) {
      try {
        const logoBuf = readFileSync(logoPath);
        // Get intrinsic image dimensions
        const dims = imageSize(logoBuf, doc);
        if (dims.w > 0 && dims.h > 0) {
          // Available area inside the container (92% width, 88% height)
          const availW = boxW * 0.92;
          const availH = boxH * 0.88;
          // Scale ratio: fit entirely within available area (object-fit: contain)
          const ratio = Math.min(availW / dims.w, availH / dims.h);
          const drawW = dims.w * ratio;
          const drawH = dims.h * ratio;
          // Center the image inside the container
          const drawX = boxX + (boxW - drawW) / 2;
          const drawY = boxY + (boxH - drawH) / 2;
          doc.image(logoBuf, drawX, drawY, { width: drawW, height: drawH });
        } else {
          // Fallback: use pdfkit's fit if dimensions can't be read
          doc.image(logoBuf, boxX + 4, boxY + 4, { fit: [boxW - 8, boxH - 8], align: "center", valign: "center" });
        }
      } catch {
        doc.fontSize(7).fillColor("#999").font(FONT_REGULAR);
        doc.text(fallbackText, boxX, boxY + (boxH - 14) / 2, { width: boxW, align: "center" });
      }
    } else {
      doc.fontSize(7).fillColor("#999").font(FONT_REGULAR);
      doc.text(fallbackText, boxX, boxY + (boxH - 14) / 2, { width: boxW, align: "center" });
    }
    doc.fillColor("#000");
  };

  // Left logo: Aruntech (service company) — permanently fixed
  drawLogoInBox(serviceLogoPath, MARGIN, cursorY, logoW, logoH, "ARUNTECH\nLogo");

  // Right logo: selected client's logo — dynamically determined
  const clientShort = report.client.name.length > 28
    ? report.client.name.slice(0, 28)
    : report.client.name;
  drawLogoInBox(clientLogoPath, pageW - MARGIN - logoW, cursorY, logoW, logoH, `${clientShort}\nClient Logo`);

  cursorY += logoH + 10;  // explicit 10pt gap below logos

  // ── SUBTITLE (Report No | Rev | Date Range | Status) ──
  // Non-weld-scan reports keep their metadata line directly below the
  // header band; weld-scan reports omit it (fields stay in the DB).
  if (reportType !== "PIPELINE_WELD_SCAN") {
    doc.font(FONT_REGULAR).fontSize(subtitleFontSize).fillColor("#333");
    const subtitleHeight = doc.heightOfString(subtitleText, { width: usableW, align: "center" });
    doc.text(subtitleText, MARGIN, cursorY, { width: usableW, align: "center" });
    cursorY += subtitleHeight + 10;  // explicit 10pt gap below subtitle
  }

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
    // All Vessel reports use equipment wording in the header grid.
    // Only VESSEL_UTM reports carry a Vessel Orientation (the UT
    // Thickness Measurement module is the only one that asks for one).
    ...(reportType === "VESSEL_DPT" || reportType === "VESSEL_MPT" || reportType === "VESSEL_UTM" || reportType === "VESSEL_WELD_SCAN"
      ? [
          ["Equipment / Vessel Description", report.pipelineDescription],
          ["Equipment Identification No.", report.pipelineIdentificationNumber],
          ["Report No.", report.reportNumber],
          // (Tank wording handled in the tank branch below)
          ...(reportType === "VESSEL_UTM"
            ? [["Vessel Orientation",
                (report as any).vesselOrientation === "VERTICAL" ? "Vertical Vessel"
                : "Horizontal Vessel"]] as Array<[string, string | null | undefined]>
            : []),
        ] as Array<[string, string | null | undefined]>
      : reportType === "TANK_DPT" || reportType === "TANK_MPT" || reportType === "TANK_WELD_SCAN" || reportType === "TANK_UTM"
      ? [
          ["Equipment / Tank Description", report.pipelineDescription],
          ["Equipment Identification No.", report.pipelineIdentificationNumber],
          ["Report No.", report.reportNumber],
        ] as Array<[string, string | null | undefined]>
      : [
            ["Pipeline Description", report.pipelineDescription],
            ["Pipeline Identification No.", report.pipelineIdentificationNumber],
            ["Report No.", report.reportNumber],
          ] as Array<[string, string | null | undefined]>),
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

  // ── TOC entry 1: General Information (the front page just rendered) ──
  tocMainEntry("General Information");

  // ═══════════════════════════════════════════════════════════════
  // TABLE OF CONTENTS — page 2, immediately after the front page.
  // Pass 1 draws only the heading (the page is reserved so every body
  // page number is already final); pass 2 fills in the collected section
  // entries with their exact page numbers.
  // ═══════════════════════════════════════════════════════════════
  const tocTopY = addNewPage();
  {
    let ty = tocTopY;
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

  // After the first page (header + sign-off) and the reserved TOC page,
  // start a new page for the remaining sections.
  // The TOC page (page 2) is RESERVED for the table of contents itself — the
  // report body always starts on a fresh page, whether or not findings content
  // exists. (Before the TOC existed, `y = 0` acted as a "no page yet" sentinel
  // that let startBodyOnFreshPage create the body page lazily; with the TOC
  // page as the current page that sentinel drew body content ON TOP of the TOC.)
  let y: number = addNewPage();

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
    headingFontSize = FONT_SIZE_SUB,
    bodyFontSize = FONT_SIZE_BODY,
    onPage?: () => void,
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
      y = addNewPage();
    }
    // TOC registration — AFTER the page-break decision, so the recorded
    // page number is the page the heading actually lands on.
    if (onPage) onPage();
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

  // Findings sections share one TOC main section ("Inspection Details");
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
        FONT_SIZE_SUB,
        FONT_SIZE_BODY,
        () => tocSubEntry(detailsMain(), "Summary Of Site Observations"),
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
        FONT_SIZE_SUB,
        FONT_SIZE_BODY,
        () => tocSubEntry(detailsMain(), "Results"),
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
        FONT_SIZE_SUB,
        FONT_SIZE_BODY,
        () => tocSubEntry(detailsMain(), "Conclusion"),
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
    let drawingsRegistered = false;
    const registerDrawingsToc = () => {
      if (!drawingsRegistered) {
        drawingsRegistered = true;
        tocMainEntry("Engineering Drawings");
      }
    };
    for (const drawing of linkedDrawings) {
      const ext = (drawing.fileExtension || "").toLowerCase();
      const filePath = drawing.filePath;

      if (!filePath || !existsSync(filePath)) {
        // Missing file — still emit a placeholder page so the structure
        // is visible
        addNewPage();
        registerDrawingsToc();
        drawDrawingPlaceholder(
          doc, drawing,
          `[File missing on disk: ${drawing.fileName}]\n\nThe drawing file could not be found.`,
          pageW, pageH, contentTopY,
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
            pageW, pageH, contentTopY,
          );
          continue;
        }
        // One output page per source PDF page
        for (let p = 0; p < pageBuffers.length; p++) {
          addNewPage();
          registerDrawingsToc();
          drawDrawingImagePage(doc, drawing, pageBuffers[p], p + 1, pageBuffers.length, pageW, pageH, contentTopY);
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
            pageW, pageH, contentTopY,
          );
          continue;
        }
        addNewPage();
        registerDrawingsToc();
        drawDrawingImagePage(doc, drawing, imgBuf, 1, 1, pageW, pageH, contentTopY);
      } else {
        // DWG / DXF / unsupported — show a placeholder
        addNewPage();
        registerDrawingsToc();
        drawDrawingPlaceholder(
          doc, drawing,
          `[${ext.toUpperCase()} File: ${drawing.fileName}]\n\n` +
          `Preview is not available for native CAD formats. The original file ` +
          `is preserved on disk and can be downloaded separately.`,
          pageW, pageH, contentTopY,
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
      y = addNewPage();
    } else if (includeDrawings && linkedDrawings.length > 0) {
      y = addNewPage();
    } else if (y + neededSpace > pageMaxY) {
      y = addNewPage();
    } else {
      y += 10;
    }
  };

  if (reportType === "PIPELINE_THICKNESS") {
    // ─── MULTI-TABLE MEASUREMENT RENDERER WITH AUTOMATIC INDEX NUMBERING ───
    //
    // Structure:
    //   7. Thickness Measurement                        ← parent heading
    //     7.1 – [Label of Table 1]                     ← index entry
    //     7.2 – [Label of Table 2]                     ← index entry
    //     7.3 – [Label of Table 3]                     ← index entry
    //
    //   7.1 – [Label of Table 1]                       ← table heading + data
    //   7.2 – [Label of Table 2]                       ← table heading + data
    //   7.3 – [Label of Table 3]                       ← table heading + data
    //
    // The "7" prefix is the fixed section number (THICKNESS_SECTION_NUMBER).
    // The ".N" suffix is dynamically derived from each table's position in
    // the ordered list — adding, deleting, or reordering tables automatically
    // renumbers everything. The Index list mirrors the table headings so the
    // reader sees a consistent table of contents.
    const tables: ThicknessTableConfig[] = parseThicknessTablesConfig(
      (report as PipelineInspection & { thicknessTablesConfig?: string | null }).thicknessTablesConfig ?? null,
    );

    const thicknessBranch = makeTocBranch("Thickness Measurement");

    // ── Draw the parent section heading: "<N>. Thickness Measurement" ──
    // (N is the dynamically assigned TOC section number)
    {
      const parentH = 24;
      // Ensure the parent heading + index list + at least one table header
      // + one row all fit; otherwise start on a fresh page.
      const indexRowH = 14;
      const indexBlockH = tables.length * indexRowH + 8;
      const neededH = parentH + indexBlockH + tableHeaderH + rowH2;
      if (y + neededH > pageMaxY) {
        addNewPage();
      }
      const thMain = thicknessBranch.main();
      currentTestBranch = thicknessBranch;
      doc.font(FONT_BOLD).fontSize(FONT_SIZE_MAIN).fillColor("#1f2937");
      doc.text(`${thMain}. Thickness Measurement`, MARGIN, y, { width: pageW - 2 * MARGIN, align: "left" });
      y += parentH;
      // Thin divider under the parent heading.
      doc.moveTo(MARGIN, y - 6).lineTo(pageW - MARGIN, y - 6).stroke("#374151");
      doc.fillColor("#000");
    }

    // ── Draw the Index / Table of Contents for this section ──
    // Lists every sub-table with its automatic number: "7.1 – Label", etc.
    {
      const indexRowH = 14;
      for (let i = 0; i < tables.length; i++) {
        const entry = `${thicknessBranch.main()}.${i + 1} – ${tables[i].label}`;
        if (y + indexRowH > pageMaxY) {
          addNewPage();
        }
        doc.font(FONT_REGULAR).fontSize(9).fillColor("#374151");
        // Indent the index entries to make them visually subordinate to
        // the parent heading.
        doc.text(entry, MARGIN + 12, y, { width: pageW - 2 * MARGIN - 12, align: "left" });
        y += indexRowH;
      }
      doc.fillColor("#000");
      // Gap after the index block, before the first table.
      y += 10;
    }

    // ── Render each table with its numbered heading ──
    for (let tIdx = 0; tIdx < tables.length; tIdx++) {
      const table = tables[tIdx];
      const tableNumberedHeading = `${thicknessBranch.main()}.${tIdx + 1} – ${table.label}`;
      // Partition measurements into THIS table.
      const tableMeasurements = measurements.filter(
        (m) => (m.tableGroup ?? DEFAULT_TABLE_ID) === table.id,
      );

      // Draw the numbered table heading: "7.N – [Label]"
      {
        // Make sure we have room for the heading + at least the table
        // header + one row before drawing.
        if (y + 18 + tableHeaderH + rowH2 > pageMaxY) {
          addNewPage();
        }
        tocSubEntry(thicknessBranch.main(), table.label);
        doc.font(FONT_BOLD).fontSize(FONT_SIZE_SUB).fillColor("#1f2937");
        doc.text(tableNumberedHeading, MARGIN, y, { width: pageW - 2 * MARGIN, align: "left" });
        y += 18;
        // Thin divider under the heading.
        doc.moveTo(MARGIN, y - 4).lineTo(pageW - MARGIN, y - 4).stroke("#9ca3af");
        doc.fillColor("#000");
      }

      // Always start the table on a fresh page if there isn't enough
      // room for the header + at least one row.
      startBodyOnFreshPage(tableHeaderH + rowH2);
      drawTableHeader(doc, allCols, colWidths, y, pageW);
      y += tableHeaderH;

      if (tableMeasurements.length === 0) {
        // Empty table — draw a single "no rows" row.
        if (y + rowH2 > pageMaxY) {
          addNewPage();
          drawTableHeader(doc, allCols, colWidths, contentTopY, pageW);
          y = contentTopY + tableHeaderH;
        }
        // Render a single merged cell with the empty message.
        doc.rect(MARGIN, y, pageW - 2 * MARGIN, rowH2).stroke(TABLE_OUTER_BORDER);
        doc.font(FONT_REGULAR).fontSize(8).fillColor("#6b7280");
        doc.text(
          `No measurement rows in ${tableNumberedHeading}.`,
          MARGIN + 4, y + (rowH2 - 10) / 2,
          { width: pageW - 2 * MARGIN - 8, align: "center" },
        );
        doc.fillColor("#000");
        y += rowH2;
      } else {
        for (const m of tableMeasurements) {
          if (y + rowH2 > pageMaxY) {
            addNewPage();
            // Re-emit the numbered heading + table header on the new page
            // so the reader knows which table the continuation belongs to.
            doc.font(FONT_BOLD).fontSize(FONT_SIZE_SUB).fillColor("#1f2937");
            doc.text(`${tableNumberedHeading} (continued)`, MARGIN, MARGIN, { width: pageW - 2 * MARGIN, align: "left" });
            doc.fillColor("#000");
            drawTableHeader(doc, allCols, colWidths, MARGIN + 16, pageW);
            y = contentTopY + 16 + tableHeaderH;
          }
          drawMeasurementRow(doc, m, allCols, colWidths, y, report, customCols);
          y += rowH2;
        }
      }

      // Small visual gap between consecutive tables.
      if (tIdx < tables.length - 1) {
        y += 14;
      }
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
    const visualBranch = makeTocBranch("Visual Inspection");
    currentTestBranch = visualBranch;
    startBodyOnFreshPage(tableHeaderH + rowH2);
    doc.font(FONT_BOLD).fontSize(FONT_SIZE_MAIN).fillColor("#1f2937");
    doc.text(`${visualBranch.main()}. Visual Inspection Observations`, MARGIN, y,
      { width: pageW - 2 * MARGIN, align: "left" });
    y += 28;
    tocSubEntry(visualBranch.main(), "Visual Observations Table");
    drawVisualTableHeader(doc, visCols, visColWidths, y, pageW);
    y += tableHeaderH;
    for (const o of visualObservations) {
      if (y + rowH2 > pageMaxY) {
        addNewPage();
        drawVisualTableHeader(doc, visCols, visColWidths, contentTopY, pageW);
        y = contentTopY + tableHeaderH;
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
    const conditionBranch = makeTocBranch("Condition Assessment");
    currentTestBranch = conditionBranch;
    startBodyOnFreshPage(80);
    y = drawConditionAssessment(doc, report as any, y, pageW, pageH, MARGIN, pageMaxY, addNewPage,
      () => conditionBranch.main());
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
    const pdptBranch = makeTocBranch("Dye Penetrant Testing");
    currentTestBranch = pdptBranch;

    // ─── 3. DYE PENETRANT PROCEDURE ───
    // Two-column table: left = field name (bold), right = value.
    // All values are typeable text from the form (or "—" if blank).
    // PAGE-BREAK RULE: ensure heading + first row fit together.
    {
      const procRowH_local = 18;
      if (y + 24 + procRowH_local > pageMaxY) { y = addNewPage(); }
      y += 6;
      doc.font(FONT_BOLD).fontSize(FONT_SIZE_SUB).fillColor("#3a1d4a");
      doc.text(`{pdptBranch.sub("Dye Penetrant Procedure") + " DYE PENETRANT PROCEDURE"}`, MARGIN, y);
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
        if (y + procRowH > pageMaxY) { y = addNewPage(); }
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
      if (y + 24 + consRowH_local > pageMaxY) { y = addNewPage(); }
      y += 4;
      doc.font(FONT_BOLD).fontSize(FONT_SIZE_SUB).fillColor("#3a1d4a");
      doc.text(`{pdptBranch.sub("Consumable Details") + " Consumable Details"}`, MARGIN, y);
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
        if (y + consRowH > pageMaxY) { y = addNewPage(); }
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
    if (y + 24 + dptHeaderH + dptRowH > pageMaxY) { y = addNewPage(); }
    y += 4;
    doc.font(FONT_BOLD).fontSize(FONT_SIZE_SUB).fillColor("#3a1d4a");
    doc.text(`{pdptBranch.sub("DPT Inspection Results") + " DPT Inspection Results"}`, MARGIN, y);
    doc.fillColor("#000");
    y += 16;

    // Draw header
    if (y + dptHeaderH + dptRowH > pageMaxY) { y = addNewPage(); }
    drawDptTableHeader(doc, dptColHeaders, dptColWidths, y, pageW);
    y += dptHeaderH;

    // Draw rows
    for (const obs of dptObs) {
      if (y + dptRowH > pageMaxY) {
        addNewPage();
        drawDptTableHeader(doc, dptColHeaders, dptColWidths, contentTopY, pageW);
        y = contentTopY + dptHeaderH;
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
  } else if (reportType === "VESSEL_DPT") {
    // ─── VESSEL DPT REPORT BODY ───
    // Renders, in this order:
    //   1. "DYE PENETRANT TESTING PARAMETERS" — two-column table with
    //      Vessel Orientation + Date of Examination + 16 typeable fields.
    //   2. "Consumable Details" — 3-row grid (Solvent / Penetrant /
    //      Developer) × Make / Product / Batch Number / Expiry Date.
    //   3. "Dye Penetrant Testing Details" — table with Part Details |
    //      Type of Weld | Size of Indication Approx. (mm) |
    //      Observation & Result.
    //   4. Photographs are handled by the shared photo-gallery section
    //      below ("Inspection Photographs").
    startBodyOnFreshPage(160);

    const vdptReport = report as any;
    const vdptBranch = makeTocBranch("Dye Penetrant Testing");
    currentTestBranch = vdptBranch;

    // ─── 1. DYE PENETRANT TESTING PARAMETERS ───
    {
      const procRowH = 18;
      if (y + 24 + procRowH > pageMaxY) { y = addNewPage(); }
      y += 6;
      doc.font(FONT_BOLD).fontSize(FONT_SIZE_SUB).fillColor("#3a1d4a");
      doc.text(`{vdptBranch.sub("Dye Penetrant Testing Parameters") + " Dye Penetrant Testing Parameters"}`, MARGIN, y);
      doc.fillColor("#000");
      y += 18;

      const procedureRows: Array<[string, string | null]> = [
        ["Date of Examination", vdptReport.dptDateOfExamination
          ? new Date(vdptReport.dptDateOfExamination).toISOString().slice(0, 10)
          : null],
        ["Testing Standard", vdptReport.dptTestingStandard],
        ["Acceptance Criteria", vdptReport.dptAcceptanceCriteria],
        ["Surface Preparation", vdptReport.dptSurfacePreparation],
        ["Surface Temperature", vdptReport.dptSurfaceTemperature],
        ["Penetrant Type", vdptReport.dptPenetrantType],
        ["Penetrant Process", vdptReport.dptPenetrantProcess],
        ["Method of Pre-cleaning", vdptReport.dptMethodOfPreCleaning],
        ["Drying Time After Pre-cleaning", vdptReport.dptDryingTimeAfterPreCleaning],
        ["Method of Applying Penetrant", vdptReport.dptMethodOfApplyingPenetrant],
        ["Penetrating Time", vdptReport.dptPenetratingTime],
        ["Method of Removing Excess Penetrant", vdptReport.dptMethodOfRemovingExcessPenetrant],
        ["Method of Applying Developer", vdptReport.dptMethodOfApplyingDeveloper],
        ["Development Time", vdptReport.dptDevelopmentTime],
        ["Interpretation Time", vdptReport.dptInterpretationTime],
        ["Lighting Equipment", vdptReport.dptLightingEquipment],
        ["Post Cleaning", vdptReport.dptPostCleaning],
      ];

      const procLabelW = (pageW - 2 * MARGIN) * 0.38;
      const procValueW = (pageW - 2 * MARGIN) - procLabelW;
      const procUsableW = pageW - 2 * MARGIN;

      for (const [label, value] of procedureRows) {
        if (y + procRowH > pageMaxY) { y = addNewPage(); }
        doc.rect(MARGIN, y, procLabelW, procRowH).fill("#f3e8fb");
        doc.rect(MARGIN + procLabelW, y, procValueW, procRowH).fill("#ffffff");
        doc.rect(MARGIN, y, procUsableW, procRowH).stroke(TABLE_OUTER_BORDER);
        doc.moveTo(MARGIN + procLabelW, y).lineTo(MARGIN + procLabelW, y + procRowH).stroke(TABLE_INNER_BORDER);
        doc.font(FONT_BOLD).fontSize(8.5).fillColor("#000");
        doc.text(label, MARGIN + 4, y + 5, { width: procLabelW - 8 });
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

    // ─── 2. CONSUMABLE DETAILS ───
    // 3 rows (Solvent / Penetrant / Developer) × 5 columns
    // (Consumable | Make | Product / Description | Batch Number | Expiry Date).
    {
      // drawDptTableHeader draws a fixed 36pt-tall header — advance y by
      // the same amount so the first data row never overlaps the header.
      const consHeaderH = 36;
      const consRowH = 18;
      if (y + 24 + consHeaderH + consRowH > pageMaxY) { y = addNewPage(); }
      y += 4;
      doc.font(FONT_BOLD).fontSize(FONT_SIZE_SUB).fillColor("#3a1d4a");
      doc.text(`{vdptBranch.sub("Consumable Details") + " Consumable Details"}`, MARGIN, y);
      doc.fillColor("#000");
      y += 18;

      const consUsable = pageW - 2 * MARGIN;
      const consColWidths = orientation === "landscape"
        ? [70, 130, 210, 130, Math.max(100, consUsable - 70 - 130 - 210 - 130)]
        : [55, 90, 150, 90, Math.max(80, consUsable - 55 - 90 - 150 - 90)];
      const consHeaders = ["Consumable", "Make", "Product / Description", "Batch Number", "Expiry Date"];

      drawDptTableHeader(doc, consHeaders, consColWidths, y, pageW);
      y += consHeaderH;

      const consumableRows: Array<[string, string | null, string | null, string | null, string | null]> = [
        ["Solvent", vdptReport.vdptSolventMake, vdptReport.vdptSolventProduct, vdptReport.vdptSolventBatchNo, vdptReport.vdptSolventExpiry],
        ["Penetrant", vdptReport.vdptPenetrantMake, vdptReport.vdptPenetrantProduct, vdptReport.vdptPenetrantBatchNo, vdptReport.vdptPenetrantExpiry],
        ["Developer", vdptReport.vdptDeveloperMake, vdptReport.vdptDeveloperProduct, vdptReport.vdptDeveloperBatchNo, vdptReport.vdptDeveloperExpiry],
      ];

      for (const row of consumableRows) {
        if (y + consRowH > pageMaxY) {
          addNewPage();
          drawDptTableHeader(doc, consHeaders, consColWidths, contentTopY, pageW);
          y = contentTopY + consHeaderH;
        }
        // Draw one bordered row of cells
        doc.rect(MARGIN, y, consUsable, consRowH).stroke(TABLE_OUTER_BORDER);
        let cx = MARGIN;
        for (let i = 0; i < consHeaders.length; i++) {
          const w = consColWidths[i];
          if (i > 0) {
            doc.moveTo(cx, y).lineTo(cx, y + consRowH).stroke(TABLE_INNER_BORDER);
          }
          doc.font(i === 0 ? FONT_BOLD : FONT_REGULAR).fontSize(8).fillColor("#000");
          const cellText = (row[i] && String(row[i]).trim()) ? String(row[i]).trim() : (i === 0 ? "" : "—");
          const maxW = w - 8;
          let displayText = cellText;
          if (doc.widthOfString(displayText) > maxW) {
            const charsToKeep = Math.floor((maxW / Math.max(1, doc.widthOfString(displayText))) * displayText.length);
            displayText = displayText.slice(0, Math.max(1, charsToKeep - 1)) + "…";
          }
          doc.text(displayText, cx + 4, y + 5, { width: maxW, align: i === 0 ? "left" : "left" });
          cx += w;
        }
        doc.fillColor("#000");
        y += consRowH;
      }
      y += 10;
    }

    // ─── 3. DYE PENETRANT TESTING DETAILS ───
    // Table: Sl. No | Part Details | Type of Weld | Size of Indication
    // Approx. (mm) | Observation & Result. Rows come from the shared
    // DptObservation storage (description → Part Details, weldType →
    // Type of Weld, indicationSize → Size of Indication, remarks →
    // Observation & Result).
    {
      const vdptObs = vdptReport.dptObservations ?? report.dptObservations ?? [];
      const vHeaderH = 36;
      const vRowH = 28;
      const vUsable = pageW - 2 * MARGIN;
      const vSlW = 36;
      const vPartW = orientation === "landscape" ? 170 : 120;
      const vWeldW = orientation === "landscape" ? 90 : 70;
      const vSizeW = orientation === "landscape" ? 90 : 80;
      const vObsW = Math.max(100, vUsable - vSlW - vPartW - vWeldW - vSizeW);
      const vColWidths = [vSlW, vPartW, vWeldW, vSizeW, vObsW];
      const vHeaders = ["Sl.\nNo", "Part Details", "Type of\nWeld", "Size of Indication\nApprox. (mm)", "Observation & Result"];

      if (y + 24 + vHeaderH + vRowH > pageMaxY) { y = addNewPage(); }
      y += 4;
      doc.font(FONT_BOLD).fontSize(FONT_SIZE_SUB).fillColor("#3a1d4a");
      doc.text(`{vdptBranch.sub("Dye Penetrant Testing Details") + " Dye Penetrant Testing Details"}`, MARGIN, y);
      doc.fillColor("#000");
      y += 16;

      if (y + vHeaderH + vRowH > pageMaxY) { y = addNewPage(); }
      drawDptTableHeader(doc, vHeaders, vColWidths, y, pageW);
      y += vHeaderH;

      for (const obs of vdptObs) {
        if (y + vRowH > pageMaxY) {
          addNewPage();
          drawDptTableHeader(doc, vHeaders, vColWidths, contentTopY, pageW);
          y = contentTopY + vHeaderH;
        }
        // Bordered row with 5 cells
        doc.rect(MARGIN, y, vUsable, vRowH).stroke(TABLE_OUTER_BORDER);
        const cells: string[] = [
          String(obs.serialNo ?? ""),
          obs.description ?? "—",
          obs.weldType ?? "—",
          (obs as any).indicationSize ?? "—",
          obs.remarks ?? "—",
        ];
        let cx = MARGIN;
        for (let i = 0; i < cells.length; i++) {
          const w = vColWidths[i];
          if (i > 0) {
            doc.moveTo(cx, y).lineTo(cx, y + vRowH).stroke(TABLE_INNER_BORDER);
          }
          doc.font(FONT_REGULAR).fontSize(8).fillColor("#000");
          const maxW = w - 8;
          let displayText = cells[i] ?? "—";
          if (doc.widthOfString(displayText) > maxW) {
            const charsToKeep = Math.floor((maxW / Math.max(1, doc.widthOfString(displayText))) * displayText.length);
            displayText = displayText.slice(0, Math.max(1, charsToKeep - 1)) + "…";
          }
          doc.text(displayText, cx + 4, y + 5, { width: maxW, align: i === 0 ? "center" : "left" });
          cx += w;
        }
        doc.fillColor("#000");
        y += vRowH;
      }

      if (vdptObs.length === 0) {
        doc.font(FONT_REGULAR).fontSize(8).fillColor("#666");
        doc.rect(MARGIN, y, vUsable, vRowH).stroke("#bbb");
        doc.text("No DPT details recorded.", MARGIN + 4, y + 9, { width: vUsable - 8, align: "center" });
        doc.fillColor("#000");
        y += vRowH;
      }
    }
  } else if (reportType === "VESSEL_MPT") {
    // ─── VESSEL MPT REPORT BODY ───
    // Renders, in this order:
    //   1. "Magnetic Particle Testing Parameters" — two-column table with
    //      Vessel Orientation line + Date of Examination + 18 typeable
    //      procedure fields (all editable in the form, nothing hardcoded).
    //   2. "Consumable Details" — 2-row grid (White Contrast / Wet Particle
    //      Iron Ink) × Make / Product / Lot Number / Expiry Date.
    //   3. "Magnetic Particle Testing Details" — table with Part Details |
    //      ID | Weld Dimension | Size of Indication Approx. (mm) |
    //      Observation & Result. Rows come from the vmptRows JSON column.
    //   4. Photographs are handled by the shared photo-gallery section
    //      below ("Inspection Photographs").
    startBodyOnFreshPage(160);

    const vmptReport = report as any;
    const vmptBranch = makeTocBranch("Magnetic Particle Testing");
    currentTestBranch = vmptBranch;

    // ─── 1. MAGNETIC PARTICLE TESTING PARAMETERS ───
    {
      const procRowH = 18;
      if (y + 24 + procRowH > pageMaxY) { y = addNewPage(); }
      y += 6;
      doc.font(FONT_BOLD).fontSize(FONT_SIZE_SUB).fillColor("#7c2d12");
      doc.text(`{vmptBranch.sub("Magnetic Particle Testing Parameters") + " Magnetic Particle Testing Parameters"}`, MARGIN, y);
      doc.fillColor("#000");
      y += 18;

      const procedureRows: Array<[string, string | null]> = [
        ["Date of Examination", vmptReport.mptDateOfExamination
          ? new Date(vmptReport.mptDateOfExamination).toISOString().slice(0, 10)
          : null],
        ["Testing Standard", vmptReport.mptTestingStandard],
        ["Acceptance Criteria", vmptReport.mptAcceptanceCriteria],
        ["Surface Preparation", vmptReport.mptSurfacePreparation],
        ["Surface Temperature", vmptReport.mptSurfaceTemperature],
        ["Type of Instrument / Sl. No.", vmptReport.mptInstrumentSerialNo],
        ["MPT Method", vmptReport.mptMethod],
        ["Type of Current", vmptReport.mptTypeOfCurrent],
        ["AC Yoke Lifting Capacity", vmptReport.mptAcYokeLiftingCapacity],
        ["Contrast Medium", vmptReport.mptContrastMedium],
        ["Method of Pre-cleaning", vmptReport.mptMethodOfPreCleaning],
        ["Method of Applying White Contrast", vmptReport.mptMethodOfApplyingWhiteContrast],
        ["AC Yoke Pole Spacing", vmptReport.mptAcYokePoleSpacing],
        ["Magnetic Medium", vmptReport.mptMagneticMedium],
        ["Method of Applying Magnetic Medium", vmptReport.mptMethodOfApplyingMagneticMedium],
        ["Development Time", vmptReport.mptDevelopmentTime],
        ["Interpretation Time", vmptReport.mptInterpretationTime],
        ["Lighting Equipment", vmptReport.mptLightingEquipment],
        ["Post Cleaning", vmptReport.mptPostCleaning],
      ];

      const procLabelW = (pageW - 2 * MARGIN) * 0.38;
      const procValueW = (pageW - 2 * MARGIN) - procLabelW;
      const procUsableW = pageW - 2 * MARGIN;

      for (const [label, value] of procedureRows) {
        if (y + procRowH > pageMaxY) { y = addNewPage(); }
        doc.rect(MARGIN, y, procLabelW, procRowH).fill("#fff7ed");
        doc.rect(MARGIN + procLabelW, y, procValueW, procRowH).fill("#ffffff");
        doc.rect(MARGIN, y, procUsableW, procRowH).stroke(TABLE_OUTER_BORDER);
        doc.moveTo(MARGIN + procLabelW, y).lineTo(MARGIN + procLabelW, y + procRowH).stroke(TABLE_INNER_BORDER);
        doc.font(FONT_BOLD).fontSize(8.5).fillColor("#000");
        doc.text(label, MARGIN + 4, y + 5, { width: procLabelW - 8 });
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

    // ─── 2. CONSUMABLE DETAILS ───
    // 2 rows (White Contrast / Wet Particle Iron Ink) × 5 columns
    // (Consumable | Make | Product / Description | Lot Number | Expiry Date).
    {
      // drawDptTableHeader draws a fixed 36pt-tall header — advance y by
      // the same amount so the first data row never overlaps the header.
      const consHeaderH = 36;
      const consRowH = 18;
      if (y + 24 + consHeaderH + consRowH > pageMaxY) { y = addNewPage(); }
      y += 4;
      doc.font(FONT_BOLD).fontSize(FONT_SIZE_SUB).fillColor("#7c2d12");
      doc.text(`{vmptBranch.sub("Consumable Details") + " Consumable Details"}`, MARGIN, y);
      doc.fillColor("#000");
      y += 18;

      const consUsable = pageW - 2 * MARGIN;
      const consColWidths = orientation === "landscape"
        ? [100, 120, 200, 120, Math.max(100, consUsable - 100 - 120 - 200 - 120)]
        : [75, 85, 140, 85, Math.max(80, consUsable - 75 - 85 - 140 - 85)];
      const consHeaders = ["Consumable", "Make", "Product / Description", "Lot Number", "Expiry Date"];

      drawDptTableHeader(doc, consHeaders, consColWidths, y, pageW);
      y += consHeaderH;

      const consumableRows: Array<[string, string | null, string | null, string | null, string | null]> = [
        ["White Contrast", vmptReport.vmptWhiteContrastMake, vmptReport.vmptWhiteContrastProduct, vmptReport.vmptWhiteContrastLotNo, vmptReport.vmptWhiteContrastExpiry],
        ["Wet Particle Iron Ink", vmptReport.vmptInkMake, vmptReport.vmptInkProduct, vmptReport.vmptInkLotNo, vmptReport.vmptInkExpiry],
      ];

      for (const row of consumableRows) {
        if (y + consRowH > pageMaxY) {
          addNewPage();
          drawDptTableHeader(doc, consHeaders, consColWidths, contentTopY, pageW);
          y = contentTopY + consHeaderH;
        }
        // Draw one bordered row of cells
        doc.rect(MARGIN, y, consUsable, consRowH).stroke(TABLE_OUTER_BORDER);
        let cx = MARGIN;
        for (let i = 0; i < consHeaders.length; i++) {
          const w = consColWidths[i];
          if (i > 0) {
            doc.moveTo(cx, y).lineTo(cx, y + consRowH).stroke(TABLE_INNER_BORDER);
          }
          doc.font(i === 0 ? FONT_BOLD : FONT_REGULAR).fontSize(8).fillColor("#000");
          const cellText = (row[i] && String(row[i]).trim()) ? String(row[i]).trim() : (i === 0 ? "" : "—");
          const maxW = w - 8;
          let displayText = cellText;
          if (doc.widthOfString(displayText) > maxW) {
            const charsToKeep = Math.floor((maxW / Math.max(1, doc.widthOfString(displayText))) * displayText.length);
            displayText = displayText.slice(0, Math.max(1, charsToKeep - 1)) + "…";
          }
          doc.text(displayText, cx + 4, y + 5, { width: maxW, align: "left" });
          cx += w;
        }
        doc.fillColor("#000");
        y += consRowH;
      }
      y += 10;
    }

    // ─── 3. MAGNETIC PARTICLE TESTING DETAILS ───
    // Table: Sl. No | Part Details | ID | Weld Dimension | Size of
    // Indication Approx. (mm) | Observation & Result. Rows come from the
    // vmptRows JSON column stored on the report.
    {
      let vmptObs: Array<Record<string, string>> = [];
      try {
        const parsed = JSON.parse(vmptReport.vmptRows ?? "[]");
        if (Array.isArray(parsed)) vmptObs = parsed;
      } catch {}
      const vHeaderH = 36;
      const vRowH = 28;
      const vUsable = pageW - 2 * MARGIN;
      const vSlW = 36;
      const vPartW = orientation === "landscape" ? 150 : 110;
      const vIdW = orientation === "landscape" ? 70 : 55;
      const vDimW = orientation === "landscape" ? 100 : 80;
      const vSizeW = orientation === "landscape" ? 85 : 75;
      const vObsW = Math.max(100, vUsable - vSlW - vPartW - vIdW - vDimW - vSizeW);
      const vColWidths = [vSlW, vPartW, vIdW, vDimW, vSizeW, vObsW];
      const vHeaders = ["Sl.\nNo", "Part Details", "ID", "Weld\nDimension", "Size of Indication\nApprox. (mm)", "Observation & Result"];

      if (y + 24 + vHeaderH + vRowH > pageMaxY) { y = addNewPage(); }
      y += 4;
      doc.font(FONT_BOLD).fontSize(FONT_SIZE_SUB).fillColor("#7c2d12");
      doc.text(`{vmptBranch.sub("Magnetic Particle Testing Details") + " Magnetic Particle Testing Details"}`, MARGIN, y);
      doc.fillColor("#000");
      y += 16;

      if (y + vHeaderH + vRowH > pageMaxY) { y = addNewPage(); }
      drawDptTableHeader(doc, vHeaders, vColWidths, y, pageW);
      y += vHeaderH;

      for (let ri = 0; ri < vmptObs.length; ri++) {
        const obs = vmptObs[ri];
        if (y + vRowH > pageMaxY) {
          addNewPage();
          drawDptTableHeader(doc, vHeaders, vColWidths, contentTopY, pageW);
          y = contentTopY + vHeaderH;
        }
        // Bordered row with 6 cells
        doc.rect(MARGIN, y, vUsable, vRowH).stroke(TABLE_OUTER_BORDER);
        const cells: string[] = [
          String(ri + 1),
          obs.partDetails ?? "—",
          obs.idNo ?? "—",
          obs.weldDimension ?? "—",
          obs.indicationSize ?? "—",
          obs.observationResult ?? "—",
        ];
        let cx = MARGIN;
        for (let i = 0; i < cells.length; i++) {
          const w = vColWidths[i];
          if (i > 0) {
            doc.moveTo(cx, y).lineTo(cx, y + vRowH).stroke(TABLE_INNER_BORDER);
          }
          doc.font(FONT_REGULAR).fontSize(8).fillColor("#000");
          const maxW = w - 8;
          let displayText = cells[i] ?? "—";
          if (doc.widthOfString(displayText) > maxW) {
            const charsToKeep = Math.floor((maxW / Math.max(1, doc.widthOfString(displayText))) * displayText.length);
            displayText = displayText.slice(0, Math.max(1, charsToKeep - 1)) + "…";
          }
          doc.text(displayText, cx + 4, y + 5, { width: maxW, align: i === 0 ? "center" : "left" });
          cx += w;
        }
        doc.fillColor("#000");
        y += vRowH;
      }

      if (vmptObs.length === 0) {
        doc.font(FONT_REGULAR).fontSize(8).fillColor("#666");
        doc.rect(MARGIN, y, vUsable, vRowH).stroke("#bbb");
        doc.text("No MPT details recorded.", MARGIN + 4, y + 9, { width: vUsable - 8, align: "center" });
        doc.fillColor("#000");
        y += vRowH;
      }
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
    const pmptBranch = makeTocBranch("Magnetic Particle Testing");
    currentTestBranch = pmptBranch;

    // ─── 5.1 MAGNETIC PARTICLE TESTING PARAMETERS ───
    {
      const procRowH = 18;
      if (y + 24 + procRowH > pageMaxY) { y = addNewPage(); }
      y += 6;
      doc.font(FONT_BOLD).fontSize(FONT_SIZE_SUB).fillColor("#7c2d12");
      doc.text(`{pmptBranch.sub("Magnetic Particle Testing Parameters") + " Magnetic Particle Testing Parameters"}`, MARGIN, y);
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
        if (y + procRowH > pageMaxY) { y = addNewPage(); }
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
      if (y + 24 + consRowH > pageMaxY) { y = addNewPage(); }
      y += 4;
      doc.font(FONT_BOLD).fontSize(FONT_SIZE_SUB).fillColor("#7c2d12");
      doc.text(`{pmptBranch.sub("Consumable Details") + " Consumable Details"}`, MARGIN, y);
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
        if (y + consRowH > pageMaxY) { y = addNewPage(); }
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
      if (y + 24 + headerH + rowH > pageMaxY) { y = addNewPage(); }
      y += 4;
      doc.font(FONT_BOLD).fontSize(FONT_SIZE_SUB).fillColor("#7c2d12");
      doc.text(`{pmptBranch.sub("MPT Inspection Results") + " MPT Inspection Results"}`, MARGIN, y);
      doc.fillColor("#000");
      y += 16;

      if (y + headerH + rowH > pageMaxY) { y = addNewPage(); }
      drawDptTableHeader(doc, colHeaders, colWidths, y, pageW);
      y += headerH;

      for (const obs of mptObs) {
        if (y + rowH > pageMaxY) {
          addNewPage();
          drawDptTableHeader(doc, colHeaders, colWidths, contentTopY, pageW);
          y = contentTopY + headerH;
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
  } else if (reportType === "PIPELINE_WELD_SCAN") {
    // ─── WELD SCAN REPORT BODY ───
    // Renders all 4 sections: Instrument Details, Test Probe Details,
    // Scanning Details, Test Results.
    startBodyOnFreshPage(200);

    const wsReport = report as any;
    const pwsBranch = makeTocBranch("Weld Scan");
    currentTestBranch = pwsBranch;
    const usableW = pageW - 2 * MARGIN;

    // Helper: draw a multi-column data table from JSON rows
    const drawWsMultiColTable = (heading: string, headers: string[], rowFields: string[], jsonStr: string, dateFields: string[] = [], tocBranch?: { sub: (t: string) => string }, colRatios?: number[]) => {
      const rowH = 24;
      const colCount = headers.length;
      const colW = colRatios
        ? usableW / colRatios.reduce((a, b) => a + b, 0)
        : usableW / colCount;
      const colWidths = colRatios
        ? colRatios.map((r) => (usableW / colRatios.reduce((a, b) => a + b, 0)) * r)
        : headers.map(() => colW);
      // Header height adapts to the TALLEST wrapped heading so multi-line
      // headings (e.g. "Skip Distance (SD) (mm)") never overlap the border
      // or the first data row. Headings wrap naturally within their column.
      doc.font(FONT_BOLD).fontSize(6);
      let maxHeadH = 0;
      for (let i = 0; i < headers.length; i++) {
        const hh = doc.heightOfString(headers[i], { width: colWidths[i] - 6 });
        if (hh > maxHeadH) maxHeadH = hh;
      }
      const headerH = Math.max(30, Math.ceil(maxHeadH) + 12);
      // Only render if there are rows
      let dataRows: any[] = [];
      try { const parsed = JSON.parse(jsonStr || "[]"); if (Array.isArray(parsed)) dataRows = parsed; } catch {}
      if (dataRows.length === 0) return; // Skip empty tables

      if (y + 24 + headerH + rowH > pageMaxY) { y = addNewPage(); }
      y += 6;
      const headingLabel = tocBranch ? `${tocBranch.sub(heading)} ${heading}` : heading;
      doc.font(FONT_BOLD).fontSize(FONT_SIZE_SUB).fillColor("#000");
      doc.text(headingLabel, MARGIN, y);
      doc.fillColor("#000");
      y += 20;

      const drawHeader = (headerY: number) => {
        doc.rect(MARGIN, headerY, usableW, headerH).fill(TABLE_HEADER_BG);
        doc.rect(MARGIN, headerY, usableW, headerH).stroke(TABLE_OUTER_BORDER);
        let x = MARGIN;
        doc.font(FONT_BOLD).fontSize(6).fillColor(TABLE_HEADER_FG);
        for (let i = 0; i < headers.length; i++) {
          if (i > 0) doc.moveTo(x, headerY).lineTo(x, headerY + headerH).stroke(TABLE_INNER_BORDER);
          // Wrap within the column and center the text block vertically
          const th = doc.heightOfString(headers[i], { width: colWidths[i] - 6 });
          doc.text(headers[i], x + 3, headerY + Math.max(3, (headerH - th) / 2), { width: colWidths[i] - 6, align: "center" });
          x += colWidths[i];
        }
        doc.fillColor("#000");
      };
      drawHeader(y);
      y += headerH;

      for (let r = 0; r < dataRows.length; r++) {
        if (y + rowH > pageMaxY) {
          y = addNewPage();
          drawHeader(y);
          y += headerH;
        }
        let x = MARGIN;
        for (let i = 0; i < headers.length; i++) {
          if (i > 0) doc.moveTo(x, y).lineTo(x, y + rowH).stroke(TABLE_INNER_BORDER);
          const colW = colWidths[i];
          let val = "";
          if (i === 0 && heading.includes("Test Results")) {
            val = String(r + 1);
          } else {
            const fieldIdx = heading.includes("Test Results") ? i - 1 : i;
            const field = rowFields[fieldIdx];
            val = dataRows[r][field] ?? "";
            if (dateFields.includes(field) && val) {
              try { val = new Date(val).toISOString().slice(0, 10); } catch {}
            }
          }
          doc.rect(x, y, colW, rowH).stroke(TABLE_INNER_BORDER);
          doc.font(FONT_REGULAR).fontSize(6.5).fillColor("#000");
          let disp = String(val);
          if (disp && doc.widthOfString(disp) > colW - 4) {
            const c = Math.floor((colW - 4) / Math.max(1, doc.widthOfString(disp)) * disp.length);
            disp = disp.slice(0, Math.max(1, c - 1)) + "…";
          }
          doc.text(disp, x + 2, y + 8, { width: colW - 4, align: "center" });
          x += colW;
        }
        doc.rect(MARGIN, y, usableW, rowH).stroke(TABLE_OUTER_BORDER);
        y += rowH;
      }
      y += 6;
    };

    // Helper: draw the Scanning Details table — two (label | value) pairs
    // per row, matching the reference form:
    //   row 1: Calibration Block (DAC Block) | Reference Level
    //   row 2: Extent of Examination         | Flaw Sizing Technique
    //   row 3: Surface Condition             | —
    const drawWsScanningDetails = () => {
      const rowH = 18;
      const labelW = usableW * 0.25;
      const valueW = (usableW - 2 * labelW) / 2;
      // Admin-configured exact specification of the selected calibration
      // block gets its own row directly after the block name so it is
      // always fully readable in the PDF.
      const wsCalibSpec = (wsReport.wsScanningCalibrationBlockSpec ?? "").trim();
      const scanPairs: Array<[string, string | null]> = [
        ["Calibration Block (DAC Block)", wsReport.wsScanningCalibrationBlock],
        ["Reference Level", wsReport.wsScanningReferenceLevel],
        ["Extent of Examination", wsReport.wsScanningExtentOfExamination],
        ["Flaw Sizing Technique", wsReport.wsScanningFlawSizingTechnique],
        ["Surface Condition", wsReport.wsScanningSurfaceCondition],
        ...(wsCalibSpec ? [["Calibration Block Specification", wsCalibSpec] as [string, string | null]] : []),
        ["", null],
      ];
      // Only render if any value is non-empty
      const hasData = scanPairs.some(([, v]) => v && String(v).trim());
      if (!hasData) return;

      if (y + 24 + rowH * 3 > pageMaxY) { y = addNewPage(); }
      y += 4;
      const scanNum = pwsBranch.sub("Scanning Details");
      doc.font(FONT_BOLD).fontSize(FONT_SIZE_SUB).fillColor("#000");
      doc.text(`${scanNum} Scanning Details`, MARGIN, y);
      y += 20;

      for (let i = 0; i < scanPairs.length; i += 2) {
        if (y + rowH > pageMaxY) { y = addNewPage(); }
        const left = scanPairs[i];
        const right = scanPairs[i + 1] ?? ["", null];
        doc.rect(MARGIN, y, labelW, rowH).fill("#ecfeff");
        doc.font(FONT_BOLD).fontSize(7).fillColor("#000");
        doc.text(left[0], MARGIN + 3, y + 5, { width: labelW - 6 });
        doc.rect(MARGIN + labelW, y, valueW, rowH).fill("#ffffff");
        doc.font(FONT_REGULAR).fontSize(7).fillColor("#000");
        let lv = left[1] && String(left[1]).trim() ? String(left[1]).trim() : "";
        // Single-line cells: shrink the font until the value fits so option
        // names like "VW Step Block – 1 mm to 10 mm (10-step)" stay fully
        // visible (hard truncation would cut off "(10-step)").
        doc.font(FONT_REGULAR).fontSize(7);
        let lvSize = 7;
        while (lv && lvSize > 5.2 && doc.widthOfString(lv) > valueW - 8) {
          lvSize -= 0.4;
          doc.fontSize(lvSize);
        }
        if (lv && doc.widthOfString(lv) > valueW - 8) {
          const keep = Math.floor(((valueW - 8) / Math.max(1, doc.widthOfString(lv))) * lv.length);
          lv = lv.slice(0, Math.max(1, keep - 1)) + "…";
        }
        doc.text(lv, MARGIN + labelW + 3, y + 5, { width: valueW - 6, lineBreak: false });
        doc.fontSize(7);
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
    };

    // 1. Instrument Details (column renamed per spec: Instrument Type)
    drawWsMultiColTable(
      "Instrument Details",
      ["Instrument Type", "Machine Make", "Model", "M/c Sr. No.", "Calibration Due Date"],
      ["equipmentType", "machineMake", "model", "mcSrNo", "calibrationDueDate"],
      wsReport.wsInstrumentRows ?? "[]",
      ["calibrationDueDate"],
      pwsBranch,
    );

    // 2. Test Probe Details
    drawWsMultiColTable(
      "Test Probe Details",
      ["Probe Type", "Probe Angle", "Frequency", "Size", "Probe No.", "Range", "Ref dB", "Scan dB"],
      ["probeType", "probeAngle", "frequency", "size", "probeNo", "range", "referenceDb", "scanningDb"],
      wsReport.wsProbeRows ?? "[]",
      [],
      pwsBranch,
      [1.4, 1, 1.1, 1.2, 0.9, 0.9, 0.8, 0.9],
    );

    // 3. Scanning Details
    drawWsScanningDetails();

    // 4. Test Results — headings carry the full forms and measurement units.
    // Probe Type column: shown by default; when the report's saved
    // wsProbeTypeHidden flag is set the column is excluded from the PDF
    // entirely (heading, values and its width share) and the remaining
    // columns stretch to fill the printable width — the underlying
    // wsTestResultRows data is untouched, so restoring the column in the
    // editor brings the values back.
    const wsProbeTypeHidden = wsReport.wsProbeTypeHidden === true;
    const wsTrHeaders = ["Sl. No", "Description", "Identification No.", "Weld Type", "Probe Type", "Probe", "Beam Path (BP) (mm)", "Skip Distance (SD) (mm)", "Depth (mm)", "Echo Height (%)", "Length (mm)", "Observation", "Result"];
    const wsTrFields = ["description", "identificationNo", "weldType", "probeType", "probe", "bp", "sd", "depth", "echoHeight", "length", "observation", "result"];
    const wsTrRatios = [0.5, 1.05, 1.05, 0.85, 1.35, 0.75, 0.95, 1.0, 0.8, 0.95, 0.8, 1.1, 0.8];
    if (wsProbeTypeHidden) {
      // headers idx 4 = "Probe Type"; rowFields idx 3 = "probeType"
      wsTrHeaders.splice(4, 1);
      wsTrFields.splice(3, 1);
      wsTrRatios.splice(4, 1);
    }
    drawWsMultiColTable(
      "Test Results",
      wsTrHeaders,
      wsTrFields,
      wsReport.wsTestResultRows ?? "[]",
      [],
      pwsBranch,
      wsTrRatios,
    );
  } else if (reportType === "VESSEL_WELD_SCAN") {
    // ─── VESSEL WELD SCAN REPORT BODY ───
    // Renders, in this order:
    //   1. "Weld Scan Testing Parameters" — two-column table grouped into
    //      General Information / Equipment Details / Cable Details /
    //      Calibration Details / Other Testing Parameters (all typeable,
    //      nothing hardcoded from any sample).
    //   2. "Probe Details" — fixed 4-probe grid (Longitudinal Wave 0°,
    //      Shear Wave 45° / 60° / 70°) with Frequency / Probe Size /
    //      Serial Number entered by the user.
    //   3. "Weld Scan Testing Details" — Vessel column set: Sl. No |
    //      Component | Plate / Weld ID | Weld Dimension | Probe Angle |
    //      Probe Frequency | Observation & Result. Rows come from the
    //      vwsDetailRows JSON column. The header row repeats on page
    //      breaks so long tables stay readable.
    //   4. Photographs are handled by the shared photo-gallery section
    //      below (after the testing details, before certification).
    startBodyOnFreshPage(200);

    const vwsReport = report as any;
    const vwsBranch = makeTocBranch("Weld Scan");
    currentTestBranch = vwsBranch;
    const vwsUsableW = pageW - 2 * MARGIN;
    const vwsAccent = "#155e75"; // cyan-800 — matches the Vessel Weld Scan UI accent

    // Helper: draw one two-column label/value row. Group header rows are
    // drawn as full-width tinted rows.
    const vwsRowH = 18;
    const vwsLabelW = vwsUsableW * 0.38;
    const vwsValueW = vwsUsableW - vwsLabelW;
    const drawVwsGroupHeader = (title: string) => {
      if (y + vwsRowH > pageMaxY) { y = addNewPage(); }
      doc.rect(MARGIN, y, vwsUsableW, vwsRowH).fill("#ecfeff");
      doc.rect(MARGIN, y, vwsUsableW, vwsRowH).stroke(TABLE_OUTER_BORDER);
      doc.font(FONT_BOLD).fontSize(8.5).fillColor(vwsAccent);
      doc.text(title, MARGIN + 4, y + 5, { width: vwsUsableW - 8 });
      doc.fillColor("#000");
      y += vwsRowH;
    };
    const drawVwsParamRow = (label: string, value: string | null | undefined, isDate = false) => {
      if (y + vwsRowH > pageMaxY) { y = addNewPage(); }
      doc.rect(MARGIN, y, vwsLabelW, vwsRowH).fill("#f8fafc");
      doc.rect(MARGIN + vwsLabelW, y, vwsValueW, vwsRowH).fill("#ffffff");
      doc.rect(MARGIN, y, vwsUsableW, vwsRowH).stroke(TABLE_OUTER_BORDER);
      doc.moveTo(MARGIN + vwsLabelW, y).lineTo(MARGIN + vwsLabelW, y + vwsRowH).stroke(TABLE_INNER_BORDER);
      doc.font(FONT_BOLD).fontSize(8.5).fillColor("#000");
      doc.text(label, MARGIN + 4, y + 5, { width: vwsLabelW - 8 });
      doc.font(FONT_REGULAR).fontSize(8.5).fillColor("#000");
      let displayText = value && String(value).trim() ? String(value).trim() : "";
      if (isDate && displayText) {
        try { displayText = new Date(displayText).toISOString().slice(0, 10); } catch {}
      }
      if (!displayText) displayText = "";
      const maxW = vwsValueW - 8;
      // Shrink-to-fit: keep the full calibration-block option visible.
      doc.font(FONT_REGULAR).fontSize(8.5);
      let dvSize = 8.5;
      while (displayText && dvSize > 5.4 && doc.widthOfString(displayText) > maxW) {
        dvSize -= 0.4;
        doc.fontSize(dvSize);
      }
      if (doc.widthOfString(displayText) > maxW) {
        const charsToKeep = Math.floor((maxW / Math.max(1, doc.widthOfString(displayText))) * displayText.length);
        displayText = displayText.slice(0, Math.max(1, charsToKeep - 1)) + "…";
      }
      doc.text(displayText, MARGIN + vwsLabelW + 4, y + 5, { width: maxW, lineBreak: false });
      doc.fontSize(8.5);
      y += vwsRowH;
    };

    // ─── 1. WELD SCAN TESTING PARAMETERS ───
    {
      if (y + 24 + vwsRowH > pageMaxY) { y = addNewPage(); }
      y += 6;
      doc.font(FONT_BOLD).fontSize(FONT_SIZE_SUB).fillColor(vwsAccent);
      doc.text(`{vwsBranch.sub("Weld Scan Testing Parameters") + " Weld Scan Testing Parameters"}`, MARGIN, y);
      doc.fillColor("#000");
      y += 18;

      drawVwsGroupHeader("General Information");
      drawVwsParamRow("Date of Examination", vwsReport.vwsDateOfExamination, true);
      drawVwsParamRow("Testing Standard", vwsReport.vwsTestingStandard);
      drawVwsParamRow("Acceptance Criteria", vwsReport.vwsAcceptanceCriteria);
      drawVwsParamRow("UT Procedure", vwsReport.vwsUtProcedure);

      drawVwsGroupHeader("Equipment Details");
      drawVwsParamRow("Equipment Make", vwsReport.vwsEquipmentMake);
      drawVwsParamRow("Equipment Model", vwsReport.vwsEquipmentModel);
      drawVwsParamRow("Equipment Serial Number", vwsReport.vwsEquipmentSerialNo);
      drawVwsParamRow("Calibration Due Date", vwsReport.vwsCalibrationDueDate, true);

      drawVwsGroupHeader("Cable Details");
      drawVwsParamRow("Cable Length", vwsReport.vwsCableLength);
      drawVwsParamRow("Cable Type", vwsReport.vwsCableType);

      drawVwsGroupHeader("Calibration Details");
      drawVwsParamRow("Calibration Block", vwsReport.vwsCalibrationBlock);
      // Admin-configured exact specification of the selected calibration
      // block (row only present when the admin filled it in).
      const vwsCalibSpec = (vwsReport.vwsCalibrationBlockSpec ?? "").trim();
      if (vwsCalibSpec) {
        drawVwsParamRow("Calibration Block Specification", vwsCalibSpec);
      }
      drawVwsParamRow("Calibration Block Material / MOC", vwsReport.vwsCalibrationBlockMoc);
      drawVwsParamRow("Reference Reflector", vwsReport.vwsReferenceReflector);
      drawVwsParamRow("Reference Level", vwsReport.vwsReferenceLevel);

      drawVwsGroupHeader("Other Testing Parameters");
      drawVwsParamRow("Flaw Sizing Technique", vwsReport.vwsFlawSizingTechnique);
      drawVwsParamRow("Surface Temperature", vwsReport.vwsSurfaceTemperature);
      drawVwsParamRow("Method", vwsReport.vwsTestingMethod);
      drawVwsParamRow("Couplant", vwsReport.vwsCouplant);
      drawVwsParamRow("Surface Preparation", vwsReport.vwsSurfacePreparation);
      drawVwsParamRow("Surface Finish", vwsReport.vwsSurfaceFinish);
      drawVwsParamRow("Extent of Scanning", vwsReport.vwsExtentOfScanning);
      y += 8;
    }

    // ─── 2. PROBE DETAILS (fixed 4-probe grid) ───
    {
      let vwsProbes: Array<Record<string, string>> = [];
      try {
        const parsed = JSON.parse(vwsReport.vwsProbeDetails ?? "[]");
        if (Array.isArray(parsed)) vwsProbes = parsed;
      } catch {}
      const pHeaderH = 22;
      const pRowH = 20;
      const pUsable = pageW - 2 * MARGIN;
      const pColWidths = orientation === "landscape"
        ? [170, 80, 130, 130, Math.max(120, pUsable - 170 - 80 - 130 - 130)]
        : [130, 65, 95, 95, Math.max(90, pUsable - 130 - 65 - 95 - 95)];
      const pHeaders = ["Probe", "Probe Angle", "Frequency", "Probe Size", "Serial Number"];

      if (y + 24 + pHeaderH + pRowH > pageMaxY) { y = addNewPage(); }
      y += 4;
      doc.font(FONT_BOLD).fontSize(FONT_SIZE_SUB).fillColor(vwsAccent);
      doc.text(`{vwsBranch.sub("Probe Details") + " Probe Details"}`, MARGIN, y);
      doc.fillColor("#000");
      y += 16;

      const drawProbeHeader = (headerY: number) => {
        doc.rect(MARGIN, headerY, pUsable, pHeaderH).fill(TABLE_HEADER_BG);
        doc.rect(MARGIN, headerY, pUsable, pHeaderH).stroke(TABLE_OUTER_BORDER);
        let x = MARGIN;
        doc.font(FONT_BOLD).fontSize(7.5).fillColor(TABLE_HEADER_FG);
        for (let i = 0; i < pHeaders.length; i++) {
          if (i > 0) doc.moveTo(x, headerY).lineTo(x, headerY + pHeaderH).stroke(TABLE_INNER_BORDER);
          doc.text(pHeaders[i], x + 2, headerY + 8, { width: pColWidths[i] - 4, align: "center" });
          x += pColWidths[i];
        }
        doc.fillColor("#000");
      };
      drawProbeHeader(y);
      y += pHeaderH;

      for (const probe of vwsProbes) {
        if (y + pRowH > pageMaxY) {
          addNewPage();
          drawProbeHeader(MARGIN);
          y = contentTopY + pHeaderH;
        }
        doc.rect(MARGIN, y, pUsable, pRowH).stroke(TABLE_OUTER_BORDER);
        const cells = [
          probe.probeType === "Longitudinal Wave" ? "Longitudinal Wave Probe" : "Shear Wave Probe",
          probe.probeAngle ?? "",
          probe.frequency ?? "",
          probe.probeSize ?? "",
          probe.serialNo ?? "",
        ];
        let cx = MARGIN;
        for (let i = 0; i < pHeaders.length; i++) {
          if (i > 0) doc.moveTo(cx, y).lineTo(cx, y + pRowH).stroke(TABLE_INNER_BORDER);
          doc.font(i === 0 ? FONT_BOLD : FONT_REGULAR).fontSize(7.5).fillColor("#000");
          let disp = String(cells[i] ?? "");
          const maxW = pColWidths[i] - 8;
          if (doc.widthOfString(disp) > maxW) {
            const c = Math.floor((maxW / Math.max(1, doc.widthOfString(disp))) * disp.length);
            disp = disp.slice(0, Math.max(1, c - 1)) + "…";
          }
          doc.text(disp, cx + 4, y + 6, { width: maxW, align: i === 0 ? "left" : "center" });
          cx += pColWidths[i];
        }
        doc.fillColor("#000");
        y += pRowH;
      }
      y += 10;
    }

    // ─── 3. WELD SCAN TESTING DETAILS (Vessel column set) ───
    {
      let vwsObs: Array<Record<string, string>> = [];
      try {
        const parsed = JSON.parse(vwsReport.vwsDetailRows ?? "[]");
        if (Array.isArray(parsed)) vwsObs = parsed;
      } catch {}
      const dHeaderH = 30;
      const dRowH = 30;
      const dUsable = pageW - 2 * MARGIN;
      const dSlW = 30;
      const dCompW = orientation === "landscape" ? 110 : 85;
      const dWeldW = orientation === "landscape" ? 130 : 100;
      const dDimW = orientation === "landscape" ? 110 : 85;
      const dAngleW = 55;
      const dFreqW = orientation === "landscape" ? 80 : 65;
      const dObsW = Math.max(110, dUsable - dSlW - dCompW - dWeldW - dDimW - dAngleW - dFreqW);
      const dColWidths = [dSlW, dCompW, dWeldW, dDimW, dAngleW, dFreqW, dObsW];
      const dHeaders = ["Sl.\nNo", "Component", "Plate / Weld ID", "Weld Dimension", "Probe\nAngle", "Probe Frequency", "Observation & Result"];

      if (y + 24 + dHeaderH + dRowH > pageMaxY) { y = addNewPage(); }
      y += 4;
      doc.font(FONT_BOLD).fontSize(FONT_SIZE_SUB).fillColor(vwsAccent);
      doc.text(`{vwsBranch.sub("Weld Scan Testing Details") + " Weld Scan Testing Details"}`, MARGIN, y);
      doc.fillColor("#000");
      y += 16;

      const drawDetailsHeader = (headerY: number) => {
        doc.rect(MARGIN, headerY, dUsable, dHeaderH).fill(TABLE_HEADER_BG);
        doc.rect(MARGIN, headerY, dUsable, dHeaderH).stroke(TABLE_OUTER_BORDER);
        let x = MARGIN;
        doc.font(FONT_BOLD).fontSize(7).fillColor(TABLE_HEADER_FG);
        for (let i = 0; i < dHeaders.length; i++) {
          if (i > 0) doc.moveTo(x, headerY).lineTo(x, headerY + dHeaderH).stroke(TABLE_INNER_BORDER);
          doc.text(dHeaders[i], x + 2, headerY + 8, { width: dColWidths[i] - 4, align: "center" });
          x += dColWidths[i];
        }
        doc.fillColor("#000");
      };
      drawDetailsHeader(y);
      y += dHeaderH;

      for (let ri = 0; ri < vwsObs.length; ri++) {
        const obs = vwsObs[ri];
        if (y + dRowH > pageMaxY) {
          // New page: repeat the table header so multi-page tables stay
          // readable, then continue with the current row.
          addNewPage();
          drawDetailsHeader(MARGIN);
          y = contentTopY + dHeaderH;
        }
        doc.rect(MARGIN, y, dUsable, dRowH).stroke(TABLE_OUTER_BORDER);
        const cells: string[] = [
          String(ri + 1),
          obs.component ?? "",
          obs.plateWeldId ?? "",
          obs.weldDimension ?? "",
          obs.probeAngle ?? "",
          obs.probeFrequency ?? "",
          obs.observationResult ?? "",
        ];
        let cx = MARGIN;
        for (let i = 0; i < dHeaders.length; i++) {
          if (i > 0) doc.moveTo(cx, y).lineTo(cx, y + dRowH).stroke(TABLE_INNER_BORDER);
          doc.font(i === 0 ? FONT_BOLD : FONT_REGULAR).fontSize(7).fillColor("#000");
          let disp = String(cells[i] ?? "");
          const maxW = dColWidths[i] - 8;
          if (doc.widthOfString(disp) > maxW) {
            const c = Math.floor((maxW / Math.max(1, doc.widthOfString(disp))) * disp.length);
            disp = disp.slice(0, Math.max(1, c - 1)) + "…";
          }
          doc.text(disp, cx + 4, y + 5, { width: maxW, align: i === 0 ? "center" : "left" });
          cx += dColWidths[i];
        }
        doc.fillColor("#000");
        y += dRowH;
      }
      if (vwsObs.length === 0) {
        doc.font(FONT_REGULAR).fontSize(8.5).fillColor("#6b7280");
        doc.text("No weld scan testing details recorded.", MARGIN, y + 4);
        doc.fillColor("#000");
        y += 20;
      }
      y += 6;
    }
  } else if (reportType === "VESSEL_UTM") {
    // ─── VESSEL UT THICKNESS MEASUREMENT REPORT BODY ───
    // Renders, in this order:
    //   1. Equipment Type / Inspection / Orientation lines ("Equipment
    //      Type: Vessel", "Inspection: UT Thickness Measurement",
    //      "Orientation: Horizontal|Vertical" — the selected orientation
    //      is displayed in the report).
    //   2. "UT Thickness Measurement Parameters" — grouped two-column
    //      table (General Information / Equipment Details / Cable &
    //      Crystal Details / Calibration Details / Other Testing
    //      Parameters). All values are typeable, nothing hardcoded.
    //   3. "Probe Details — Longitudinal Wave (0°)" — repeatable probe
    //      grid (Frequency / Size / S.No. per row).
    //   4. "UT Thickness Measurement Readings" — ONE unified clock-
    //      position table: every component row shows its 12 / 3 / 6 / 9
    //      o'clock readings (every reading the user entered — one per
    //      line, no empty slots) and the auto-calculated Minimum
    //      Measured Thickness (recomputed from the stored readings,
    //      never trusted from storage). Legacy orientation-based row
    //      shapes (horizontal / vertical / dish / nozzle) are converted
    //      transparently.
    //   5. Photographs are handled by the shared photo-gallery section
    //      below (heading "Photographs – During UT Thickness
    //      Measurement" for this report type).
    startBodyOnFreshPage(240);

    const utmReport = report as any;
    const vutmBranch = makeTocBranch("UT Thickness Measurement");
    currentTestBranch = vutmBranch;
    // The orientation (VESSEL_UTM only) decides the readings-table
    // structure: VERTICAL → direction rows, otherwise clock rows.
    const utmIsVertical = utmReport.vesselOrientation === "VERTICAL";
    const utmUsableW = pageW - 2 * MARGIN;
    const utmAccent = "#065f46"; // emerald-800 — matches the Vessel UT Thickness UI accent

    const utmRowH = 18;
    const utmLabelW = utmUsableW * 0.38;
    const utmValueW = utmUsableW - utmLabelW;
    const drawUtmGroupHeader = (title: string) => {
      if (y + utmRowH > pageMaxY) { y = addNewPage(); }
      doc.rect(MARGIN, y, utmUsableW, utmRowH).fill("#ecfdf5");
      doc.rect(MARGIN, y, utmUsableW, utmRowH).stroke(TABLE_OUTER_BORDER);
      doc.font(FONT_BOLD).fontSize(8.5).fillColor(utmAccent);
      doc.text(title, MARGIN + 4, y + 5, { width: utmUsableW - 8 });
      doc.fillColor("#000");
      y += utmRowH;
    };
    const drawUtmParamRow = (label: string, value: string | null | undefined, isDate = false) => {
      if (y + utmRowH > pageMaxY) { y = addNewPage(); }
      doc.rect(MARGIN, y, utmLabelW, utmRowH).fill("#f8fafc");
      doc.rect(MARGIN + utmLabelW, y, utmValueW, utmRowH).fill("#ffffff");
      doc.rect(MARGIN, y, utmUsableW, utmRowH).stroke(TABLE_OUTER_BORDER);
      doc.moveTo(MARGIN + utmLabelW, y).lineTo(MARGIN + utmLabelW, y + utmRowH).stroke(TABLE_INNER_BORDER);
      doc.font(FONT_BOLD).fontSize(8.5).fillColor("#000");
      doc.text(label, MARGIN + 4, y + 5, { width: utmLabelW - 8 });
      doc.font(FONT_REGULAR).fontSize(8.5).fillColor("#000");
      let displayText = value && String(value).trim() ? String(value).trim() : "";
      if (isDate && displayText) {
        try { displayText = new Date(displayText).toISOString().slice(0, 10); } catch {}
      }
      const maxW = utmValueW - 8;
      if (doc.widthOfString(displayText) > maxW) {
        const charsToKeep = Math.floor((maxW / Math.max(1, doc.widthOfString(displayText))) * displayText.length);
        displayText = displayText.slice(0, Math.max(1, charsToKeep - 1)) + "…";
      }
      doc.text(displayText, MARGIN + utmLabelW + 4, y + 5, { width: maxW });
      y += utmRowH;
    };

    // ─── 1. EQUIPMENT TYPE / INSPECTION / ORIENTATION LINE ───
    // Per the UT Thickness Measurement report format:
    //   Equipment Type: Vessel
    //   Inspection: UT Thickness Measurement
    //   Orientation: Horizontal | Vertical
    {
      const lines = [
        "Equipment Type: Vessel",
        "Inspection: UT Thickness Measurement",
        `Orientation: ${utmIsVertical ? "Vertical" : "Horizontal"}`,
      ];
      for (const line of lines) {
        if (y + 14 > pageMaxY) { y = addNewPage(); }
        doc.font(FONT_BOLD).fontSize(9).fillColor(utmAccent);
        doc.text(line, MARGIN, y);
        doc.fillColor("#000");
        y += 13;
      }
    }

    // ─── 2. UT THICKNESS MEASUREMENT PARAMETERS ───
    {
      if (y + 24 + utmRowH > pageMaxY) { y = addNewPage(); }
      y += 6;
      doc.font(FONT_BOLD).fontSize(FONT_SIZE_SUB).fillColor(utmAccent);
      doc.text(`{vutmBranch.sub("UT Thickness Measurement Parameters") + " UT Thickness Measurement Parameters"}`, MARGIN, y);
      doc.fillColor("#000");
      y += 18;

      drawUtmGroupHeader("General Information");
      drawUtmParamRow("Date of Examination", utmReport.vutmDateOfExamination, true);
      drawUtmParamRow("Testing Standard", utmReport.vutmTestingStandard);
      drawUtmParamRow("Acceptance Criteria", utmReport.vutmAcceptanceCriteria);
      drawUtmParamRow("UT Procedure", utmReport.vutmUtProcedure);

      drawUtmGroupHeader("Equipment Details");
      drawUtmParamRow("Equipment Make", utmReport.vutmEquipmentMake);
      drawUtmParamRow("Equipment Model", utmReport.vutmEquipmentModel);
      drawUtmParamRow("Equipment Serial Number", utmReport.vutmEquipmentSerialNo);
      drawUtmParamRow("Calibration Due Date", utmReport.vutmCalibrationDueDate, true);

      drawUtmGroupHeader("Cable & Crystal Details");
      drawUtmParamRow("Cable Length and Type", utmReport.vutmCableLengthAndType);
      drawUtmParamRow("Type of Crystal", utmReport.vutmTypeOfCrystal);

      drawUtmGroupHeader("Calibration Details");
      drawUtmParamRow("Calibration Block Dimension / MOC", utmReport.vutmCalibrationBlock);

      drawUtmGroupHeader("Other Testing Parameters");
      drawUtmParamRow("Surface Temperature", utmReport.vutmSurfaceTemperature);
      drawUtmParamRow("Method", utmReport.vutmMethod);
      drawUtmParamRow("Couplant", utmReport.vutmCouplant);
      drawUtmParamRow("Surface Preparation", utmReport.vutmSurfacePreparation);
      drawUtmParamRow("Surface Finish", utmReport.vutmSurfaceFinish);
      y += 8;
    }

    // ─── 3. PROBE DETAILS (repeatable Longitudinal Wave 0° grid) ───
    {
      let utmProbes: Array<Record<string, unknown>> = [];
      try {
        const parsed = JSON.parse(utmReport.vutmLwProbeRows ?? "[]");
        if (Array.isArray(parsed) && parsed.length > 0) utmProbes = parsed;
      } catch {}
      const pHeaderH = 20;
      const pRowH = 20;
      const pUsable = utmUsableW;
      const pColWidths = orientation === "landscape"
        ? [170, 80, 130, 120, Math.max(120, pUsable - 170 - 80 - 130 - 120)]
        : [120, 55, 90, 85, Math.max(85, pUsable - 120 - 55 - 90 - 85)];
      const pHeaders = ["Probe", "Probe Angle", "Frequency", "Size", "S.No."];

      if (y + 24 + pHeaderH + pRowH > pageMaxY) { y = addNewPage(); }
      y += 4;
      doc.font(FONT_BOLD).fontSize(FONT_SIZE_SUB).fillColor(utmAccent);
      doc.text(`{vutmBranch.sub("Probe Details — Longitudinal Wave (0°)") + " Probe Details — Longitudinal Wave (0°)"}`, MARGIN, y);
      doc.fillColor("#000");
      y += 16;

      const drawUtmProbeHeader = (headerY: number) => {
        doc.rect(MARGIN, headerY, pUsable, pHeaderH).fill(TABLE_HEADER_BG);
        doc.rect(MARGIN, headerY, pUsable, pHeaderH).stroke(TABLE_OUTER_BORDER);
        let x = MARGIN;
        doc.font(FONT_BOLD).fontSize(7.5).fillColor(TABLE_HEADER_FG);
        for (let i = 0; i < pHeaders.length; i++) {
          if (i > 0) doc.moveTo(x, headerY).lineTo(x, headerY + pHeaderH).stroke(TABLE_INNER_BORDER);
          doc.text(pHeaders[i], x + 2, headerY + 7, { width: pColWidths[i] - 4, align: "center" });
          x += pColWidths[i];
        }
        doc.fillColor("#000");
      };
      drawUtmProbeHeader(y);
      y += pHeaderH;

      for (const probe of utmProbes) {
        if (y + pRowH > pageMaxY) {
          addNewPage();
          drawUtmProbeHeader(MARGIN);
          y = contentTopY + pHeaderH;
        }
        doc.rect(MARGIN, y, pUsable, pRowH).stroke(TABLE_OUTER_BORDER);
        const cells = [
          "Longitudinal Wave Probe",
          "0°",
          String(probe.frequency ?? ""),
          String(probe.probeSize ?? ""),
          String(probe.serialNo ?? ""),
        ];
        let cx = MARGIN;
        for (let i = 0; i < pHeaders.length; i++) {
          if (i > 0) doc.moveTo(cx, y).lineTo(cx, y + pRowH).stroke(TABLE_INNER_BORDER);
          doc.font(i === 0 ? FONT_BOLD : FONT_REGULAR).fontSize(7.5).fillColor("#000");
          let disp = String(cells[i] ?? "");
          const maxW = pColWidths[i] - 8;
          if (doc.widthOfString(disp) > maxW) {
            const c = Math.floor((maxW / Math.max(1, doc.widthOfString(disp))) * disp.length);
            disp = disp.slice(0, Math.max(1, c - 1)) + "…";
          }
          doc.text(disp, cx + 4, y + 6, { width: maxW, align: i === 0 ? "left" : "center" });
          cx += pColWidths[i];
        }
        doc.fillColor("#000");
        y += pRowH;
      }
      y += 10;
    }

    // ─── 4. UT THICKNESS MEASUREMENT READINGS ───
    {
      // Parse the readings-row columns (defensively) into rows matching
      // the report's orientation. Legacy orientation-based shapes
      // (horizontal 4-spot rows, vertical direction rows, dish rows,
      // nozzle rows) are converted transparently — every stored reading
      // survives into the report.
      const utmRows = vutmRowsFromReport(
        utmReport.vutmShellRows,
        utmReport.vutmDishRows,
        utmReport.vutmNozzleRows,
        (utmIsVertical ? "VERTICAL" : "HORIZONTAL") as VesselOrientation,
      );

      if (y + 24 + 30 > pageMaxY) { y = addNewPage(); }
      y += 4;
      doc.font(FONT_BOLD).fontSize(FONT_SIZE_SUB).fillColor(utmAccent);
      doc.text(`{vutmBranch.sub("UT Thickness Measurement Readings") + " UT Thickness Measurement Readings"}`, MARGIN, y);
      doc.fillColor("#000");
      y += 16;

      // Generic spot-value renderer: trims, truncates, centres.
      const drawUtmCell = (
        text: string,
        x: number,
        rowY: number,
        w: number,
        rowH: number,
        align: "left" | "center" = "center",
        bold = false,
        fontSize = 7,
      ) => {
        doc.font(bold ? FONT_BOLD : FONT_REGULAR).fontSize(fontSize).fillColor("#000");
        let disp = String(text ?? "").trim();
        const maxW = w - 6;
        if (doc.widthOfString(disp) > maxW) {
          const c = Math.floor((maxW / Math.max(1, doc.widthOfString(disp))) * disp.length);
          disp = disp.slice(0, Math.max(1, c - 1)) + "…";
        }
        doc.text(disp, x + 3, rowY + (rowH - fontSize - 1) / 2 + 1, { width: maxW, align });
        doc.fillColor("#000");
      };

      // ─── 4a. COMPONENT TABLE — orientation-specific ───
      if (utmIsVertical) {
        // VERTICAL: one row per component + direction; the readings cell
        // lists every entered reading, one per line (no empty slots).
        const vInfoW = orientation === "landscape"
          ? { moc: 58, comp: 78, id: 48, nom: 44, dir: 42, min: 48 }
          : { moc: 44, comp: 56, id: 36, nom: 32, dir: 34, min: 38 };
        const vInfoSum = vInfoW.moc + vInfoW.comp + vInfoW.id + vInfoW.nom + vInfoW.dir + vInfoW.min;
        const vReadW = Math.max(40, utmUsableW - vInfoSum);
        const vHeaderH = 26;
        const vLineH = 8;
        const vMinRowH = 18;
        const vPad = 5;
        const vCellText = (v: unknown): string => String(v ?? "").trim();

        const drawVtmRowsHeader = (headerY: number) => {
          doc.rect(MARGIN, headerY, utmUsableW, vHeaderH).fill(TABLE_HEADER_BG);
          doc.rect(MARGIN, headerY, utmUsableW, vHeaderH).stroke(TABLE_OUTER_BORDER);
          let x = MARGIN;
          doc.font(FONT_BOLD).fontSize(6.5).fillColor(TABLE_HEADER_FG);
          const headers: Array<[string, number]> = [
            ["MOC", vInfoW.moc],
            ["Component Type", vInfoW.comp],
            ["Component ID", vInfoW.id],
            ["Nominal\nThickness\n(mm)", vInfoW.nom],
            ["Direction", vInfoW.dir],
            ["Readings (mm)", vReadW],
            ["Minimum\nMeasured\n(mm)", vInfoW.min],
          ];
          for (let i = 0; i < headers.length; i++) {
            const [label, w] = headers[i];
            if (i > 0) doc.moveTo(x, headerY).lineTo(x, headerY + vHeaderH).stroke(TABLE_INNER_BORDER);
            doc.text(label, x + 2, headerY + 3, { width: w - 4, align: "center", lineGap: 0 });
            x += w;
          }
          doc.fillColor("#000");
        };

        if (y + 24 + vHeaderH + vMinRowH > pageMaxY) { y = addNewPage(); }
        y += 6;
        doc.font(FONT_BOLD).fontSize(9.5).fillColor(utmAccent);
        doc.text("Component Measurements (Directions)", MARGIN, y);
        doc.fillColor("#000");
        y += 14;
        drawVtmRowsHeader(y);
        y += vHeaderH;

        for (const row of utmRows) {
          const dirRow = row as VutmDirectionRow;
          const lines = (Array.isArray(dirRow.readings) ? dirRow.readings : [])
            .map((s) => vCellText(s))
            .filter((s) => s !== "");
          const maxLines = Math.max(1, lines.length);
          const rowH = Math.max(vMinRowH, vPad * 2 + maxLines * vLineH);
          if (y + rowH > pageMaxY) {
            addNewPage();
            drawVtmRowsHeader(MARGIN);
            y = contentTopY + vHeaderH;
          }
          doc.rect(MARGIN, y, utmUsableW, rowH).stroke(TABLE_OUTER_BORDER);
          const infoCells: Array<[string, number, "left" | "center", boolean]> = [
            [vCellText(dirRow.moc), vInfoW.moc, "left", false],
            [vCellText(dirRow.componentType), vInfoW.comp, "left", false],
            [vCellText(dirRow.componentId), vInfoW.id, "left", false],
            [vCellText(dirRow.nominalThickness), vInfoW.nom, "center", false],
            [vCellText(dirRow.direction), vInfoW.dir, "center", false],
          ];
          let cx = MARGIN;
          for (const [text, w, align, bold] of infoCells) {
            doc.moveTo(cx, y).lineTo(cx, y + rowH).stroke(TABLE_INNER_BORDER);
            drawUtmCell(text, cx, y, w, rowH, align, bold, 6.5);
            cx += w;
          }
          doc.moveTo(cx, y).lineTo(cx, y + rowH).stroke(TABLE_INNER_BORDER);
          if (lines.length === 0) {
            drawUtmCell("—", cx, y, vReadW, rowH, "center", false, 6.5);
          } else {
            // One reading per line, vertically centred in the cell.
            doc.font(FONT_REGULAR).fontSize(6.5).fillColor("#000");
            const blockH = lines.length * vLineH;
            let ly = y + Math.max(2, (rowH - blockH) / 2);
            const maxW = vReadW - 6;
            for (const line of lines) {
              let disp = line;
              if (doc.widthOfString(disp) > maxW) {
                const c = Math.floor((maxW / Math.max(1, doc.widthOfString(disp))) * disp.length);
                disp = disp.slice(0, Math.max(1, c - 1)) + "…";
              }
              doc.text(disp, cx + 3, ly, { width: maxW, align: "center" });
              ly += vLineH;
            }
            doc.fillColor("#000");
          }
          cx += vReadW;
          doc.moveTo(cx, y).lineTo(cx, y + rowH).stroke(TABLE_INNER_BORDER);
          const minVal = vutmMinOfSpots(
            Array.isArray(dirRow.readings)
              ? (dirRow.readings as Array<unknown>).map((s) => String(s ?? ""))
              : [],
          );
          drawUtmCell(minVal || "—", cx, y, vInfoW.min, rowH, "center", true, 7);
          doc.fillColor("#000");
          y += rowH;
        }
        if (utmRows.length === 0) {
          doc.font(FONT_REGULAR).fontSize(8).fillColor("#6b7280");
          doc.text("No component measurement rows recorded.", MARGIN, y + 4);
          doc.fillColor("#000");
          y += 18;
        }
        y += 8;
      } else {
        // HORIZONTAL: clock-position table (all components).
        const uInfoW = orientation === "landscape"
          ? { moc: 62, comp: 80, id: 52, nom: 46, min: 48 }
          : { moc: 46, comp: 58, id: 38, nom: 34, min: 38 };
        const uInfoSum = uInfoW.moc + uInfoW.comp + uInfoW.id + uInfoW.nom + uInfoW.min;
        const uClockW = Math.max(34, (utmUsableW - uInfoSum) / 4);
        const uClockKeys = ["c12", "c3", "c6", "c9"] as const;
        const uHeaderH = 26;
        const uLineH = 8;
        const uMinRowH = 18;
        const uPad = 5;
        const uCellText = (v: unknown): string => String(v ?? "").trim();

        const drawUtmRowsHeader = (headerY: number) => {
          doc.rect(MARGIN, headerY, utmUsableW, uHeaderH).fill(TABLE_HEADER_BG);
          doc.rect(MARGIN, headerY, utmUsableW, uHeaderH).stroke(TABLE_OUTER_BORDER);
          let x = MARGIN;
          doc.font(FONT_BOLD).fontSize(6.5).fillColor(TABLE_HEADER_FG);
          const headers: Array<[string, number]> = [
            ["MOC", uInfoW.moc],
            ["Component Type", uInfoW.comp],
            ["Component ID", uInfoW.id],
            ["Nominal\nThickness\n(mm)", uInfoW.nom],
            ["12 O'clock", uClockW],
            ["3 O'clock", uClockW],
            ["6 O'clock", uClockW],
            ["9 O'clock", uClockW],
            ["Minimum\nMeasured\n(mm)", uInfoW.min],
          ];
          for (let i = 0; i < headers.length; i++) {
            const [label, w] = headers[i];
            if (i > 0) doc.moveTo(x, headerY).lineTo(x, headerY + uHeaderH).stroke(TABLE_INNER_BORDER);
            doc.text(label, x + 2, headerY + 3, { width: w - 4, align: "center", lineGap: 0 });
            x += w;
          }
          doc.fillColor("#000");
        };

        if (y + 24 + uHeaderH + uMinRowH > pageMaxY) { y = addNewPage(); }
        y += 6;
        doc.font(FONT_BOLD).fontSize(9.5).fillColor(utmAccent);
        doc.text("Component Measurements (Clock Positions)", MARGIN, y);
        doc.fillColor("#000");
        y += 14;
        drawUtmRowsHeader(y);
        y += uHeaderH;

        for (const row of utmRows) {
          const clkRow = row as VutmClockRow;
          // Readings per clock position — every entered reading, blank
          // slots excluded (never rendered).
          const spotGroups = uClockKeys.map((k) =>
            Array.isArray(clkRow[k])
              ? (clkRow[k] as Array<unknown>).map((s) => uCellText(s))
              : [],
          );
          const cells = spotGroups.map((g) => g.filter((s) => s !== ""));
          const maxLines = Math.max(1, ...cells.map((c) => c.length));
          const rowH = Math.max(uMinRowH, uPad * 2 + maxLines * uLineH);
          if (y + rowH > pageMaxY) {
            addNewPage();
            drawUtmRowsHeader(MARGIN);
            y = contentTopY + uHeaderH;
          }
          doc.rect(MARGIN, y, utmUsableW, rowH).stroke(TABLE_OUTER_BORDER);
          const infoCells: Array<[string, number, "left" | "center", boolean]> = [
            [uCellText(clkRow.moc), uInfoW.moc, "left", false],
            [uCellText(clkRow.componentType), uInfoW.comp, "left", false],
            [uCellText(clkRow.componentId), uInfoW.id, "left", false],
            [uCellText(clkRow.nominalThickness), uInfoW.nom, "center", false],
          ];
          let cx = MARGIN;
          for (const [text, w, align, bold] of infoCells) {
            doc.moveTo(cx, y).lineTo(cx, y + rowH).stroke(TABLE_INNER_BORDER);
            drawUtmCell(text, cx, y, w, rowH, align, bold, 6.5);
            cx += w;
          }
          for (const lines of cells) {
            doc.moveTo(cx, y).lineTo(cx, y + rowH).stroke(TABLE_INNER_BORDER);
            if (lines.length === 0) {
              drawUtmCell("—", cx, y, uClockW, rowH, "center", false, 6.5);
            } else {
              // One reading per line, vertically centred in the cell.
              doc.font(FONT_REGULAR).fontSize(6.5).fillColor("#000");
              const blockH = lines.length * uLineH;
              let ly = y + Math.max(2, (rowH - blockH) / 2);
              const maxW = uClockW - 6;
              for (const line of lines) {
                let disp = line;
                if (doc.widthOfString(disp) > maxW) {
                  const c = Math.floor((maxW / Math.max(1, doc.widthOfString(disp))) * disp.length);
                  disp = disp.slice(0, Math.max(1, c - 1)) + "…";
                }
                doc.text(disp, cx + 3, ly, { width: maxW, align: "center" });
                ly += uLineH;
              }
              doc.fillColor("#000");
            }
            cx += uClockW;
          }
          doc.moveTo(cx, y).lineTo(cx, y + rowH).stroke(TABLE_INNER_BORDER);
          const minVal = vutmMinOfSpots(spotGroups[0], spotGroups[1], spotGroups[2], spotGroups[3]);
          drawUtmCell(minVal || "—", cx, y, uInfoW.min, rowH, "center", true, 7);
          doc.fillColor("#000");
          y += rowH;
        }
        if (utmRows.length === 0) {
          doc.font(FONT_REGULAR).fontSize(8).fillColor("#6b7280");
          doc.text("No component measurement rows recorded.", MARGIN, y + 4);
          doc.fillColor("#000");
          y += 18;
        }
        y += 8;
      }

      y += 6;
    }
  } else if (reportType === "TANK_DPT") {
    // ─── TANK DPT REPORT BODY (Tank equipment — Storage Tank) ───
    // Completely separate from the Vessel DPT branch above — renders the
    // same section ORDER but from the tank's own tdpt* fields:
    //   1. "Dye Penetrant Testing Parameters" — two-column table with
    //      Date of Examination + 16 typeable fields.
    //   2. "Consumable Details" — 3-row grid (Solvent / Penetrant /
    //      Developer) × Make / Product / Batch Number / Expiry Date.
    //   3. "Dye Penetrant Testing Details" — rows from the tank's own
    //      tdptObservationRows JSON column.
    //   4. Photographs are handled by the shared photo-gallery section.
    startBodyOnFreshPage(160);

    const tdptReport = report as any;
    const tdptBranch = makeTocBranch("Dye Penetrant Testing");
    currentTestBranch = tdptBranch;
    const tdptAccent = "#86198f"; // fuchsia-800 — matches the Tank DPT UI accent

    // ─── 1. DYE PENETRANT TESTING PARAMETERS ───
    {
      const procRowH = 18;
      if (y + 24 + procRowH > pageMaxY) { y = addNewPage(); }
      y += 6;
      doc.font(FONT_BOLD).fontSize(FONT_SIZE_SUB).fillColor(tdptAccent);
      doc.text(`{tdptBranch.sub("Dye Penetrant Testing Parameters") + " Dye Penetrant Testing Parameters"}`, MARGIN, y);
      doc.fillColor("#000");
      y += 18;

      const procedureRows: Array<[string, string | null]> = [
        ["Date of Examination", tdptReport.tdptDateOfExamination
          ? new Date(tdptReport.tdptDateOfExamination).toISOString().slice(0, 10)
          : null],
        ["Testing Standard", tdptReport.tdptTestingStandard],
        ["Acceptance Criteria", tdptReport.tdptAcceptanceCriteria],
        ["Surface Preparation", tdptReport.tdptSurfacePreparation],
        ["Surface Temperature", tdptReport.tdptSurfaceTemperature],
        ["Penetrant Type", tdptReport.tdptPenetrantType],
        ["Penetrant Process", tdptReport.tdptPenetrantProcess],
        ["Method of Pre-cleaning", tdptReport.tdptMethodOfPreCleaning],
        ["Drying Time After Pre-cleaning", tdptReport.tdptDryingTimeAfterPreCleaning],
        ["Method of Applying Penetrant", tdptReport.tdptMethodOfApplyingPenetrant],
        ["Penetrating Time", tdptReport.tdptPenetratingTime],
        ["Method of Removing Excess Penetrant", tdptReport.tdptMethodOfRemovingExcessPenetrant],
        ["Method of Applying Developer", tdptReport.tdptMethodOfApplyingDeveloper],
        ["Development Time", tdptReport.tdptDevelopmentTime],
        ["Interpretation Time", tdptReport.tdptInterpretationTime],
        ["Lighting Equipment", tdptReport.tdptLightingEquipment],
        ["Post Cleaning", tdptReport.tdptPostCleaning],
      ];

      const procLabelW = (pageW - 2 * MARGIN) * 0.38;
      const procValueW = (pageW - 2 * MARGIN) - procLabelW;
      const procUsableW = pageW - 2 * MARGIN;

      for (const [label, value] of procedureRows) {
        if (y + procRowH > pageMaxY) { y = addNewPage(); }
        doc.rect(MARGIN, y, procLabelW, procRowH).fill("#fdf4ff");
        doc.rect(MARGIN + procLabelW, y, procValueW, procRowH).fill("#ffffff");
        doc.rect(MARGIN, y, procUsableW, procRowH).stroke(TABLE_OUTER_BORDER);
        doc.moveTo(MARGIN + procLabelW, y).lineTo(MARGIN + procLabelW, y + procRowH).stroke(TABLE_INNER_BORDER);
        doc.font(FONT_BOLD).fontSize(8.5).fillColor("#000");
        doc.text(label, MARGIN + 4, y + 5, { width: procLabelW - 8 });
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

    // ─── 2. CONSUMABLE DETAILS ───
    // 3 rows (Solvent / Penetrant / Developer) × 5 columns.
    {
      const consHeaderH = 36;
      const consRowH = 18;
      if (y + 24 + consHeaderH + consRowH > pageMaxY) { y = addNewPage(); }
      y += 4;
      doc.font(FONT_BOLD).fontSize(FONT_SIZE_SUB).fillColor(tdptAccent);
      doc.text(`{tdptBranch.sub("Consumable Details") + " Consumable Details"}`, MARGIN, y);
      doc.fillColor("#000");
      y += 18;

      const consUsable = pageW - 2 * MARGIN;
      const consColWidths = orientation === "landscape"
        ? [70, 130, 210, 130, Math.max(100, consUsable - 70 - 130 - 210 - 130)]
        : [55, 90, 150, 90, Math.max(80, consUsable - 55 - 90 - 150 - 90)];
      const consHeaders = ["Consumable", "Make", "Product / Description", "Batch Number", "Expiry Date"];

      drawDptTableHeader(doc, consHeaders, consColWidths, y, pageW);
      y += consHeaderH;

      const consumableRows: Array<[string, string | null, string | null, string | null, string | null]> = [
        ["Solvent", tdptReport.tdptSolventMake, tdptReport.tdptSolventProduct, tdptReport.tdptSolventBatchNo, tdptReport.tdptSolventExpiry],
        ["Penetrant", tdptReport.tdptPenetrantMake, tdptReport.tdptPenetrantProduct, tdptReport.tdptPenetrantBatchNo, tdptReport.tdptPenetrantExpiry],
        ["Developer", tdptReport.tdptDeveloperMake, tdptReport.tdptDeveloperProduct, tdptReport.tdptDeveloperBatchNo, tdptReport.tdptDeveloperExpiry],
      ];

      for (const row of consumableRows) {
        if (y + consRowH > pageMaxY) {
          addNewPage();
          drawDptTableHeader(doc, consHeaders, consColWidths, contentTopY, pageW);
          y = contentTopY + consHeaderH;
        }
        doc.rect(MARGIN, y, consUsable, consRowH).stroke(TABLE_OUTER_BORDER);
        let cx = MARGIN;
        for (let i = 0; i < consHeaders.length; i++) {
          const w = consColWidths[i];
          if (i > 0) {
            doc.moveTo(cx, y).lineTo(cx, y + consRowH).stroke(TABLE_INNER_BORDER);
          }
          doc.font(i === 0 ? FONT_BOLD : FONT_REGULAR).fontSize(8).fillColor("#000");
          const cellText = (row[i] && String(row[i]).trim()) ? String(row[i]).trim() : (i === 0 ? "" : "—");
          const maxW = w - 8;
          let displayText = cellText;
          if (doc.widthOfString(displayText) > maxW) {
            const charsToKeep = Math.floor((maxW / Math.max(1, doc.widthOfString(displayText))) * displayText.length);
            displayText = displayText.slice(0, Math.max(1, charsToKeep - 1)) + "…";
          }
          doc.text(displayText, cx + 4, y + 5, { width: maxW, align: "left" });
          cx += w;
        }
        doc.fillColor("#000");
        y += consRowH;
      }
      y += 10;
    }

    // ─── 3. DYE PENETRANT TESTING DETAILS ───
    // Table: Sl. No | Part Details | ID | Weld Dimension | Size of
    // Indication Approx. (mm) | Observation & Result. Rows come from the
    // tank's own tdptObservationRows JSON column.
    {
      let tdptObs: Array<Record<string, string>> = [];
      try {
        const parsed = JSON.parse(tdptReport.tdptObservationRows ?? "[]");
        if (Array.isArray(parsed)) tdptObs = parsed;
      } catch {}
      const vHeaderH = 36;
      const vRowH = 28;
      const vUsable = pageW - 2 * MARGIN;
      const vSlW = 36;
      const vPartW = orientation === "landscape" ? 150 : 110;
      const vIdW = orientation === "landscape" ? 70 : 55;
      const vDimW = orientation === "landscape" ? 100 : 80;
      const vSizeW = orientation === "landscape" ? 85 : 75;
      const vObsW = Math.max(100, vUsable - vSlW - vPartW - vIdW - vDimW - vSizeW);
      const vColWidths = [vSlW, vPartW, vIdW, vDimW, vSizeW, vObsW];
      const vHeaders = ["Sl.\nNo", "Part Details", "ID", "Weld\nDimension", "Size of Indication\nApprox. (mm)", "Observation & Result"];

      if (y + 24 + vHeaderH + vRowH > pageMaxY) { y = addNewPage(); }
      y += 4;
      doc.font(FONT_BOLD).fontSize(FONT_SIZE_SUB).fillColor(tdptAccent);
      doc.text(`{tdptBranch.sub("Dye Penetrant Testing Details") + " Dye Penetrant Testing Details"}`, MARGIN, y);
      doc.fillColor("#000");
      y += 16;

      if (y + vHeaderH + vRowH > pageMaxY) { y = addNewPage(); }
      drawDptTableHeader(doc, vHeaders, vColWidths, y, pageW);
      y += vHeaderH;

      for (let ri = 0; ri < tdptObs.length; ri++) {
        const obs = tdptObs[ri];
        if (y + vRowH > pageMaxY) {
          addNewPage();
          drawDptTableHeader(doc, vHeaders, vColWidths, contentTopY, pageW);
          y = contentTopY + vHeaderH;
        }
        doc.rect(MARGIN, y, vUsable, vRowH).stroke(TABLE_OUTER_BORDER);
        const cells: string[] = [
          String(ri + 1),
          obs.partDetails ?? "—",
          obs.idNo ?? "—",
          obs.weldDimension ?? "—",
          obs.indicationSize ?? "—",
          obs.observationResult ?? "—",
        ];
        let cx = MARGIN;
        for (let i = 0; i < cells.length; i++) {
          const w = vColWidths[i];
          if (i > 0) {
            doc.moveTo(cx, y).lineTo(cx, y + vRowH).stroke(TABLE_INNER_BORDER);
          }
          doc.font(FONT_REGULAR).fontSize(8).fillColor("#000");
          const maxW = w - 8;
          let displayText = cells[i] ?? "—";
          if (doc.widthOfString(displayText) > maxW) {
            const charsToKeep = Math.floor((maxW / Math.max(1, doc.widthOfString(displayText))) * displayText.length);
            displayText = displayText.slice(0, Math.max(1, charsToKeep - 1)) + "…";
          }
          doc.text(displayText, cx + 4, y + 5, { width: maxW, align: i === 0 ? "center" : "left" });
          cx += w;
        }
        doc.fillColor("#000");
        y += vRowH;
      }

      if (tdptObs.length === 0) {
        doc.font(FONT_REGULAR).fontSize(8).fillColor("#666");
        doc.rect(MARGIN, y, vUsable, vRowH).stroke("#bbb");
        doc.text("No DPT details recorded.", MARGIN + 4, y + 9, { width: vUsable - 8, align: "center" });
        doc.fillColor("#000");
        y += vRowH;
      }
    }
  } else if (reportType === "TANK_MPT") {
    // ─── TANK MPT REPORT BODY (Tank equipment — Storage Tank) ───
    // Completely separate from the Vessel MPT branch above — renders the
    // same section ORDER but from the tank's own tmpt* fields:
    //   1. "Magnetic Particle Testing Parameters" — two-column table.
    //   2. "Consumable Details" — 2-row grid (White Contrast / Wet
    //      Particle Iron Ink) × Make / Product / Lot Number / Expiry.
    //   3. "Magnetic Particle Testing Details" — rows from the tank's
    //      own tmptRows JSON column.
    //   4. Photographs are handled by the shared photo-gallery section.
    startBodyOnFreshPage(160);

    const tmptReport = report as any;
    const tmptBranch = makeTocBranch("Magnetic Particle Testing");
    currentTestBranch = tmptBranch;
    const tmptAccent = "#92400e"; // amber-800 — matches the Tank MPT UI accent

    // ─── 1. MAGNETIC PARTICLE TESTING PARAMETERS ───
    {
      const procRowH = 18;
      if (y + 24 + procRowH > pageMaxY) { y = addNewPage(); }
      y += 6;
      doc.font(FONT_BOLD).fontSize(FONT_SIZE_SUB).fillColor(tmptAccent);
      doc.text(`{tmptBranch.sub("Magnetic Particle Testing Parameters") + " Magnetic Particle Testing Parameters"}`, MARGIN, y);
      doc.fillColor("#000");
      y += 18;

      const procedureRows: Array<[string, string | null]> = [
        ["Date of Examination", tmptReport.tmptDateOfExamination
          ? new Date(tmptReport.tmptDateOfExamination).toISOString().slice(0, 10)
          : null],
        ["Testing Standard", tmptReport.tmptTestingStandard],
        ["Acceptance Criteria", tmptReport.tmptAcceptanceCriteria],
        ["Surface Preparation", tmptReport.tmptSurfacePreparation],
        ["Surface Temperature", tmptReport.tmptSurfaceTemperature],
        ["Type of Instrument / Sl. No.", tmptReport.tmptInstrumentSerialNo],
        ["MPT Method", tmptReport.tmptMethod],
        ["Type of Current", tmptReport.tmptTypeOfCurrent],
        ["AC Yoke Lifting Capacity", tmptReport.tmptAcYokeLiftingCapacity],
        ["Contrast Medium", tmptReport.tmptContrastMedium],
        ["Method of Pre-cleaning", tmptReport.tmptMethodOfPreCleaning],
        ["Method of Applying White Contrast", tmptReport.tmptMethodOfApplyingWhiteContrast],
        ["AC Yoke Pole Spacing", tmptReport.tmptAcYokePoleSpacing],
        ["Magnetic Medium", tmptReport.tmptMagneticMedium],
        ["Method of Applying Magnetic Medium", tmptReport.tmptMethodOfApplyingMagneticMedium],
        ["Development Time", tmptReport.tmptDevelopmentTime],
        ["Interpretation Time", tmptReport.tmptInterpretationTime],
        ["Lighting Equipment", tmptReport.tmptLightingEquipment],
        ["Post Cleaning", tmptReport.tmptPostCleaning],
      ];

      const procLabelW = (pageW - 2 * MARGIN) * 0.38;
      const procValueW = (pageW - 2 * MARGIN) - procLabelW;
      const procUsableW = pageW - 2 * MARGIN;

      for (const [label, value] of procedureRows) {
        if (y + procRowH > pageMaxY) { y = addNewPage(); }
        doc.rect(MARGIN, y, procLabelW, procRowH).fill("#fffbeb");
        doc.rect(MARGIN + procLabelW, y, procValueW, procRowH).fill("#ffffff");
        doc.rect(MARGIN, y, procUsableW, procRowH).stroke(TABLE_OUTER_BORDER);
        doc.moveTo(MARGIN + procLabelW, y).lineTo(MARGIN + procLabelW, y + procRowH).stroke(TABLE_INNER_BORDER);
        doc.font(FONT_BOLD).fontSize(8.5).fillColor("#000");
        doc.text(label, MARGIN + 4, y + 5, { width: procLabelW - 8 });
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

    // ─── 2. CONSUMABLE DETAILS ───
    // 2 rows (White Contrast / Wet Particle Iron Ink) × 5 columns.
    {
      const consHeaderH = 36;
      const consRowH = 18;
      if (y + 24 + consHeaderH + consRowH > pageMaxY) { y = addNewPage(); }
      y += 4;
      doc.font(FONT_BOLD).fontSize(FONT_SIZE_SUB).fillColor(tmptAccent);
      doc.text(`{tmptBranch.sub("Consumable Details") + " Consumable Details"}`, MARGIN, y);
      doc.fillColor("#000");
      y += 18;

      const consUsable = pageW - 2 * MARGIN;
      const consColWidths = orientation === "landscape"
        ? [100, 120, 200, 120, Math.max(100, consUsable - 100 - 120 - 200 - 120)]
        : [75, 85, 140, 85, Math.max(80, consUsable - 75 - 85 - 140 - 85)];
      const consHeaders = ["Consumable", "Make", "Product / Description", "Lot Number", "Expiry Date"];

      drawDptTableHeader(doc, consHeaders, consColWidths, y, pageW);
      y += consHeaderH;

      const consumableRows: Array<[string, string | null, string | null, string | null, string | null]> = [
        ["White Contrast", tmptReport.tmptWhiteContrastMake, tmptReport.tmptWhiteContrastProduct, tmptReport.tmptWhiteContrastLotNo, tmptReport.tmptWhiteContrastExpiry],
        ["Wet Particle Iron Ink", tmptReport.tmptInkMake, tmptReport.tmptInkProduct, tmptReport.tmptInkLotNo, tmptReport.tmptInkExpiry],
      ];

      for (const row of consumableRows) {
        if (y + consRowH > pageMaxY) {
          addNewPage();
          drawDptTableHeader(doc, consHeaders, consColWidths, contentTopY, pageW);
          y = contentTopY + consHeaderH;
        }
        doc.rect(MARGIN, y, consUsable, consRowH).stroke(TABLE_OUTER_BORDER);
        let cx = MARGIN;
        for (let i = 0; i < consHeaders.length; i++) {
          const w = consColWidths[i];
          if (i > 0) {
            doc.moveTo(cx, y).lineTo(cx, y + consRowH).stroke(TABLE_INNER_BORDER);
          }
          doc.font(i === 0 ? FONT_BOLD : FONT_REGULAR).fontSize(8).fillColor("#000");
          const cellText = (row[i] && String(row[i]).trim()) ? String(row[i]).trim() : (i === 0 ? "" : "—");
          const maxW = w - 8;
          let displayText = cellText;
          if (doc.widthOfString(displayText) > maxW) {
            const charsToKeep = Math.floor((maxW / Math.max(1, doc.widthOfString(displayText))) * displayText.length);
            displayText = displayText.slice(0, Math.max(1, charsToKeep - 1)) + "…";
          }
          doc.text(displayText, cx + 4, y + 5, { width: maxW, align: "left" });
          cx += w;
        }
        doc.fillColor("#000");
        y += consRowH;
      }
      y += 10;
    }

    // ─── 3. MAGNETIC PARTICLE TESTING DETAILS ───
    // Table: Sl. No | Part Details | ID | Weld Dimension | Size of
    // Indication Approx. (mm) | Observation & Result. Rows come from the
    // tank's own tmptRows JSON column.
    {
      let tmptObs: Array<Record<string, string>> = [];
      try {
        const parsed = JSON.parse(tmptReport.tmptRows ?? "[]");
        if (Array.isArray(parsed)) tmptObs = parsed;
      } catch {}
      const vHeaderH = 36;
      const vRowH = 28;
      const vUsable = pageW - 2 * MARGIN;
      const vSlW = 36;
      const vPartW = orientation === "landscape" ? 150 : 110;
      const vIdW = orientation === "landscape" ? 70 : 55;
      const vDimW = orientation === "landscape" ? 100 : 80;
      const vSizeW = orientation === "landscape" ? 85 : 75;
      const vObsW = Math.max(100, vUsable - vSlW - vPartW - vIdW - vDimW - vSizeW);
      const vColWidths = [vSlW, vPartW, vIdW, vDimW, vSizeW, vObsW];
      const vHeaders = ["Sl.\nNo", "Part Details", "ID", "Weld\nDimension", "Size of Indication\nApprox. (mm)", "Observation & Result"];

      if (y + 24 + vHeaderH + vRowH > pageMaxY) { y = addNewPage(); }
      y += 4;
      doc.font(FONT_BOLD).fontSize(FONT_SIZE_SUB).fillColor(tmptAccent);
      doc.text(`{tmptBranch.sub("Magnetic Particle Testing Details") + " Magnetic Particle Testing Details"}`, MARGIN, y);
      doc.fillColor("#000");
      y += 16;

      if (y + vHeaderH + vRowH > pageMaxY) { y = addNewPage(); }
      drawDptTableHeader(doc, vHeaders, vColWidths, y, pageW);
      y += vHeaderH;

      for (let ri = 0; ri < tmptObs.length; ri++) {
        const obs = tmptObs[ri];
        if (y + vRowH > pageMaxY) {
          addNewPage();
          drawDptTableHeader(doc, vHeaders, vColWidths, contentTopY, pageW);
          y = contentTopY + vHeaderH;
        }
        doc.rect(MARGIN, y, vUsable, vRowH).stroke(TABLE_OUTER_BORDER);
        const cells: string[] = [
          String(ri + 1),
          obs.partDetails ?? "—",
          obs.idNo ?? "—",
          obs.weldDimension ?? "—",
          obs.indicationSize ?? "—",
          obs.observationResult ?? "—",
        ];
        let cx = MARGIN;
        for (let i = 0; i < cells.length; i++) {
          const w = vColWidths[i];
          if (i > 0) {
            doc.moveTo(cx, y).lineTo(cx, y + vRowH).stroke(TABLE_INNER_BORDER);
          }
          doc.font(FONT_REGULAR).fontSize(8).fillColor("#000");
          const maxW = w - 8;
          let displayText = cells[i] ?? "—";
          if (doc.widthOfString(displayText) > maxW) {
            const charsToKeep = Math.floor((maxW / Math.max(1, doc.widthOfString(displayText))) * displayText.length);
            displayText = displayText.slice(0, Math.max(1, charsToKeep - 1)) + "…";
          }
          doc.text(displayText, cx + 4, y + 5, { width: maxW, align: i === 0 ? "center" : "left" });
          cx += w;
        }
        doc.fillColor("#000");
        y += vRowH;
      }

      if (tmptObs.length === 0) {
        doc.font(FONT_REGULAR).fontSize(8).fillColor("#666");
        doc.rect(MARGIN, y, vUsable, vRowH).stroke("#bbb");
        doc.text("No MPT details recorded.", MARGIN + 4, y + 9, { width: vUsable - 8, align: "center" });
        doc.fillColor("#000");
        y += vRowH;
      }
    }
  } else if (reportType === "TANK_WELD_SCAN") {
    // ─── TANK WELD SCAN REPORT BODY (Tank equipment — Storage Tank) ───
    // Completely separate from the Vessel Weld Scan branch above —
    // renders the same section ORDER but from the tank's own tws* fields:
    //   1. "Weld Scan Testing Parameters" — grouped two-column table
    //      (General Information / Equipment Details / Cable Details /
    //      Calibration Details / Other Testing Parameters).
    //   2. "Probe Details" — fixed 4-probe grid.
    //   3. "Weld Scan Testing Details" — Tank column set: Sl. No |
    //      Course / Plate | Weld Seam ID | Weld Dimension | Probe Angle |
    //      Probe Frequency | Observation & Result (twsDetailRows JSON).
    //   4. Photographs are handled by the shared photo-gallery section.
    startBodyOnFreshPage(200);

    const twsReport = report as any;
    const twsBranch = makeTocBranch("Weld Scan");
    currentTestBranch = twsBranch;
    const twsUsableW = pageW - 2 * MARGIN;
    const twsAccent = "#0369a1"; // sky-700 — matches the Tank Weld Scan UI accent

    // Helper: draw one two-column label/value row. Group header rows are
    // drawn as full-width tinted rows.
    const twsRowH = 18;
    const twsLabelW = twsUsableW * 0.38;
    const twsValueW = twsUsableW - twsLabelW;
    const drawTwsGroupHeader = (title: string) => {
      if (y + twsRowH > pageMaxY) { y = addNewPage(); }
      doc.rect(MARGIN, y, twsUsableW, twsRowH).fill("#f0f9ff");
      doc.rect(MARGIN, y, twsUsableW, twsRowH).stroke(TABLE_OUTER_BORDER);
      doc.font(FONT_BOLD).fontSize(8.5).fillColor(twsAccent);
      doc.text(title, MARGIN + 4, y + 5, { width: twsUsableW - 8 });
      doc.fillColor("#000");
      y += twsRowH;
    };
    const drawTwsParamRow = (label: string, value: string | null | undefined, isDate = false) => {
      if (y + twsRowH > pageMaxY) { y = addNewPage(); }
      doc.rect(MARGIN, y, twsLabelW, twsRowH).fill("#f8fafc");
      doc.rect(MARGIN + twsLabelW, y, twsValueW, twsRowH).fill("#ffffff");
      doc.rect(MARGIN, y, twsUsableW, twsRowH).stroke(TABLE_OUTER_BORDER);
      doc.moveTo(MARGIN + twsLabelW, y).lineTo(MARGIN + twsLabelW, y + twsRowH).stroke(TABLE_INNER_BORDER);
      doc.font(FONT_BOLD).fontSize(8.5).fillColor("#000");
      doc.text(label, MARGIN + 4, y + 5, { width: twsLabelW - 8 });
      doc.font(FONT_REGULAR).fontSize(8.5).fillColor("#000");
      let displayText = value && String(value).trim() ? String(value).trim() : "";
      if (isDate && displayText) {
        try { displayText = new Date(displayText).toISOString().slice(0, 10); } catch {}
      }
      if (!displayText) displayText = "";
      const maxW = twsValueW - 8;
      if (doc.widthOfString(displayText) > maxW) {
        const charsToKeep = Math.floor((maxW / Math.max(1, doc.widthOfString(displayText))) * displayText.length);
        displayText = displayText.slice(0, Math.max(1, charsToKeep - 1)) + "…";
      }
      doc.text(displayText, MARGIN + twsLabelW + 4, y + 5, { width: maxW });
      y += twsRowH;
    };

    // ─── 1. WELD SCAN TESTING PARAMETERS ───
    {
      if (y + 24 + twsRowH > pageMaxY) { y = addNewPage(); }
      y += 6;
      doc.font(FONT_BOLD).fontSize(FONT_SIZE_SUB).fillColor(twsAccent);
      doc.text(`{twsBranch.sub("Weld Scan Testing Parameters") + " Weld Scan Testing Parameters"}`, MARGIN, y);
      doc.fillColor("#000");
      y += 18;

      drawTwsGroupHeader("General Information");
      drawTwsParamRow("Date of Examination", twsReport.twsDateOfExamination, true);
      drawTwsParamRow("Testing Standard", twsReport.twsTestingStandard);
      drawTwsParamRow("Acceptance Criteria", twsReport.twsAcceptanceCriteria);
      drawTwsParamRow("UT Procedure", twsReport.twsUtProcedure);

      drawTwsGroupHeader("Equipment Details");
      drawTwsParamRow("Equipment Make", twsReport.twsEquipmentMake);
      drawTwsParamRow("Equipment Model", twsReport.twsEquipmentModel);
      drawTwsParamRow("Equipment Serial Number", twsReport.twsEquipmentSerialNo);
      drawTwsParamRow("Calibration Due Date", twsReport.twsCalibrationDueDate, true);

      drawTwsGroupHeader("Cable Details");
      drawTwsParamRow("Cable Length", twsReport.twsCableLength);
      drawTwsParamRow("Cable Type", twsReport.twsCableType);

      drawTwsGroupHeader("Calibration Details");
      drawTwsParamRow("Calibration Block", twsReport.twsCalibrationBlock);
      drawTwsParamRow("Calibration Block Material / MOC", twsReport.twsCalibrationBlockMoc);
      drawTwsParamRow("Reference Reflector", twsReport.twsReferenceReflector);
      drawTwsParamRow("Reference Level", twsReport.twsReferenceLevel);

      drawTwsGroupHeader("Other Testing Parameters");
      drawTwsParamRow("Flaw Sizing Technique", twsReport.twsFlawSizingTechnique);
      drawTwsParamRow("Surface Temperature", twsReport.twsSurfaceTemperature);
      drawTwsParamRow("Method", twsReport.twsTestingMethod);
      drawTwsParamRow("Couplant", twsReport.twsCouplant);
      drawTwsParamRow("Surface Preparation", twsReport.twsSurfacePreparation);
      drawTwsParamRow("Surface Finish", twsReport.twsSurfaceFinish);
      drawTwsParamRow("Extent of Scanning", twsReport.twsExtentOfScanning);
      y += 8;
    }

    // ─── 2. PROBE DETAILS (fixed 4-probe grid) ───
    {
      let twsProbes: Array<Record<string, string>> = [];
      try {
        const parsed = JSON.parse(twsReport.twsProbeDetails ?? "[]");
        if (Array.isArray(parsed)) twsProbes = parsed;
      } catch {}
      const pHeaderH = 22;
      const pRowH = 20;
      const pUsable = pageW - 2 * MARGIN;
      const pColWidths = orientation === "landscape"
        ? [170, 80, 130, 130, Math.max(120, pUsable - 170 - 80 - 130 - 130)]
        : [130, 65, 95, 95, Math.max(90, pUsable - 130 - 65 - 95 - 95)];
      const pHeaders = ["Probe", "Probe Angle", "Frequency", "Probe Size", "Serial Number"];

      if (y + 24 + pHeaderH + pRowH > pageMaxY) { y = addNewPage(); }
      y += 4;
      doc.font(FONT_BOLD).fontSize(FONT_SIZE_SUB).fillColor(twsAccent);
      doc.text(`{twsBranch.sub("Probe Details") + " Probe Details"}`, MARGIN, y);
      doc.fillColor("#000");
      y += 16;

      const drawTwsProbeHeader = (headerY: number) => {
        doc.rect(MARGIN, headerY, pUsable, pHeaderH).fill(TABLE_HEADER_BG);
        doc.rect(MARGIN, headerY, pUsable, pHeaderH).stroke(TABLE_OUTER_BORDER);
        let x = MARGIN;
        doc.font(FONT_BOLD).fontSize(7.5).fillColor(TABLE_HEADER_FG);
        for (let i = 0; i < pHeaders.length; i++) {
          if (i > 0) doc.moveTo(x, headerY).lineTo(x, headerY + pHeaderH).stroke(TABLE_INNER_BORDER);
          doc.text(pHeaders[i], x + 2, headerY + 8, { width: pColWidths[i] - 4, align: "center" });
          x += pColWidths[i];
        }
        doc.fillColor("#000");
      };
      drawTwsProbeHeader(y);
      y += pHeaderH;

      for (const probe of twsProbes) {
        if (y + pRowH > pageMaxY) {
          addNewPage();
          drawTwsProbeHeader(MARGIN);
          y = contentTopY + pHeaderH;
        }
        doc.rect(MARGIN, y, pUsable, pRowH).stroke(TABLE_OUTER_BORDER);
        const cells = [
          probe.probeType === "Longitudinal Wave" ? "Longitudinal Wave Probe" : "Shear Wave Probe",
          probe.probeAngle ?? "",
          probe.frequency ?? "",
          probe.probeSize ?? "",
          probe.serialNo ?? "",
        ];
        let cx = MARGIN;
        for (let i = 0; i < pHeaders.length; i++) {
          if (i > 0) doc.moveTo(cx, y).lineTo(cx, y + pRowH).stroke(TABLE_INNER_BORDER);
          doc.font(i === 0 ? FONT_BOLD : FONT_REGULAR).fontSize(7.5).fillColor("#000");
          let disp = String(cells[i] ?? "");
          const maxW = pColWidths[i] - 8;
          if (doc.widthOfString(disp) > maxW) {
            const c = Math.floor((maxW / Math.max(1, doc.widthOfString(disp))) * disp.length);
            disp = disp.slice(0, Math.max(1, c - 1)) + "…";
          }
          doc.text(disp, cx + 4, y + 6, { width: maxW, align: i === 0 ? "left" : "center" });
          cx += pColWidths[i];
        }
        doc.fillColor("#000");
        y += pRowH;
      }
      y += 10;
    }

    // ─── 3. WELD SCAN TESTING DETAILS (Tank column set) ───
    {
      let twsObs: Array<Record<string, string>> = [];
      try {
        const parsed = JSON.parse(twsReport.twsDetailRows ?? "[]");
        if (Array.isArray(parsed)) twsObs = parsed;
      } catch {}
      const dHeaderH = 30;
      const dRowH = 30;
      const dUsable = pageW - 2 * MARGIN;
      const dSlW = 30;
      const dCompW = orientation === "landscape" ? 110 : 85;
      const dWeldW = orientation === "landscape" ? 130 : 100;
      const dDimW = orientation === "landscape" ? 110 : 85;
      const dAngleW = 55;
      const dFreqW = orientation === "landscape" ? 80 : 65;
      const dObsW = Math.max(110, dUsable - dSlW - dCompW - dWeldW - dDimW - dAngleW - dFreqW);
      const dColWidths = [dSlW, dCompW, dWeldW, dDimW, dAngleW, dFreqW, dObsW];
      const dHeaders = ["Sl.\nNo", "Course / Plate", "Weld Seam ID", "Weld Dimension", "Probe\nAngle", "Probe Frequency", "Observation & Result"];

      if (y + 24 + dHeaderH + dRowH > pageMaxY) { y = addNewPage(); }
      y += 4;
      doc.font(FONT_BOLD).fontSize(FONT_SIZE_SUB).fillColor(twsAccent);
      doc.text(`{twsBranch.sub("Weld Scan Testing Details") + " Weld Scan Testing Details"}`, MARGIN, y);
      doc.fillColor("#000");
      y += 16;

      const drawTwsDetailsHeader = (headerY: number) => {
        doc.rect(MARGIN, headerY, dUsable, dHeaderH).fill(TABLE_HEADER_BG);
        doc.rect(MARGIN, headerY, dUsable, dHeaderH).stroke(TABLE_OUTER_BORDER);
        let x = MARGIN;
        doc.font(FONT_BOLD).fontSize(7).fillColor(TABLE_HEADER_FG);
        for (let i = 0; i < dHeaders.length; i++) {
          if (i > 0) doc.moveTo(x, headerY).lineTo(x, headerY + dHeaderH).stroke(TABLE_INNER_BORDER);
          doc.text(dHeaders[i], x + 2, headerY + 8, { width: dColWidths[i] - 4, align: "center" });
          x += dColWidths[i];
        }
        doc.fillColor("#000");
      };
      drawTwsDetailsHeader(y);
      y += dHeaderH;

      for (let ri = 0; ri < twsObs.length; ri++) {
        const obs = twsObs[ri];
        if (y + dRowH > pageMaxY) {
          addNewPage();
          drawTwsDetailsHeader(MARGIN);
          y = contentTopY + dHeaderH;
        }
        doc.rect(MARGIN, y, dUsable, dRowH).stroke(TABLE_OUTER_BORDER);
        const cells: string[] = [
          String(ri + 1),
          obs.component ?? "",
          obs.plateWeldId ?? "",
          obs.weldDimension ?? "",
          obs.probeAngle ?? "",
          obs.probeFrequency ?? "",
          obs.observationResult ?? "",
        ];
        let cx = MARGIN;
        for (let i = 0; i < dHeaders.length; i++) {
          if (i > 0) doc.moveTo(cx, y).lineTo(cx, y + dRowH).stroke(TABLE_INNER_BORDER);
          doc.font(i === 0 ? FONT_BOLD : FONT_REGULAR).fontSize(7).fillColor("#000");
          let disp = String(cells[i] ?? "");
          const maxW = dColWidths[i] - 8;
          if (doc.widthOfString(disp) > maxW) {
            const c = Math.floor((maxW / Math.max(1, doc.widthOfString(disp))) * disp.length);
            disp = disp.slice(0, Math.max(1, c - 1)) + "…";
          }
          doc.text(disp, cx + 4, y + 5, { width: maxW, align: i === 0 ? "center" : "left" });
          cx += dColWidths[i];
        }
        doc.fillColor("#000");
        y += dRowH;
      }
      if (twsObs.length === 0) {
        doc.font(FONT_REGULAR).fontSize(8.5).fillColor("#6b7280");
        doc.text("No weld scan testing details recorded.", MARGIN, y + 4);
        doc.fillColor("#000");
        y += 20;
      }
      y += 6;
    }
  } else if (reportType === "TANK_UTM") {
    // ─── TANK UT THICKNESS MEASUREMENT REPORT BODY (Tank equipment —
    // Storage Tank) ─── Completely separate from the Vessel UT Thickness
    // Measurement branch above — renders the same section ORDER but from
    // the tank's own tutm* fields:
    //   1. Equipment Type / Inspection lines ("Equipment Type: Tank",
    //      "Inspection: UT Thickness Measurement").
    //   2. "UT Thickness Measurement Parameters" — grouped two-column
    //      table (General Information / Equipment Details / Cable &
    //      Crystal Details / Calibration Details / Other Testing
    //      Parameters).
    //   3. "Probe Details — Longitudinal Wave (0°)" — repeatable probe
    //      grid (Frequency / Size / S.No. per row).
    //   4. "UT Thickness Measurement Readings" — course/plate clock-
    //      position table (12 / 3 / 6 / 9 o'clock readings + auto-
    //      calculated Minimum Measured Thickness, recomputed from the
    //      stored readings).
    //   5. Photographs are handled by the shared photo-gallery section.
    startBodyOnFreshPage(240);

    const tutmReport = report as any;
    const tutmBranch = makeTocBranch("UT Thickness Measurement");
    currentTestBranch = tutmBranch;
    const tutmUsableW = pageW - 2 * MARGIN;
    const tutmAccent = "#115e59"; // teal-800 — matches the Tank UT Thickness UI accent

    const tutmRowH = 18;
    const tutmLabelW = tutmUsableW * 0.38;
    const tutmValueW = tutmUsableW - tutmLabelW;
    const drawTutmGroupHeader = (title: string) => {
      if (y + tutmRowH > pageMaxY) { y = addNewPage(); }
      doc.rect(MARGIN, y, tutmUsableW, tutmRowH).fill("#f0fdfa");
      doc.rect(MARGIN, y, tutmUsableW, tutmRowH).stroke(TABLE_OUTER_BORDER);
      doc.font(FONT_BOLD).fontSize(8.5).fillColor(tutmAccent);
      doc.text(title, MARGIN + 4, y + 5, { width: tutmUsableW - 8 });
      doc.fillColor("#000");
      y += tutmRowH;
    };
    const drawTutmParamRow = (label: string, value: string | null | undefined, isDate = false) => {
      if (y + tutmRowH > pageMaxY) { y = addNewPage(); }
      doc.rect(MARGIN, y, tutmLabelW, tutmRowH).fill("#f8fafc");
      doc.rect(MARGIN + tutmLabelW, y, tutmValueW, tutmRowH).fill("#ffffff");
      doc.rect(MARGIN, y, tutmUsableW, tutmRowH).stroke(TABLE_OUTER_BORDER);
      doc.moveTo(MARGIN + tutmLabelW, y).lineTo(MARGIN + tutmLabelW, y + tutmRowH).stroke(TABLE_INNER_BORDER);
      doc.font(FONT_BOLD).fontSize(8.5).fillColor("#000");
      doc.text(label, MARGIN + 4, y + 5, { width: tutmLabelW - 8 });
      doc.font(FONT_REGULAR).fontSize(8.5).fillColor("#000");
      let displayText = value && String(value).trim() ? String(value).trim() : "";
      if (isDate && displayText) {
        try { displayText = new Date(displayText).toISOString().slice(0, 10); } catch {}
      }
      const maxW = tutmValueW - 8;
      if (doc.widthOfString(displayText) > maxW) {
        const charsToKeep = Math.floor((maxW / Math.max(1, doc.widthOfString(displayText))) * displayText.length);
        displayText = displayText.slice(0, Math.max(1, charsToKeep - 1)) + "…";
      }
      doc.text(displayText, MARGIN + tutmLabelW + 4, y + 5, { width: maxW });
      y += tutmRowH;
    };

    // ─── 1. EQUIPMENT TYPE / INSPECTION LINE ───
    {
      const lines = [
        "Equipment Type: Tank (Storage Tank)",
        "Inspection: UT Thickness Measurement",
      ];
      for (const line of lines) {
        if (y + 14 > pageMaxY) { y = addNewPage(); }
        doc.font(FONT_BOLD).fontSize(9).fillColor(tutmAccent);
        doc.text(line, MARGIN, y);
        doc.fillColor("#000");
        y += 13;
      }
    }

    // ─── 2. UT THICKNESS MEASUREMENT PARAMETERS ───
    {
      if (y + 24 + tutmRowH > pageMaxY) { y = addNewPage(); }
      y += 6;
      doc.font(FONT_BOLD).fontSize(FONT_SIZE_SUB).fillColor(tutmAccent);
      doc.text(`{tutmBranch.sub("UT Thickness Measurement Parameters") + " UT Thickness Measurement Parameters"}`, MARGIN, y);
      doc.fillColor("#000");
      y += 18;

      drawTutmGroupHeader("General Information");
      drawTutmParamRow("Date of Examination", tutmReport.tutmDateOfExamination, true);
      drawTutmParamRow("Testing Standard", tutmReport.tutmTestingStandard);
      drawTutmParamRow("Acceptance Criteria", tutmReport.tutmAcceptanceCriteria);
      drawTutmParamRow("UT Procedure", tutmReport.tutmUtProcedure);

      drawTutmGroupHeader("Equipment Details");
      drawTutmParamRow("Equipment Make", tutmReport.tutmEquipmentMake);
      drawTutmParamRow("Equipment Model", tutmReport.tutmEquipmentModel);
      drawTutmParamRow("Equipment Serial Number", tutmReport.tutmEquipmentSerialNo);
      drawTutmParamRow("Calibration Due Date", tutmReport.tutmCalibrationDueDate, true);

      drawTutmGroupHeader("Cable & Crystal Details");
      drawTutmParamRow("Cable Length and Type", tutmReport.tutmCableLengthAndType);
      drawTutmParamRow("Type of Crystal", tutmReport.tutmTypeOfCrystal);

      drawTutmGroupHeader("Calibration Details");
      drawTutmParamRow("Calibration Block Dimension / MOC", tutmReport.tutmCalibrationBlock);

      drawTutmGroupHeader("Other Testing Parameters");
      drawTutmParamRow("Surface Temperature", tutmReport.tutmSurfaceTemperature);
      drawTutmParamRow("Method", tutmReport.tutmMethod);
      drawTutmParamRow("Couplant", tutmReport.tutmCouplant);
      drawTutmParamRow("Surface Preparation", tutmReport.tutmSurfacePreparation);
      drawTutmParamRow("Surface Finish", tutmReport.tutmSurfaceFinish);
      y += 8;
    }

    // ─── 3. PROBE DETAILS (repeatable Longitudinal Wave 0° grid) ───
    {
      let tutmProbes: Array<Record<string, unknown>> = [];
      try {
        const parsed = JSON.parse(tutmReport.tutmLwProbeRows ?? "[]");
        if (Array.isArray(parsed) && parsed.length > 0) tutmProbes = parsed;
      } catch {}
      const pHeaderH = 20;
      const pRowH = 20;
      const pUsable = tutmUsableW;
      const pColWidths = orientation === "landscape"
        ? [170, 80, 130, 120, Math.max(120, pUsable - 170 - 80 - 130 - 120)]
        : [120, 55, 90, 85, Math.max(85, pUsable - 120 - 55 - 90 - 85)];
      const pHeaders = ["Probe", "Probe Angle", "Frequency", "Size", "S.No."];

      if (y + 24 + pHeaderH + pRowH > pageMaxY) { y = addNewPage(); }
      y += 4;
      doc.font(FONT_BOLD).fontSize(FONT_SIZE_SUB).fillColor(tutmAccent);
      doc.text(`{tutmBranch.sub("Probe Details — Longitudinal Wave (0°)") + " Probe Details — Longitudinal Wave (0°)"}`, MARGIN, y);
      doc.fillColor("#000");
      y += 16;

      const drawTutmProbeHeader = (headerY: number) => {
        doc.rect(MARGIN, headerY, pUsable, pHeaderH).fill(TABLE_HEADER_BG);
        doc.rect(MARGIN, headerY, pUsable, pHeaderH).stroke(TABLE_OUTER_BORDER);
        let x = MARGIN;
        doc.font(FONT_BOLD).fontSize(7.5).fillColor(TABLE_HEADER_FG);
        for (let i = 0; i < pHeaders.length; i++) {
          if (i > 0) doc.moveTo(x, headerY).lineTo(x, headerY + pHeaderH).stroke(TABLE_INNER_BORDER);
          doc.text(pHeaders[i], x + 2, headerY + 7, { width: pColWidths[i] - 4, align: "center" });
          x += pColWidths[i];
        }
        doc.fillColor("#000");
      };
      drawTutmProbeHeader(y);
      y += pHeaderH;

      for (const probe of tutmProbes) {
        if (y + pRowH > pageMaxY) {
          addNewPage();
          drawTutmProbeHeader(MARGIN);
          y = contentTopY + pHeaderH;
        }
        doc.rect(MARGIN, y, pUsable, pRowH).stroke(TABLE_OUTER_BORDER);
        const cells = [
          "Longitudinal Wave Probe",
          "0°",
          String(probe.frequency ?? ""),
          String(probe.probeSize ?? ""),
          String(probe.serialNo ?? ""),
        ];
        let cx = MARGIN;
        for (let i = 0; i < pHeaders.length; i++) {
          if (i > 0) doc.moveTo(cx, y).lineTo(cx, y + pRowH).stroke(TABLE_INNER_BORDER);
          doc.font(i === 0 ? FONT_BOLD : FONT_REGULAR).fontSize(7.5).fillColor("#000");
          let disp = String(cells[i] ?? "");
          const maxW = pColWidths[i] - 8;
          if (doc.widthOfString(disp) > maxW) {
            const c = Math.floor((maxW / Math.max(1, doc.widthOfString(disp))) * disp.length);
            disp = disp.slice(0, Math.max(1, c - 1)) + "…";
          }
          doc.text(disp, cx + 4, y + 6, { width: maxW, align: i === 0 ? "left" : "center" });
          cx += pColWidths[i];
        }
        doc.fillColor("#000");
        y += pRowH;
      }
      y += 10;
    }

    // ─── 4. UT THICKNESS MEASUREMENT READINGS (course/plate clock
    //     positions) ───
    {
      let tutmRows: Array<Record<string, unknown>> = [];
      try {
        const parsed = JSON.parse(tutmReport.tutmPlateRows ?? "[]");
        if (Array.isArray(parsed)) tutmRows = parsed;
      } catch {}

      if (y + 24 + 30 > pageMaxY) { y = addNewPage(); }
      y += 4;
      doc.font(FONT_BOLD).fontSize(FONT_SIZE_SUB).fillColor(tutmAccent);
      doc.text(`{tutmBranch.sub("UT Thickness Measurement Readings") + " UT Thickness Measurement Readings"}`, MARGIN, y);
      doc.fillColor("#000");
      y += 16;

      // Generic spot-value renderer: trims, truncates, centres.
      const drawTutmCell = (
        text: string,
        x: number,
        rowY: number,
        w: number,
        rowH: number,
        align: "left" | "center" = "center",
        bold = false,
        fontSize = 7,
      ) => {
        doc.font(bold ? FONT_BOLD : FONT_REGULAR).fontSize(fontSize).fillColor("#000");
        let disp = String(text ?? "").trim();
        const maxW = w - 6;
        if (doc.widthOfString(disp) > maxW) {
          const c = Math.floor((maxW / Math.max(1, doc.widthOfString(disp))) * disp.length);
          disp = disp.slice(0, Math.max(1, c - 1)) + "…";
        }
        doc.text(disp, x + 3, rowY + (rowH - fontSize - 1) / 2 + 1, { width: maxW, align });
        doc.fillColor("#000");
      };

      const tInfoW = orientation === "landscape"
        ? { moc: 62, comp: 80, id: 60, nom: 46, min: 48 }
        : { moc: 46, comp: 58, id: 44, nom: 34, min: 38 };
      const tInfoSum = tInfoW.moc + tInfoW.comp + tInfoW.id + tInfoW.nom + tInfoW.min;
      const tClockW = Math.max(34, (tutmUsableW - tInfoSum) / 4);
      const tClockKeys = ["c12", "c3", "c6", "c9"] as const;
      const tHeaderH = 26;
      const tLineH = 8;
      const tMinRowH = 18;
      const tPad = 5;
      const tCellText = (v: unknown): string => String(v ?? "").trim();

      const drawTutmRowsHeader = (headerY: number) => {
        doc.rect(MARGIN, headerY, tutmUsableW, tHeaderH).fill(TABLE_HEADER_BG);
        doc.rect(MARGIN, headerY, tutmUsableW, tHeaderH).stroke(TABLE_OUTER_BORDER);
        let x = MARGIN;
        doc.font(FONT_BOLD).fontSize(6.5).fillColor(TABLE_HEADER_FG);
        const headers: Array<[string, number]> = [
          ["MOC", tInfoW.moc],
          ["Course / Section", tInfoW.comp],
          ["Plate / Location ID", tInfoW.id],
          ["Nominal\nThickness\n(mm)", tInfoW.nom],
          ["12 O'clock", tClockW],
          ["3 O'clock", tClockW],
          ["6 O'clock", tClockW],
          ["9 O'clock", tClockW],
          ["Minimum\nMeasured\n(mm)", tInfoW.min],
        ];
        for (let i = 0; i < headers.length; i++) {
          const [label, w] = headers[i];
          if (i > 0) doc.moveTo(x, headerY).lineTo(x, headerY + tHeaderH).stroke(TABLE_INNER_BORDER);
          doc.text(label, x + 2, headerY + 3, { width: w - 4, align: "center", lineGap: 0 });
          x += w;
        }
        doc.fillColor("#000");
      };

      if (y + 24 + tHeaderH + tMinRowH > pageMaxY) { y = addNewPage(); }
      y += 6;
      doc.font(FONT_BOLD).fontSize(9.5).fillColor(tutmAccent);
      doc.text("Course / Plate Measurements (Clock Positions)", MARGIN, y);
      doc.fillColor("#000");
      y += 14;
      drawTutmRowsHeader(y);
      y += tHeaderH;

      for (const row of tutmRows) {
        // Readings per clock position — every entered reading, blank
        // slots excluded (never rendered).
        const spotGroups = tClockKeys.map((k) => {
          const v = row[k];
          const arr = Array.isArray(v) ? (v as Array<unknown>).map((s) => tCellText(s)) : [];
          return arr;
        });
        const cells = spotGroups.map((g) => g.filter((s) => s !== ""));
        const maxLines = Math.max(1, ...cells.map((c) => c.length));
        const rowH = Math.max(tMinRowH, tPad * 2 + maxLines * tLineH);
        if (y + rowH > pageMaxY) {
          addNewPage();
          drawTutmRowsHeader(MARGIN);
          y = contentTopY + tHeaderH;
        }
        doc.rect(MARGIN, y, tutmUsableW, rowH).stroke(TABLE_OUTER_BORDER);
        const infoCells: Array<[string, number, "left" | "center", boolean]> = [
          [tCellText(row.moc), tInfoW.moc, "left", false],
          [tCellText(row.componentType), tInfoW.comp, "left", false],
          [tCellText(row.componentId), tInfoW.id, "left", false],
          [tCellText(row.nominalThickness), tInfoW.nom, "center", false],
        ];
        let cx = MARGIN;
        for (const [text, w, align, bold] of infoCells) {
          doc.moveTo(cx, y).lineTo(cx, y + rowH).stroke(TABLE_INNER_BORDER);
          drawTutmCell(text, cx, y, w, rowH, align, bold, 6.5);
          cx += w;
        }
        for (const lines of cells) {
          doc.moveTo(cx, y).lineTo(cx, y + rowH).stroke(TABLE_INNER_BORDER);
          if (lines.length === 0) {
            drawTutmCell("—", cx, y, tClockW, rowH, "center", false, 6.5);
          } else {
            // One reading per line, vertically centred in the cell.
            doc.font(FONT_REGULAR).fontSize(6.5).fillColor("#000");
            const blockH = lines.length * tLineH;
            let ly = y + Math.max(2, (rowH - blockH) / 2);
            const maxW = tClockW - 6;
            for (const line of lines) {
              let disp = line;
              if (doc.widthOfString(disp) > maxW) {
                const c = Math.floor((maxW / Math.max(1, doc.widthOfString(disp))) * disp.length);
                disp = disp.slice(0, Math.max(1, c - 1)) + "…";
              }
              doc.text(disp, cx + 3, ly, { width: maxW, align: "center" });
              ly += tLineH;
            }
            doc.fillColor("#000");
          }
          cx += tClockW;
        }
        doc.moveTo(cx, y).lineTo(cx, y + rowH).stroke(TABLE_INNER_BORDER);
        const minVal = vutmMinOfSpots(spotGroups[0], spotGroups[1], spotGroups[2], spotGroups[3]);
        drawTutmCell(minVal || "—", cx, y, tInfoW.min, rowH, "center", true, 7);
        doc.fillColor("#000");
        y += rowH;
      }
      if (tutmRows.length === 0) {
        doc.font(FONT_REGULAR).fontSize(8).fillColor("#6b7280");
        doc.text("No course / plate measurement rows recorded.", MARGIN, y + 4);
        doc.fillColor("#000");
        y += 18;
      }
      y += 8;
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
          y = addNewPage();
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
        y = addNewPage();
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
    const certBranchRef: { current: ReturnType<typeof makeTocBranch> | null } = { current: null };

    // ═══════════════════════════════════════════════════════════════
    // Certificate page layout: up to TWO certificates per page,
    // stacked vertically — first certificate in the upper half,
    // second in the lower half, with a clear gap between them.
    //   1 certificate  → full page
    //   2 certificates → one page (upper + lower)
    //   3 certificates → 2 + 1      4 → 2 + 2      5 → 2 + 2 + 1 …
    // Applied INDEPENDENTLY to Equipment and Personnel sections
    // (their certificates never share a page).
    // Aspect ratio is always preserved — pdfkit's `fit` scales the
    // image proportionally inside the slot (never stretches/crops).
    // Multi-page PDF certificates: page 1 occupies the slot, remaining
    // pages continue on their own full-area pages (with caption), and
    // the paired certificate then starts on a fresh page.
    // ═══════════════════════════════════════════════════════════════
    const CERT_CAPTION_H = 34; // title (11pt bold) + file name (8pt) + gaps
    const CERT_GAP = 24;       // vertical gap between the two certificates

    // Draw ONE certificate inside a rectangular slot (caption above the
    // image). Returns the number of extra pages a multi-page PDF
    // certificate produced (those were drawn on their own pages).
    const drawCertificateInSlot = async (
      cert: typeof certificates[0],
      slotX: number,
      slotY: number,
      slotW: number,
      slotH: number,
    ): Promise<number> => {
      // Caption: certificate title + uploaded file name
      doc.font(FONT_BOLD).fontSize(11).fillColor("#000");
      doc.text(cert.title || "Certificate", slotX, slotY, { width: slotW, align: "center" });
      doc.font(FONT_REGULAR).fontSize(8).fillColor("#444");
      doc.text(`File: ${cert.fileName}`, slotX, slotY + 16, { width: slotW, align: "center" });
      doc.fillColor("#000");

      const imgY = slotY + CERT_CAPTION_H;
      const imgH = Math.max(40, slotH - CERT_CAPTION_H);
      // Light border around the certificate's image area
      doc.rect(slotX, imgY, slotW, imgH).stroke("#ddd");

      if (!cert.filePath || !existsSync(cert.filePath)) {
        doc.font(FONT_REGULAR).fontSize(9).fillColor("#999");
        doc.text(`[File missing: ${cert.fileName}]`, slotX, imgY + imgH / 2, { width: slotW, align: "center" });
        doc.fillColor("#000");
        return 0;
      }

      const ext = (cert.fileExtension || "").toLowerCase();
      if (ext === ".pdf") {
        // Rasterize each page of the PDF certificate
        const pageBuffers = await rasterizePdfPages(cert.filePath);
        if (pageBuffers.length === 0) {
          doc.fillColor("#999").fontSize(9).font(FONT_REGULAR);
          doc.text("[Could not rasterize PDF certificate]", slotX, imgY + imgH / 2, { width: slotW, align: "center" });
          doc.fillColor("#000");
          return 0;
        }
        // Page 1 of the PDF certificate goes into the slot
        try {
          doc.image(pageBuffers[0], slotX, imgY, { fit: [slotW, imgH], align: "center", valign: "center" });
        } catch {}
        // Remaining pages of the SAME PDF certificate: full-area pages
        for (let p = 1; p < pageBuffers.length; p++) {
          addNewPage();
          doc.font(FONT_BOLD).fontSize(11).fillColor("#000");
          doc.text(cert.title || "Certificate", MARGIN, contentTopY, { width: usableW, align: "center" });
          doc.font(FONT_REGULAR).fontSize(8).fillColor("#444");
          doc.text(`File: ${cert.fileName}  |  Page ${p + 1} of ${pageBuffers.length}`, MARGIN, contentTopY + 16, { width: usableW, align: "center" });
          doc.fillColor("#000");
          const fullY = contentTopY + CERT_CAPTION_H;
          const fullH = pageMaxY - fullY;
          doc.rect(MARGIN, fullY, usableW, fullH).stroke("#ddd");
          try {
            doc.image(pageBuffers[p], MARGIN, fullY, { fit: [usableW, fullH], align: "center", valign: "center" });
          } catch {}
        }
        return pageBuffers.length - 1;
      }
      if ([".png", ".jpg", ".jpeg"].includes(ext)) {
        try {
          const imgBuf = await loadEmbeddableImage(cert.filePath);
          if (!imgBuf) throw new Error("unreadable image");
          doc.image(imgBuf, slotX, imgY, { fit: [slotW, imgH], align: "center", valign: "center" });
        } catch {
          doc.fillColor("#999").fontSize(9).font(FONT_REGULAR);
          doc.text("[Could not embed image]", slotX, imgY + imgH / 2, { width: slotW, align: "center" });
          doc.fillColor("#000");
        }
        return 0;
      }
      return 0;
    };

    // Render one certificate SECTION in chunks of two per page.
    // `firstPageTop` = Y where the first pair starts (below the section
    // heading); continuation pages start at MARGIN.
    const renderCertSection = async (
      certs: typeof certificates,
      firstPageTop: number,
    ) => {
      for (let start = 0; start < certs.length; start += 2) {
        addNewPage();
        const top = start === 0 ? firstPageTop : contentTopY;
        const availH = pageMaxY - top;
        const pair = certs.slice(start, start + 2);
        const twoUp = pair.length === 2;
        // 1 certificate → whole available area; 2 → two stacked halves
        const slotH = twoUp ? Math.floor((availH - CERT_GAP) / 2) : availH;

        // First certificate of the pair (upper half)
        const extraPages = await drawCertificateInSlot(pair[0], MARGIN, top, usableW, slotH);
        if (!twoUp) continue;

        if (extraPages > 0) {
          // The first certificate's extra PDF pages consumed the rest of
          // this page — the second certificate starts on a fresh page.
          addNewPage();
          await drawCertificateInSlot(pair[1], MARGIN, contentTopY, usableW, pageMaxY - contentTopY);
        } else {
          // Second certificate (lower half)
          const slot2Y = top + slotH + CERT_GAP;
          await drawCertificateInSlot(pair[1], MARGIN, slot2Y, usableW, slotH);
        }
      }
    };

    // ── Instrument / Equipment Certificates ──
    if (equipCerts.length > 0) {
      // Section page: "Certification" main heading + "Instrument
      // Calibration" sub-heading, with the FIRST TWO certificates below.
      addNewPage();
      if (certBranchRef.current === null) {
        certBranchRef.current = makeTocBranch("Certification");
      }
      const certBranch = certBranchRef.current;
      doc.font(FONT_BOLD).fontSize(FONT_SIZE_MAIN).fillColor("#000");
      doc.text(`${certBranch.main()}. Certification`, MARGIN, contentTopY, { width: usableW });
      doc.font(FONT_BOLD).fontSize(FONT_SIZE_SUB);
      doc.text(`${certBranch.sub("Instrument Calibration")} Instrument Calibration (${equipCerts.length})`, MARGIN, contentTopY + 26, { width: usableW });

      // The section page already has its heading drawn — start the first
      // pair below it. Instead of letting renderCertSection call
      // addNewPage() again (which would leave this heading page blank),
      // render the chunks manually here:
      {
        const firstTop = contentTopY + 66; // below the two headings
        const availH = pageMaxY - firstTop;
        const firstPair = equipCerts.slice(0, 2);
        const twoUp = firstPair.length === 2;
        const slotH = twoUp ? Math.floor((availH - CERT_GAP) / 2) : availH;
        const extraPages = await drawCertificateInSlot(firstPair[0], MARGIN, firstTop, usableW, slotH);
        if (twoUp) {
          if (extraPages > 0) {
            addNewPage();
            await drawCertificateInSlot(firstPair[1], MARGIN, contentTopY, usableW, pageMaxY - contentTopY);
          } else {
            const slot2Y = firstTop + slotH + CERT_GAP;
            await drawCertificateInSlot(firstPair[1], MARGIN, slot2Y, usableW, slotH);
          }
        }
        // Remaining certificates: 2 per page from index 2
        if (equipCerts.length > 2) {
          await renderCertSection(equipCerts.slice(2), contentTopY);
        }
      }
    }

    // ── Inspector / Personnel Certificates ──
    // NDT Level 3 first, then NDT Level 2, then any other personnel certs.
    const ndtLevel3Certs = personnelCerts.filter((c) => (c.title || "").includes("NDT Level 3"));
    const ndtLevel2Certs = personnelCerts.filter((c) => (c.title || "").includes("NDT Level 2"));
    const otherPersonnelCerts = personnelCerts.filter((c) => !ndtLevel3Certs.includes(c) && !ndtLevel2Certs.includes(c));
    const orderedPersonnelCerts = [...ndtLevel3Certs, ...ndtLevel2Certs, ...otherPersonnelCerts];

    if (orderedPersonnelCerts.length > 0) {
      // Section page: "Inspector Certificates" sub-heading + first pair
      addNewPage();
      if (certBranchRef.current === null) {
        certBranchRef.current = makeTocBranch("Certification");
      }
      doc.font(FONT_BOLD).fontSize(FONT_SIZE_SUB).fillColor("#000");
      doc.text(`${certBranchRef.current.sub("Inspector Certificates")} Inspector Certificates (${orderedPersonnelCerts.length})`, MARGIN, contentTopY, { width: usableW });

      {
        const firstTop = contentTopY + 50; // below the sub-heading
        const availH = pageMaxY - firstTop;
        const firstPair = orderedPersonnelCerts.slice(0, 2);
        const twoUp = firstPair.length === 2;
        const slotH = twoUp ? Math.floor((availH - CERT_GAP) / 2) : availH;
        const extraPages = await drawCertificateInSlot(firstPair[0], MARGIN, firstTop, usableW, slotH);
        if (twoUp) {
          if (extraPages > 0) {
            addNewPage();
            await drawCertificateInSlot(firstPair[1], MARGIN, contentTopY, usableW, pageMaxY - contentTopY);
          } else {
            const slot2Y = firstTop + slotH + CERT_GAP;
            await drawCertificateInSlot(firstPair[1], MARGIN, slot2Y, usableW, slotH);
          }
        }
        if (orderedPersonnelCerts.length > 2) {
          await renderCertSection(orderedPersonnelCerts.slice(2), contentTopY);
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
  doc.font(fontRegular).fontSize(FONT_SIZE_BODY).fillColor("#333");
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
  contentTop: number,
) {
  // Reserve top band for header (title + drawing number) and bottom
  // band for caption.
  const headerH = 36;
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
  const subLine =
    `Drawing No: ${drawing.drawingNumber}    |    Revision: ${drawing.revisionNumber}    |    ` +
    `Type: ${drawing.drawingType}` +
    (totalPages > 1 ? `    |    Page ${pageNo} of ${totalPages}` : "");
  doc.text(subLine, MARGIN, contentTop + 16, { width: availW, align: "center" });

  if (drawing.clientName || drawing.plantName) {
    const locLine = [drawing.clientName, drawing.plantName].filter(Boolean).join(" — ");
    doc.fontSize(7).fillColor("#666");
    doc.text(locLine, MARGIN, contentTop + 30, { width: availW, align: "center" });
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
  registerMain?: () => void,
): number {
  let y = startY;

  // Section heading
  if (y + 20 > maxRowY) { addNewPage(); y = margin; }
  if (registerMain) registerMain();
  doc.font(FONT_BOLD).fontSize(FONT_SIZE_MAIN).fillColor("#000");
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
