// generate_audit_docx.js — assembles the Technical Audit Report
const {
  Document, Packer, Paragraph, TextRun, Header, Footer, AlignmentType,
  PageNumber, NumberFormat, SectionType, TableOfContents, PageBreak,
} = require("docx");
const fs = require("fs");
const { P, buildCoverR1, FONT } = require("./audit_docx_helpers");
const part1 = require("./audit_content_part1");
const part2 = require("./audit_content_part2");

const pgSize = { width: 11906, height: 16838 };
const pgMargin = { top: 1440, bottom: 1440, left: 1701, right: 1417 };

function pageHeader() {
  return new Header({
    children: [new Paragraph({
      alignment: AlignmentType.RIGHT,
      spacing: { after: 0 },
      children: [new TextRun({
        text: "Technical Audit Report - Inspection Report Automation System (Arun-Tech)",
        size: 16, color: "808080", font: FONT,
      })],
    })],
  });
}
function pageNumFooter() {
  return new Footer({
    children: [new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ children: [PageNumber.CURRENT], size: 18, color: "808080", font: FONT })],
    })],
  });
}

// ── Cover config (R1, DS-1) ──
const coverConfig = {
  title: "Technical Audit Report",
  subtitle: "Inspection Report Automation System (Arun-Tech) - Factual Assessment of Current State",
  englishLabel: "TECHNICAL AUDIT",
  metaLines: [
    "Subject: Next.js 16 / React 19 / Prisma 6 industrial NDT reporting application",
    "Evidence base: 58 API routes, 18 data models, 17 views, live runtime tests",
    "Scope: code, configuration, database, storage, workflow, security",
    "Audit date: 12 November 2026",
    "Mode: read-only inspection - no code was modified",
  ],
  footerLeft: "Arun-Tech",
  footerRight: "Confidential - Internal Evaluation",
  palette: P,
};

// ── Front matter: Executive Summary + TOC ──
const frontMatter = [
  ...part1.execSummary(),
  new Paragraph({
    children: [new TextRun({ text: "", size: 2 }), new PageBreak()],
  }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 480, after: 360 },
    children: [new TextRun({ text: "Table of Contents", bold: true, size: 32, font: FONT, color: "0B1C2C" })],
  }),
  new TableOfContents("Table of Contents", { hyperlink: true, headingStyleRange: "1-2" }),
  new Paragraph({
    spacing: { before: 200 },
    children: [new TextRun({
      text: "Note: This Table of Contents is generated via field codes. To ensure page number accuracy after editing, please right-click the TOC and select \"Update Field.\"",
      italics: true, size: 18, color: "888888", font: FONT,
    })],
  }),
];

// ── Body ──
const bodyChildren = [
  ...part1.section1(),
  ...part1.section2(),
  ...part1.section3(),
  ...part1.section4(),
  ...part1.section5(),
  ...part1.section6(),
  ...part2.section7(),
  ...part2.section8(),
  ...part2.section9(),
  ...part2.section10(),
  ...part2.section11(),
  ...part2.section12(),
];

const doc = new Document({
  creator: "Technical Audit",
  title: "Technical Audit Report - Inspection Report Automation System (Arun-Tech)",
  styles: {
    default: {
      document: {
        run: { font: { ascii: "Times New Roman", eastAsia: "Times New Roman" }, size: 24, color: "000000" },
        paragraph: { spacing: { line: 312 } },
      },
      heading1: {
        run: { font: { ascii: "Times New Roman", eastAsia: "Times New Roman" }, size: 32, bold: true, color: "0B1C2C" },
        paragraph: { spacing: { before: 360, after: 160, line: 312 }, outlineLevel: 0 },
      },
      heading2: {
        run: { font: { ascii: "Times New Roman", eastAsia: "Times New Roman" }, size: 28, bold: true, color: "0B1C2C" },
        paragraph: { spacing: { before: 260, after: 120, line: 312 }, outlineLevel: 1 },
      },
      heading3: {
        run: { font: { ascii: "Times New Roman", eastAsia: "Times New Roman" }, size: 24, bold: true, color: "0B1C2C" },
        paragraph: { spacing: { before: 200, after: 100, line: 312 }, outlineLevel: 2 },
      },
    },
  },
  sections: [
    { // Section 1: Cover — margin 0, no page numbers, no footer
      properties: { page: { size: pgSize, margin: { top: 0, bottom: 0, left: 0, right: 0 } } },
      children: buildCoverR1(coverConfig),
    },
    { // Section 2: Front matter — Roman numerals
      properties: {
        type: SectionType.NEXT_PAGE,
        page: { size: pgSize, margin: pgMargin, pageNumbers: { start: 1, formatType: NumberFormat.UPPER_ROMAN } },
      },
      headers: { default: pageHeader() },
      footers: { default: pageNumFooter() },
      children: frontMatter,
    },
    { // Section 3: Body — Arabic from 1
      properties: {
        type: SectionType.NEXT_PAGE,
        page: { size: pgSize, margin: pgMargin, pageNumbers: { start: 1, formatType: NumberFormat.DECIMAL } },
      },
      headers: { default: pageHeader() },
      footers: { default: pageNumFooter() },
      children: bodyChildren,
    },
  ],
});

Packer.toBuffer(doc).then((buf) => {
  const out = "/home/z/my-project/download/Arun-Tech_Technical_Audit_Report.docx";
  fs.writeFileSync(out, buf);
  console.log("WROTE", out, buf.length, "bytes");
});
