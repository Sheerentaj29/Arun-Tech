// Server-side PDF generator for the Pipeline Thickness Measurement Report.
// Uses pdfkit (pure JS, no native deps).
//
// Fixes applied:
//   1. Dynamic row height in header info grid — long MOC values wrap
//      without overlapping adjacent fields.
//   2. Title/subtitle spacing — increased gap so no text overlaps.
//   3. AutoCAD diagrams — images whose caption or filename contains
//      "diagram", "isometric", "autocad", or "drawing" are treated as
//      diagrams. Each diagram gets its OWN FULL PAGE, displayed BEFORE
//      the measurement table. Regular photos stay in the gallery at the
//      end.
//   4. Dynamic page handling — 0 diagrams = table starts right after
//      header; N diagrams = N full pages, then table starts on a fresh
//      page.

import PDFDocument from "pdfkit";
import type { Writable } from "stream";
import type { PipelineInspection, ThicknessMeasurement, Client, Plant, User, ReportPhoto } from "@prisma/client";
import { readFileSync, existsSync } from "fs";

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
}

type Doc = PDFDocument.PDFDocument;

const PAGE_SIZES = {
  landscape: [841.89, 595.28] as [number, number],
  portrait: [595.28, 841.89] as [number, number],
};

const MARGIN = 28;
const HEADER_BG = "#3a7d3a";
const HEADER_FG = "#ffffff";

// Keywords that identify a photo as an AutoCAD diagram
const DIAGRAM_KEYWORDS = ["diagram", "isometric", "autocad", "drawing", "dwg", "iso"];

function isDiagram(photo: ReportPhoto): boolean {
  const caption = (photo.caption ?? "").toLowerCase();
  const fileName = (photo.fileName ?? "").toLowerCase();
  return DIAGRAM_KEYWORDS.some((kw) => caption.includes(kw) || fileName.includes(kw));
}

interface Column {
  key: string;
  header: string;
  width: number;
  vertical?: boolean;
}

const SYSTEM_COLUMNS_LANDSCAPE: Column[] = [
  { key: "diaInch",      header: "Dia mm\n(inch)",        width: 50 },
  { key: "schedule",     header: "Pipe\nSchedule",       width: 55 },
  { key: "nominal",      header: "Nominal\nThickness\n(mm)", width: 55 },
  { key: "component",    header: "Component\nType",      width: 60 },
  { key: "pointNo",      header: "Point\nNo",             width: 40 },
  { key: "north",        header: "12 o'clock\nNorth\n(mm)", width: 55, vertical: true },
  { key: "east",         header: "3 o'clock\nEast\n(mm)",  width: 55, vertical: true },
  { key: "south",        header: "6 o'clock\nSouth\n(mm)", width: 55, vertical: true },
  { key: "west",         header: "9 o'clock\nWest\n(mm)",  width: 55, vertical: true },
  { key: "obsMin",       header: "Observed\nMinimum\n(mm)", width: 60, vertical: true },
  { key: "findings",     header: "Findings / Comments",   width: 0 },
];

const SYSTEM_COLUMNS_PORTRAIT: Column[] = [
  { key: "diaInch",      header: "Dia\n(inch)",      width: 35 },
  { key: "schedule",     header: "Schedule",         width: 42 },
  { key: "nominal",      header: "Nominal\n(mm)",    width: 42 },
  { key: "component",    header: "Type",             width: 40 },
  { key: "pointNo",      header: "Pt\nNo",            width: 28 },
  { key: "north",        header: "N\n(mm)",           width: 38 },
  { key: "east",         header: "E\n(mm)",           width: 38 },
  { key: "south",        header: "S\n(mm)",           width: 38 },
  { key: "west",         header: "W\n(mm)",           width: 38 },
  { key: "obsMin",       header: "Min\n(mm)",         width: 42 },
  { key: "findings",     header: "Findings / Comments", width: 0 },
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
 * Calculate the wrapped height of a text string at a given font size
 * within a given width. Used to determine dynamic row heights so long
 * values (like MOC) don't overlap.
 */
function textHeight(doc: Doc, text: string, fontSize: number, maxWidth: number): number {
  doc.fontSize(fontSize).font("Helvetica");
  return doc.heightOfString(text ?? "—", { width: maxWidth });
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
    size: pageSize,
    margins: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
    layout: orientation,
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

  // ── LINKED ENGINEERING DRAWINGS ──
  // These are drawings linked to the report via the DrawingInspectionLink
  // model. Each gets its own FULL PAGE before the measurement table.
  // The PDF route loads them with their active revision's file path.
  const linkedDrawings: any[] = (report as any).linkedDrawings ?? [];

  // Regular inspection photos stay in the gallery at the end.
  // (We no longer filter photos by "diagram" keywords — drawings come
  // from the dedicated Engineering Drawings module.)
  const regularPhotos = allPhotos;

  // Determine columns: system + custom
  const systemCols = orientation === "landscape" ? SYSTEM_COLUMNS_LANDSCAPE : SYSTEM_COLUMNS_PORTRAIT;
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
  const drawHeaderAndFooter = () => {
    pageNo += 1;
    doc.fontSize(7).fillColor("#666");
    doc.text(
      `Page ${pageNo} | Generated ${new Date().toISOString().slice(0, 19).replace("T", " ")} | Inspection Report Automation System`,
      MARGIN, pageH - 18,
      { width: pageW - 2 * MARGIN, align: "center" },
    );
    doc.fillColor("#000");
  };

  const addNewPage = () => {
    doc.addPage({
      size: pageSize,
      layout: orientation,
      margins: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
    });
    drawHeaderAndFooter();
  };

  drawHeaderAndFooter();

  // ═══════════════════════════════════════════════════════════════
  // PAGE 1: TITLE + LOGOS + HEADER INFO GRID
  // ═══════════════════════════════════════════════════════════════

  // ── FIX 2: Title with proper spacing ──
  const titleFontSize = orientation === "landscape" ? 13 : 11;
  const subtitleFontSize = orientation === "landscape" ? 8 : 7;
  const titleY = MARGIN;

  // Draw the title
  doc.fontSize(titleFontSize).font("Helvetica-Bold");
  doc.text("PIPELINE THICKNESS MEASUREMENT REPORT", MARGIN, titleY, {
    width: pageW - 2 * MARGIN, align: "center",
  });

  // Calculate actual title height (handles wrapping)
  const titleHeight = doc.heightOfString("PIPELINE THICKNESS MEASUREMENT REPORT", {
    width: pageW - 2 * MARGIN, align: "center",
  });

  // Draw subtitle with enough gap below the title (at least 6pt gap)
  const subtitleY = titleY + titleHeight + 6;
  doc.font("Helvetica").fontSize(subtitleFontSize);
  doc.text(
    `Report No: ${report.reportNumber}    |    Rev: ${report.revisionNumber}    |    Date: ${new Date(report.inspectionDate).toISOString().slice(0, 10)}    |    Status: ${report.status}`,
    MARGIN, subtitleY,
    { width: pageW - 2 * MARGIN, align: "center" },
  );

  const subtitleHeight = doc.heightOfString(
    `Report No: ${report.reportNumber}    |    Rev: ${report.revisionNumber}    |    Date: ${new Date(report.inspectionDate).toISOString().slice(0, 10)}    |    Status: ${report.status}`,
    { width: pageW - 2 * MARGIN, align: "center" },
  );

  // ── LOGO PLACEHOLDERS (positioned below subtitle with gap) ──
  const logoY = subtitleY + subtitleHeight + 6;
  const logoH = 36;
  doc.rect(MARGIN, logoY, 110, logoH).stroke();
  doc.fontSize(7).fillColor("#666");
  doc.text("SERVICE COMPANY\nLOGO", MARGIN, logoY + 10, { width: 110, align: "center" });
  doc.rect(pageW - MARGIN - 110, logoY, 110, logoH).stroke();
  const clientShort = report.client.name.length > 28 ? report.client.name.slice(0, 28) : report.client.name;
  doc.text(`${clientShort}\nCLIENT LOGO`, pageW - MARGIN - 110, logoY + 10, { width: 110, align: "center" });
  doc.fillColor("#000");

  // ── FIX 1: HEADER INFO GRID with dynamic row heights ──
  // Long values (like MOC) wrap to multiple lines. Calculate each row's
  // height dynamically so text never overlaps.
  const infoY = logoY + logoH + 10;
  const labelW = orientation === "landscape" ? 150 : 110;
  const valueW = (pageW - 2 * MARGIN - 2 * labelW) / 2;
  const minRowH = 14; // minimum height per row
  const fontSizeInfo = orientation === "landscape" ? 8 : 7;

  const infoRows: Array<[string, string | null | undefined]> = [
    ["Client", report.client.name],
    ["Location", report.plant.location],
    ["Plant Name", report.plant.name],
    ["Inspection Area", report.inspectionArea],
    ["Pipeline Description", report.pipelineDescription],
    ["Pipeline Identification No.", report.pipelineIdentificationNumber],
    ["Isometric Drawing No.", report.isometricDrawingNumber],
    ["Material of Construction (MOC)", report.materialOfConstruction],
    ["Applicable Standard", `${report.applicableStandard ?? "—"} ${report.standardEdition ?? ""}`.trim()],
    ["Inspector", report.inspectorName],
  ];

  // Group rows into pairs (left + right columns) and calculate the max
  // height needed for each pair.
  const rowPairs: Array<{ left: [string, string]; right: [string, string]; height: number }> = [];
  for (let i = 0; i < infoRows.length; i += 2) {
    const left = infoRows[i];
    const right = infoRows[i + 1] ?? ["", "—"];

    // Calculate the wrapped height for each value in this pair
    const leftLabelH = textHeight(doc, left[0], fontSizeInfo, labelW - 8);
    const leftValStr = left[1] ?? "—";
    const leftValH = textHeight(doc, leftValStr, fontSizeInfo, valueW - 8);
    const rightLabelH = textHeight(doc, right[0], fontSizeInfo, labelW - 8);
    const rightValStr = right[1] ?? "—";
    const rightValH = textHeight(doc, rightValStr, fontSizeInfo, valueW - 8);

    // The row height is the maximum of all four heights, with padding
    const maxContentH = Math.max(leftLabelH, leftValH, rightLabelH, rightValH);
    const pairHeight = Math.max(minRowH, maxContentH + 4); // +4 for padding

    rowPairs.push({
      left: [left[0], leftValStr],
      right: [right[0], rightValStr],
      height: pairHeight,
    });
  }

  // Draw each pair with its calculated height
  let currentY = infoY;
  for (const pair of rowPairs) {
    const h = pair.height;
    // Left label
    doc.font("Helvetica-Bold").fontSize(fontSizeInfo);
    doc.rect(MARGIN, currentY, labelW, h).stroke();
    doc.text(pair.left[0], MARGIN + 4, currentY + 2, { width: labelW - 8, align: "left", height: h });
    // Left value — use height option to clip text within the cell
    doc.font("Helvetica").fontSize(fontSizeInfo);
    doc.rect(MARGIN + labelW, currentY, valueW, h).stroke();
    doc.text(pair.left[1], MARGIN + labelW + 4, currentY + 2, { width: valueW - 8, align: "left", height: h });

    // Right label
    const rightX = MARGIN + labelW + valueW;
    doc.font("Helvetica-Bold").fontSize(fontSizeInfo);
    doc.rect(rightX, currentY, labelW, h).stroke();
    doc.text(pair.right[0], rightX + 4, currentY + 2, { width: labelW - 8, align: "left", height: h });
    // Right value
    doc.font("Helvetica").fontSize(fontSizeInfo);
    doc.rect(rightX + labelW, currentY, valueW, h).stroke();
    doc.text(pair.right[1], rightX + labelW + 4, currentY + 2, { width: valueW - 8, align: "left", height: h });

    currentY += h;
  }

  // ═══════════════════════════════════════════════════════════════
  // ENGINEERING DRAWINGS — each on its OWN FULL PAGE, before the table
  // ═══════════════════════════════════════════════════════════════
  if (linkedDrawings.length > 0) {
    for (let i = 0; i < linkedDrawings.length; i++) {
      const drawing = linkedDrawings[i];
      // Each drawing gets a fresh full page
      addNewPage();

      const availW = pageW - 2 * MARGIN;
      const availH = pageH - 2 * MARGIN - 40; // room for header + caption

      // Drawing header: title, number, revision
      doc.font("Helvetica-Bold").fontSize(11).fillColor("#000");
      doc.text(`${drawing.title}`, MARGIN, MARGIN, { width: availW, align: "center" });
      doc.font("Helvetica").fontSize(8).fillColor("#444");
      const subLine = `Drawing No: ${drawing.drawingNumber}  |  Revision: ${drawing.revisionNumber}  |  Type: ${drawing.drawingType}`;
      doc.text(subLine, MARGIN, MARGIN + 16, { width: availW, align: "center" });

      // Client/plant info
      if (drawing.clientName || drawing.plantName) {
        const locLine = [drawing.clientName, drawing.plantName].filter(Boolean).join(" — ");
        doc.fontSize(7).fillColor("#666");
        doc.text(locLine, MARGIN, MARGIN + 30, { width: availW, align: "center" });
      }
      doc.fillColor("#000");

      // Embed the drawing file
      const drawingY = MARGIN + 40;
      const drawingH = availH - 40;

      if (drawing.filePath && existsSync(drawing.filePath)) {
        try {
          const imgBuf = readFileSync(drawing.filePath);
          const ext = (drawing.fileExtension || "").toLowerCase();

          if (ext === ".pdf") {
            // For PDF drawings, we can't embed a PDF inside a PDF.
            // Show a placeholder with download instructions.
            doc.fillColor("#999").fontSize(10);
            doc.rect(MARGIN, drawingY, availW, drawingH).stroke("#ccc");
            doc.text(
              `[PDF Drawing: ${drawing.fileName}]\n\nThis drawing is a PDF file and cannot be embedded directly.\nDownload the original file to view it.`,
              MARGIN + 20, drawingY + drawingH / 2 - 20,
              { width: availW - 40, align: "center" },
            );
            doc.fillColor("#000");
          } else {
            // Image formats (PNG, JPEG, TIFF) — embed directly
            doc.image(imgBuf, MARGIN, drawingY, {
              fit: [availW, drawingH],
              align: "center",
              valign: "center",
            });
          }
        } catch (err) {
          // For DWG/DXF or unreadable files, show a clear message
          doc.fillColor("#999").fontSize(9);
          doc.rect(MARGIN, drawingY, availW, drawingH).stroke("#ccc");
          const ext = (drawing.fileExtension || "").toUpperCase();
          doc.text(
            `[${ext} File: ${drawing.fileName}]\n\nPreview not available for ${ext} files.\nDownload the original CAD file to view it in AutoCAD or compatible software.`,
            MARGIN + 20, drawingY + drawingH / 2 - 20,
            { width: availW - 40, align: "center" },
          );
          doc.fillColor("#000");
        }
      } else {
        doc.fillColor("#999").fontSize(9);
        doc.rect(MARGIN, drawingY, availW, drawingH).stroke("#ccc");
        doc.text(
          `[File missing: ${drawing.fileName}]\n\nThe drawing file could not be found on disk.`,
          MARGIN + 20, drawingY + drawingH / 2 - 15,
          { width: availW - 40, align: "center" },
        );
        doc.fillColor("#000");
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // MEASUREMENT TABLE — starts on a FRESH PAGE (after all diagrams)
  // ═══════════════════════════════════════════════════════════════

  // If there are diagrams OR the header info grid filled most of page 1,
  // start the table on a fresh page. Otherwise, continue on the same page
  // if there's room.
  const tableHeaderH = 36;
  const rowH2 = orientation === "landscape" ? 28 : 22;
  const maxRowY = pageH - MARGIN - 20; // leave room for footer

  // If there are linked drawings, the table MUST start on a fresh page
  let y: number;

  if (linkedDrawings.length > 0) {
    addNewPage();
    drawTableHeader(doc, allCols, colWidths, MARGIN, pageW);
    y = MARGIN + tableHeaderH;
  } else {
    if (currentY + tableHeaderH + rowH2 > maxRowY) {
      addNewPage();
      drawTableHeader(doc, allCols, colWidths, MARGIN, pageW);
      y = MARGIN + tableHeaderH;
    } else {
      currentY += 10;
      drawTableHeader(doc, allCols, colWidths, currentY, pageW);
      y = currentY + tableHeaderH;
    }
  }

  // ── TABLE ROWS ──
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
    if (y + 60 > maxRowY) {
      addNewPage();
      y = MARGIN;
    }
    y += 10;
    doc.font("Helvetica-Bold").fontSize(9).fillColor("#000");
    doc.text("Inspection Description", MARGIN, y);
    y += 14;
    doc.font("Helvetica").fontSize(8);
    const descHeight = doc.heightOfString(report.inspectionDescription, {
      width: pageW - 2 * MARGIN,
    });
    doc.text(report.inspectionDescription, MARGIN, y, {
      width: pageW - 2 * MARGIN, align: "left",
    });
    y += descHeight + 6;
  }

  // ── FINDINGS SUMMARY ──
  if (report.findingsSummary) {
    if (y + 40 > maxRowY) {
      addNewPage();
      y = MARGIN;
    }
    y += 8;
    doc.font("Helvetica-Bold").fontSize(9);
    doc.text("Findings Summary", MARGIN, y);
    y += 14;
    doc.font("Helvetica").fontSize(8);
    const findingsH = doc.heightOfString(report.findingsSummary ?? "—", {
      width: pageW - 2 * MARGIN,
    });
    doc.text(report.findingsSummary ?? "—", MARGIN, y, {
      width: pageW - 2 * MARGIN, align: "left",
    });
    y += findingsH + 6;
  }

  // ── COMMENTS ──
  if (report.comments) {
    if (y + 30 > maxRowY) {
      addNewPage();
      y = MARGIN;
    }
    y += 6;
    doc.font("Helvetica-Bold").fontSize(9);
    doc.text("Comments", MARGIN, y);
    y += 14;
    doc.font("Helvetica").fontSize(8);
    const commentsH = doc.heightOfString(report.comments ?? "—", {
      width: pageW - 2 * MARGIN,
    });
    doc.text(report.comments ?? "—", MARGIN, y, {
      width: pageW - 2 * MARGIN, align: "left",
    });
    y += commentsH + 6;
  }

  // ── REGULAR PHOTOS (gallery — NOT diagrams) ──
  if (regularPhotos.length > 0) {
    if (y + 100 > maxRowY) {
      addNewPage();
      y = MARGIN;
    }
    y += 10;
    doc.font("Helvetica-Bold").fontSize(10).fillColor("#000");
    doc.text("Photographs", MARGIN, y);
    y += 20;

    const photoW = orientation === "landscape" ? 180 : 140;
    const photoH = orientation === "landscape" ? 120 : 95;
    const gap = 10;
    let photosPerRow = Math.floor((pageW - 2 * MARGIN + gap) / (photoW + gap));
    if (photosPerRow < 1) photosPerRow = 1;

    for (let i = 0; i < regularPhotos.length; i++) {
      const photo = regularPhotos[i];
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
        } catch (err) {
          doc.fillColor("#999").fontSize(7);
          doc.text("[Image unreadable]", px + 4, py + photoH / 2 - 5, {
            width: photoW - 8, align: "center",
          });
          doc.fillColor("#000");
        }
      } else {
        doc.fillColor("#999").fontSize(7);
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
    y += Math.ceil(regularPhotos.length / photosPerRow) * (photoH + 30);
  }

  // ── SIGN-OFF ──
  if (y + 80 > maxRowY) {
    addNewPage();
    y = MARGIN;
  }
  y += 10;
  doc.font("Helvetica-Bold").fontSize(9).fillColor("#000");
  doc.text("Sign-off", MARGIN, y);
  y += 18;

  const signW = (pageW - 2 * MARGIN - 2 * 8) / 3;
  const signBlocks = [
    { label: "Inspected by", name: report.inspectorName, dateVal: new Date(report.inspectionDate).toISOString().slice(0, 10) },
    { label: "Reviewed / Approved by", name: report.approver?.name ?? "—", dateVal: report.approvedAt?.slice(0, 10) ?? "—" },
    { label: "Revision", name: `Rev ${report.revisionNumber}`, dateVal: report.status },
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
    doc.text(report.overrideReason, MARGIN + 140, y, { width: pageW - 2 * MARGIN - 140 });
  }

  doc.end();
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
  report: any,
  customCols: any[],
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
      case "diaInch": text = m.pipeSizeInch; break;
      case "schedule": text = m.pipeSchedule; break;
      case "nominal": text = m.nominalThicknessMm !== null ? m.nominalThicknessMm.toFixed(2) : "—"; break;
      case "component": text = m.componentTypeCode; break;
      case "pointNo": text = m.pointNo; break;
      case "north": text = fmtMeasurement(m.northMm, m.northStatus); break;
      case "east": text = fmtMeasurement(m.eastMm, m.eastStatus); break;
      case "south": text = fmtMeasurement(m.southMm, m.southStatus); break;
      case "west": text = fmtMeasurement(m.westMm, m.westStatus); break;
      case "obsMin": text = m.observedMinimumMm !== null ? m.observedMinimumMm.toFixed(2) : "—"; break;
      case "findings": text = m.findingsComments ?? ""; break;
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
    doc.text(wrapped, x + cellPad, y + 9, { width: maxW, align: c.key === "findings" ? "left" : "center" });
    x += w;
  }
}
