// UI cleanup codemod: remove helper/instructional text from inspection views.
// Removes ONLY presentational JSX text blocks (CardDescription blocks, info
// Alert box, muted helper paragraphs). No functional JSX is touched.
// Run: node scripts/cleanup-ui-descriptions.mjs
import fs from "fs";

const FORM = "src/components/views/pipeline-report-form-view.tsx";
const DETAIL = "src/components/views/pipeline-report-detail-view.tsx";
const SELECTOR = "src/components/views/pipeline-report-type-selector-view.tsx";

function read(p) { return fs.readFileSync(p, "utf8"); }
function write(p, s) { fs.writeFileSync(p, s); }

// ── exact-once replacement helper ──
function replaceOnce(src, label, find, repl = "") {
  const parts = src.split(find);
  if (parts.length !== 2) {
    throw new Error(`${label}: expected exactly 1 occurrence, found ${parts.length - 1}`);
  }
  console.log(`  ✓ removed: ${label}`);
  return parts.join(repl);
}

// ═══════════════ FORM VIEW ═══════════════
let f = read(FORM);

// 1. All CardDescription blocks (pure text/JSX-expression helpers, no nesting).
const cdRe = /[ \t]*<CardDescription(?:\s+className="[^"]*")?>[\s\S]*?<\/CardDescription>\n/g;
const cdCount = (f.match(cdRe) || []).length;
f = f.replace(cdRe, "");
console.log(`  ✓ removed: ${cdCount} CardDescription blocks`);

// 2. Amber "Reference data notice" information box (whole conditional block).
f = replaceOnce(f, "Reference-data notice Alert box", `      {/* Reference-data notice: only relevant for thickness reports */}
      {header.reportType === "PIPELINE_THICKNESS" && (
        <Alert className="border-amber-200 bg-amber-50">
          <ShieldAlert className="h-4 w-4 text-amber-700" />
          <AlertTitle className="text-amber-900">Reference data notice</AlertTitle>
          <AlertDescription className="text-amber-900">
            Nominal thickness values come from publicly published ASME B36.10M / B36.19M
            reference tables. They are marked UNVERIFIED until an administrator
            confirms them against the licensed / official standard edition. The
            nominal thickness is a dimensional reference value, distinct from
            the measured remaining wall thickness, and is not, by itself, an
            inspection pass / fail criterion.
          </AlertDescription>
        </Alert>
      )}
`);

// 3. ShieldAlert import (no longer used — Alert/AlertTitle/AlertDescription
//    still used by the destructive status Alert, which we keep).
f = replaceOnce(f, "ShieldAlert import", "  ShieldAlert,\n");

// 4. Page-heading description paragraph.
f = replaceOnce(f, "page-heading description", `        <p className="text-sm text-muted-foreground">
          {isEdit
            ? \`Editing \${typeInfo.title.toLowerCase()} — \${typeInfo.formDescription}\`
            : typeInfo.formDescription}
        </p>
`);

// 5. VWS probe grid note.
f = replaceOnce(f, "VWS probe note", `              <p className="text-xs text-muted-foreground mt-0.5">
                One entry per probe used. Frequency, probe size and serial
                number are entered for each probe.
              </p>
`);

// 6. VUTM longitudinal probe note.
f = replaceOnce(f, "VUTM LW probe note", `                  <p className="text-xs text-muted-foreground mt-0.5">
                    One row per longitudinal-wave (0°) probe used. Add a row
                    for each additional probe.
                  </p>
`);

// 7. VUTM component-suggestions note.
f = replaceOnce(f, "VUTM component suggestions note", `              <p className="text-xs text-muted-foreground mb-2">
                {header.vesselOrientation === "VERTICAL"
                  ? "One row per component + direction — pick the direction per row. "
                  : ""}
                Component suggestions: {VUTM_COMPONENT_TYPES.join(", ")} — any custom component can be typed. Nozzle ID suggestions: {VUTM_NOZZLE_ID_SUGGESTIONS.join(", ")}.
              </p>
`);

// 8. VUTM Size/Schedule/WT explainer.
f = replaceOnce(f, "VUTM size/schedule/WT explainer", `              <p className="text-xs text-muted-foreground mb-2">
                <strong>Size / Schedule / WT:</strong> pick the {header.vesselOrientation === "VERTICAL" ? "Nominal Bore / Inch (pink chart: 3 mm / 1/8 … 600 mm / 24)" : "NPS / Pipe Size (1/4 … 48 — 1/8 and 3/8 are not offered)"} first; the Schedule dropdown then shows only the schedules that have a wall-thickness value for that size, and the WT (mm) auto-populates the Nominal Thickness. Invalid size + schedule combinations cannot be selected. WT only — no weight data is used.
              </p>
`);

// 9. Inspection-description PDF note.
f = replaceOnce(f, "inspection description PDF note", `              <p className="text-xs text-muted-foreground">
                This description will be included in the generated PDF report.
              </p>
`);

// 10. Photo-upload success note.
f = replaceOnce(f, "photo PDF note", `                <p className="text-muted-foreground mt-0.5">
                  This photo appears on the first page of the generated PDF,
                  immediately after the Client Details section.
                </p>
`);

// 11. NDT Level 3 "Optional" note.
f = replaceOnce(f, "NDT Level 3 optional note", `                  <p className="text-xs text-muted-foreground">Optional — upload if available.</p>\n`);

// 12. Verbose empty states → compact.
f = replaceOnce(f, "instrument empty state", `No instrument rows. Click Add Row.`, `No instrument rows yet.`);
const emptyRe = /No (probe|test result|visual observation|observation)[a-z ]* rows\. Click Add Row\./g;
const esCount = (f.match(emptyRe) || []).length;
f = f.replace(emptyRe, (m) => `No ${m.replace(/^No /, "").replace(/ rows?\. Click Add Row\./, "")} rows yet.`.replace("s rows", " rows"));
console.log(`  ✓ compacted: ${esCount} empty-state messages`);

write(FORM, f);

// ═══════════════ DETAIL VIEW ═══════════════
let d = read(DETAIL);
d = replaceOnce(d, "detail revision-history description", `            <CardDescription>
              Each approved version is preserved as a separate revision. The currently-approved revision is highlighted.
            </CardDescription>
`);
write(DETAIL, d);

// ═══════════════ TYPE SELECTOR ═══════════════
let s = read(SELECTOR);
s = replaceOnce(s, "selector chooser description (keep warning only)", `        <p className="text-sm text-muted-foreground">
          Select the equipment type and the inspection / test type. The form fields,
          PDF template, and report title are determined by this choice — pick
          carefully, the report type cannot be changed after the report is created.
        </p>`, `        <p className="text-sm text-muted-foreground">
          The report type cannot be changed after the report is created.
        </p>`);
write(SELECTOR, s);

console.log("DONE");
