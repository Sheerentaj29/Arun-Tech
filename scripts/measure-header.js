
const { PDFDocument } = require("pdfkit");
const p = "/home/z/my-project/node_modules/geist/dist/fonts/geist-sans/Geist-Bold.ttf";
const fs = require("fs");
const d = new PDFDocument({});
if (fs.existsSync(p)) d.registerFont("GeistBold", p); else { console.log("NO GEIST"); process.exit(1); }
d.font("GeistBold");
for (const [size, text] of [[16,"ARUN TECH INDUSTRIAL SERVICES PVT LTD"],[15,"ARUN TECH INDUSTRIAL SERVICES PVT LTD"],[14,"WELD SCAN REPORT"],[10,"STORAGE TANK WELD SCAN REPORT"],[8,"ARUN TECH INDUSTRIAL SERVICES PVT LTD"],[10,"WELD SCAN REPORT"]]) {
  d.fontSize(size);
  console.log(size+"pt:", d.widthOfString(text).toFixed(1));
}
console.log("portrait usableW:", (595.28-56).toFixed(1));
console.log("centerW logoW110+pad10:", (595.28-56-2*120).toFixed(1));
console.log("centerW logoW100+pad10:", (595.28-56-2*110).toFixed(1));
console.log("centerW logoW95+pad10:", (595.28-56-2*105).toFixed(1));
