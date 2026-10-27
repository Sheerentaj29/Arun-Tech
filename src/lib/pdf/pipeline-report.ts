// Server-side PDF generator for the Pipeline Thickness Measurement Report.
// Uses pdfkit (pure JS, no native deps).
//
// Supports both landscape (default, wide table) and portrait (narrower,
// wraps text + splits columns across pages) orientations.
//
// Includes:
//   - Header block with client + plant + pipeline identity
//   - Green measurement-table header (11 columns + custom columns)
//   - Photo gallery with captions (embedded from disk)
//   - Inspection description + findings summary
//   - Sign-off block
//   - Page numbering footer

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

// Landscape A4: 841.89 × 595.28 pt
// Portrait A4:  595.28 × 841.89 pt
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
  { key: "findings",     header: "Findings / Comments",   width: 0 }, // fill remainder
];

// For portrait, we use smaller column widths so the table fits in 540pt
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
  const photos = input.photos ?? input.report.reportPhotos ?? [];
  const customCols = getCustomColumns(report);

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

  drawHeaderAndFooter();

  // ── TITLE ──
  const titleY = MARGIN;
  doc.fontSize(orientation === "landscape" ? 13 : 11).font("Helvetica-Bold");
  doc.text("PIPELINE THICKNESS MEASUREMENT REPORT", MARGIN, titleY, {
    width: pageW - 2 * MARGIN, align: "center",
  });
  doc.font("Helvetica").fontSize(8);
  doc.text(
    `Report No: ${report.reportNumber}    |    Rev: ${report.revisionNumber}    |    Date: ${new Date(report.inspectionDate).toISOString().slice(0, 10)}    |    Status: ${report.status}`,
    MARGIN, titleY + 18, { width: pageW - 2 * MARGIN, align: "center" },
  );

  // ── LOGO PLACEHOLDERS ──
  doc.rect(MARGIN, titleY + 36, 110, 36).stroke();
  doc.fontSize(7).fillColor("#666");
  doc.text("SERVICE COMPANY\nLOGO", MARGIN, titleY + 48, { width: 110, align: "center" });
  doc.rect(pageW - MARGIN - 110, titleY + 36, 110, 36).stroke();
  const clientShort = report.client.name.length > 28 ? report.client.name.slice(0, 28) : report.client.name;
  doc.text(`${clientShort}\nCLIENT LOGO`, pageW - MARGIN - 110, titleY + 48, { width: 110, align: "center" });
  doc.fillColor("#000");

  // ── HEADER INFO GRID ──
  const infoY = titleY + 80;
  const labelW = orientation === "landscape" ? 150 : 110;
  const valueW = (pageW - 2 * MARGIN - 2 * labelW) / 2;
  const rowH = 14;
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

  infoRows.forEach((row, idx) => {
    const side = idx % 2;
    const rIdx = Math.floor(idx / 2);
    const x = side === 0 ? MARGIN : MARGIN + labelW + valueW;
    const y = infoY + rIdx * rowH;
    doc.font("Helvetica-Bold").fontSize(orientation === "landscape" ? 8 : 7);
    doc.rect(x, y, labelW, rowH).stroke();
    doc.text(row[0], x + 4, y + 3, { width: labelW - 8, align: "left" });
    doc.font("Helvetica").fontSize(orientation === "landscape" ? 8 : 7);
    doc.rect(x + labelW, y, side === 0 ? valueW : valueW, rowH).stroke();
    doc.text(row[1] ?? "—", x + labelW + 4, y + 3, { width: valueW - 8, align: "left" });
  });

  // ── TABLE HEADER ──
  const headerInfoRowsCount = Math.ceil(infoRows.length / 2);
  const tableTop = infoY + headerInfoRowsCount * rowH + 14;

  drawTableHeader(doc, allCols, colWidths, tableTop, pageW);

  // ── TABLE ROWS ──
  let y = tableTop + 36;
  const rowH2 = orientation === "landscape" ? 28 : 22;
  const maxRowY = pageH - MARGIN - 60; // leave room for footer + findings

  for (const m of measurements) {
    if (y + rowH2 > maxRowY) {
      doc.addPage({ size: pageSize, layout: orientation, margins: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN } });
      drawHeaderAndFooter();
      drawTableHeader(doc, allCols, colWidths, MARGIN, pageW);
      y = MARGIN + 36;
    }
    drawMeasurementRow(doc, m, allCols, colWidths, y, report, customCols);
    y += rowH2;
  }

  // ── INSPECTION DESCRIPTION ──
  if (report.inspectionDescription) {
    if (y + 80 > maxRowY) {
      doc.addPage({ size: pageSize, layout: orientation, margins: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN } });
      drawHeaderAndFooter();
      y = MARGIN;
    }
    y += 10;
    doc.font("Helvetica-Bold").fontSize(9).fillColor("#000");
    doc.text("Inspection Description", MARGIN, y);
    y += 14;
    doc.font("Helvetica").fontSize(8);
    doc.text(report.inspectionDescription, MARGIN, y, { width: pageW - 2 * MARGIN, align: "left" });
    y += Math.min(80, Math.ceil(report.inspectionDescription.length / 80) * 12);
  }

  // ── FINDINGS SUMMARY ──
  if (report.findingsSummary) {
    y += 10;
    if (y + 40 > maxRowY) {
      doc.addPage({ size: pageSize, layout: orientation, margins: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN } });
      drawHeaderAndFooter();
      y = MARGIN;
    }
    doc.font("Helvetica-Bold").fontSize(9);
    doc.text("Findings Summary", MARGIN, y);
    y += 14;
    doc.font("Helvetica").fontSize(8);
    doc.text(report.findingsSummary ?? "—", MARGIN, y, { width: pageW - 2 * MARGIN, align: "left" });
    y += 40;
  }

  // ── COMMENTS ──
  if (report.comments) {
    y += 5;
    if (y + 30 > maxRowY) {
      doc.addPage({ size: pageSize, layout: orientation, margins: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN } });
      drawHeaderAndFooter();
      y = MARGIN;
    }
    doc.font("Helvetica-Bold").fontSize(9);
    doc.text("Comments", MARGIN, y);
    y += 14;
    doc.font("Helvetica").fontSize(8);
    doc.text(report.comments ?? "—", MARGIN, y, { width: pageW - 2 * MARGIN, align: "left" });
    y += 30;
  }

  // ── PHOTOS ──
  if (photos.length > 0) {
    y += 10;
    if (y + 100 > maxRowY) {
      doc.addPage({ size: pageSize, layout: orientation, margins: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN } });
      drawHeaderAndFooter();
      y = MARGIN;
    }
    doc.font("Helvetica-Bold").fontSize(10).fillColor("#000");
    doc.text("Photographs", MARGIN, y);
    y += 20;

    const photoW = orientation === "landscape" ? 180 : 140;
    const photoH = orientation === "landscape" ? 120 : 95;
    const gap = 10;
    let photosPerRow = Math.floor((pageW - 2 * MARGIN + gap) / (photoW + gap));
    if (photosPerRow < 1) photosPerRow = 1;

    for (let i = 0; i < photos.length; i++) {
      const photo = photos[i];
      const col = i % photosPerRow;
      const row = Math.floor(i / photosPerRow);
      const px = MARGIN + col * (photoW + gap);
      const py = y + row * (photoH + 30);

      if (py + photoH + 20 > maxRowY) {
        doc.addPage({ size: pageSize, layout: orientation, margins: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN } });
        drawHeaderAndFooter();
        y = MARGIN;
      }

      // Draw photo border
      doc.rect(px, py, photoW, photoH).stroke("#999");

      // Try to embed the actual image
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
          doc.text("[Image unreadable]", px + 4, py + photoH / 2 - 5, { width: photoW - 8, align: "center" });
          doc.fillColor("#000");
        }
      } else {
        doc.fillColor("#999").fontSize(7);
        doc.text(`[File missing: ${photo.fileName}]`, px + 4, py + photoH / 2 - 5, { width: photoW - 8, align: "center" });
        doc.fillColor("#000");
      }

      // Caption below photo
      doc.font("Helvetica").fontSize(7).fillColor("#333");
      const caption = photo.caption || photo.fileName;
      doc.text(caption, px, py + photoH + 2, { width: photoW, align: "center" });
      doc.fillColor("#000");
    }
    y += Math.ceil(photos.length / photosPerRow) * (photoH + 30);
  }

  // ── SIGN-OFF ──
  if (y + 80 > maxRowY) {
    doc.addPage({ size: pageSize, layout: orientation, margins: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN } });
    drawHeaderAndFooter();
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

// ─── HELPERS ───

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
