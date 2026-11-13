// gen_test_assets.js — generate labeled test images/PDF for the Review fix verification
// Outputs to /tmp/revfix-assets/
const sharp = require("sharp");
const PDFDocument = require("pdfkit");
const fs = require("fs");
const path = require("path");

const OUT = "/tmp/revfix-assets";
fs.mkdirSync(OUT, { recursive: true });

function svgLabel(lines, w, h, bg, fg) {
  const textSvg = lines
    .map(
      (l, i) =>
        `<text x="${w / 2}" y="${h / 2 - (lines.length - 1) * 30 + i * 60}" font-size="44" font-family="DejaVu Sans" font-weight="bold" fill="${fg}" text-anchor="middle">${l}</text>`
    )
    .join("");
  return Buffer.from(
    `<svg width="${w}" height="${h}"><rect width="100%" height="100%" fill="${bg}"/>` +
      `<rect x="20" y="20" width="${w - 40}" height="${h - 40}" fill="none" stroke="${fg}" stroke-width="6"/>` +
      textSvg +
      `</svg>`
  );
}

async function main() {
  // 1. PNG drawing (landscape isometric-style)
  await sharp(
    svgLabel(["ENGINEERING DRAWING A-101", "PIPE ISO — LINE 4&quot;-CS-SCH40", "REV 0 — SCALE 1:50"], 1200, 800, "#eef2ff", "#1e3a8a")
  )
    .png()
    .toFile(path.join(OUT, "drawing-iso-a101.png"));

  // 2. WEBP drawing (to prove webp now renders in Review)
  await sharp(
    svgLabel(["P&amp;ID DRAWING PID-77", "WEBP FORMAT TEST", "SHOULD RENDER IN REVIEW"], 1000, 700, "#fefce8", "#a16207")
  )
    .webp()
    .toFile(path.join(OUT, "drawing-pid-77.webp"));

  // 3. PDF drawing (2 pages — preview shows page 1)
  const doc = new PDFDocument({ size: "A4", layout: "landscape", margin: 40 });
  doc.pipe(fs.createWriteStream(path.join(OUT, "drawing-ga-205.pdf")));
  doc.font("Helvetica-Bold").fontSize(30).fillColor("#000");
  doc.text("GENERAL ARRANGEMENT DRAWING GA-205", 40, 260, { align: "center" });
  doc.font("Helvetica").fontSize(16).fillColor("#333");
  doc.text("PDF drawing — page 1 of 2 (this page is rasterized for the Review preview)", 40, 320, { align: "center" });
  doc.rect(40, 40, 762, 522).lineWidth(3).stroke("#000");
  doc.addPage({ size: "A4", layout: "landscape", margin: 40 });
  doc.font("Helvetica-Bold").fontSize(30).fillColor("#000");
  doc.text("GA-205 — DETAIL SHEET", 40, 260, { align: "center" });
  doc.font("Helvetica").fontSize(16).fillColor("#333");
  doc.text("PDF drawing — page 2 of 2", 40, 320, { align: "center" });
  doc.rect(40, 40, 762, 522).lineWidth(3).stroke("#000");
  doc.end();

  // 4. Primary inspection photo
  await new Promise((res) => {
    const d2 = new PDFDocument({ size: [900, 600], margin: 0 });
    const ws = fs.createWriteStream("/tmp/revfix-assets/_primary_tmp.pdf");
    d2.pipe(ws);
    d2.on("end", res);
    // not used — see below
    d2.end();
  });
  await sharp(
    svgLabel(["PRIMARY INSPECTION PHOTO", "LINE 4&quot;-CS — SECTION 12", "UT SURVEY IN PROGRESS"], 900, 600, "#f0fdf4", "#166534")
  )
    .png()
    .toFile(path.join(OUT, "primary-photo.png"));

  // 5. Inspection photo 1 / 2
  await sharp(svgLabel(["INSPECTION PHOTO #1", "CORROSION AT ELBOW E-3", "12 O'CLOCK POSITION"], 800, 600, "#fff1f2", "#9f1239"))
    .png()
    .toFile(path.join(OUT, "inspection-photo-1.png"));
  await sharp(svgLabel(["INSPECTION PHOTO #2", "SUPPORT H-7 — COATING PEELING", "3 O'CLOCK POSITION"], 800, 600, "#eff6ff", "#1d4ed8"))
    .png()
    .toFile(path.join(OUT, "inspection-photo-2.png"));

  console.log("ASSETS OK:", fs.readdirSync(OUT).join(", "));
}

main().catch((e) => {
  console.error("ASSET GEN FAILED:", e);
  process.exit(1);
});
