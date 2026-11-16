// TANK — Pass 4: PDF lib. ReportType union, titles, getReportType,
// NO_DRAWINGS, header infoRows tank wording, and the 4 tank body branches
// (inserted after the VESSEL_UTM branch, before the photo gallery).
// Idempotent. Run: node scripts/tank-pass4.mjs
import fs from "fs";

function read(p) { return fs.readFileSync(p, "utf8"); }
function write(p, s) { fs.writeFileSync(p, s); }
function snippet(name) { return read(`scripts/tank-snippets/${name}`).replace(/\n$/, ""); }
function rep(src, label, find, repl) {
  if (src.includes(repl)) { console.log(`  • ${label}: already applied`); return src; }
  const n = src.split(find).length - 1;
  if (n !== 1) throw new Error(`${label}: expected 1 occurrence, found ${n}`);
  console.log(`  ✓ ${label}`);
  return src.replace(find, repl);
}

const p = "src/lib/pdf/pipeline-report.ts";
let s = read(p);

// 1. ReportType union.
s = rep(s, "pdf ReportType union",
`  | "VESSEL_WELD_SCAN"
  | "VESSEL_UTM";`,
`  | "VESSEL_WELD_SCAN"
  | "VESSEL_UTM"
  | "TANK_DPT"
  | "TANK_MPT"
  | "TANK_WELD_SCAN"
  | "TANK_UTM";`);

// 2. REPORT_TYPE_TITLE.
s = rep(s, "pdf titles",
`  VESSEL_WELD_SCAN:   "VESSEL WELD SCAN REPORT",
  VESSEL_UTM:         "VESSEL UT THICKNESS MEASUREMENT REPORT",
};`,
`  VESSEL_WELD_SCAN:   "VESSEL WELD SCAN REPORT",
  VESSEL_UTM:         "VESSEL UT THICKNESS MEASUREMENT REPORT",
  TANK_DPT:           "STORAGE TANK DYE PENETRANT TESTING REPORT",
  TANK_MPT:           "STORAGE TANK MAGNETIC PARTICLE TESTING REPORT",
  TANK_WELD_SCAN:     "STORAGE TANK WELD SCAN REPORT",
  TANK_UTM:           "STORAGE TANK UT THICKNESS MEASUREMENT REPORT",
};`);

// 3. getReportType whitelist.
s = rep(s, "pdf getReportType",
`    v === "VESSEL_WELD_SCAN" ||
    v === "VESSEL_UTM"
  ) return v;`,
`    v === "VESSEL_WELD_SCAN" ||
    v === "VESSEL_UTM" ||
    v === "TANK_DPT" ||
    v === "TANK_MPT" ||
    v === "TANK_WELD_SCAN" ||
    v === "TANK_UTM"
  ) return v;`);

// 4. NO_DRAWINGS_REPORT_TYPES.
s = rep(s, "pdf NO_DRAWINGS",
`  "VESSEL_WELD_SCAN",
  "VESSEL_UTM",
];`,
`  "VESSEL_WELD_SCAN",
  "VESSEL_UTM",
  "TANK_DPT",
  "TANK_MPT",
  "TANK_WELD_SCAN",
  "TANK_UTM",
];`);

// 5. Header infoRows — tank wording (labels use Equipment / Tank).
s = rep(s, "pdf infoRows tank wording",
`    ...(reportType === "VESSEL_DPT" || reportType === "VESSEL_MPT" || reportType === "VESSEL_UTM" || reportType === "VESSEL_WELD_SCAN"
      ? [
          ["Equipment / Vessel Description", report.pipelineDescription],
          ["Equipment Identification No.", report.pipelineIdentificationNumber],
          ["Isometric Drawing No.", report.isometricDrawingNumber],`,
`    ...(reportType === "VESSEL_DPT" || reportType === "VESSEL_MPT" || reportType === "VESSEL_UTM" || reportType === "VESSEL_WELD_SCAN"
      ? [
          ["Equipment / Vessel Description", report.pipelineDescription],
          ["Equipment Identification No.", report.pipelineIdentificationNumber],
          ["Isometric Drawing No.", report.isometricDrawingNumber],
          // (Tank wording handled in the tank branch below)`);
s = rep(s, "pdf infoRows tank branch",
`      : [
            ["Pipeline Description", report.pipelineDescription],
            ["Pipeline Identification No.", report.pipelineIdentificationNumber],
            ["Isometric Drawing No.", report.isometricDrawingNumber],
          ] as Array<[string, string | null | undefined]>),`,
`      : reportType === "TANK_DPT" || reportType === "TANK_MPT" || reportType === "TANK_WELD_SCAN" || reportType === "TANK_UTM"
      ? [
          ["Equipment / Tank Description", report.pipelineDescription],
          ["Equipment Identification No.", report.pipelineIdentificationNumber],
          ["Isometric Drawing No.", report.isometricDrawingNumber],
        ] as Array<[string, string | null | undefined]>
      : [
            ["Pipeline Description", report.pipelineDescription],
            ["Pipeline Identification No.", report.pipelineIdentificationNumber],
            ["Isometric Drawing No.", report.isometricDrawingNumber],
          ] as Array<[string, string | null | undefined]>),`);

// 6. Body dispatch — the 4 tank branches after the VESSEL_UTM branch.
s = rep(s, "pdf tank body branches",
`      y += 6;
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // 7. PHOTOGRAPHS (gallery) — after the measurement table, before`,
`      y += 6;
    }
${snippet("pdf-tdpt.txt")}
${snippet("pdf-tmpt.txt")}
${snippet("pdf-tws.txt")}
${snippet("pdf-tutm.txt")}
  }

  // ═══════════════════════════════════════════════════════════════
  // 7. PHOTOGRAPHS (gallery) — after the measurement table, before`);

write(p, s);
console.log("PASS4 DONE");
