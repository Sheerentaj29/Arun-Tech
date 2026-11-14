// TANK — Pass 2a: form-view infrastructure (config, interface, defaults,
// row types, states, hydrate, save payload, validation, step-1 wording,
// row handlers). Idempotent. Run: node scripts/tank-pass2a.mjs
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

const p = "src/components/views/pipeline-report-form-view.tsx";
let s = read(p);

// 1. REPORT_TYPE_CONFIG — 4 tank entries before the VESSEL_VISUAL note.
s = rep(s, "config entries",
`  // VESSEL_VISUAL is reserved (shown as a "Coming soon" card in the
  // selector only).`,
`${snippet("config.txt")}
  // VESSEL_VISUAL is reserved (shown as a "Coming soon" card in the
  // selector only).`);

// 2. ReportHeader interface — tank fields after vutmNozzleRows.
s = rep(s, "header interface fields",
`  vutmDishRows: string;
  vutmNozzleRows: string;
  // Condition fields default empty`,
`  vutmDishRows: string;
  vutmNozzleRows: string;
${snippet("interface.txt")}
  // Condition fields default empty`);

// 3. EMPTY_HEADER defaults — tank fields after vutmNozzleRows.
s = rep(s, "header defaults",
`  vutmShellRows: "[]",
  vutmDishRows: "[]",
  vutmNozzleRows: "[]",
  // Condition fields default empty`,
`  vutmShellRows: "[]",
  vutmDishRows: "[]",
  vutmNozzleRows: "[]",
${snippet("defaults.txt")}
  // Condition fields default empty`);

// 4. Row types + helpers — after the VWS quick options, before VUTM.
s = rep(s, "tank row types",
`// ─── VESSEL UT THICKNESS MEASUREMENT (VESSEL_UTM) ───`,
`${snippet("rowtypes.txt")}

// ─── VESSEL UT THICKNESS MEASUREMENT (VESSEL_UTM) ───`);

// 5. Local row states — after vutmShellRows state.
s = rep(s, "tank row states",
`  const [vutmShellRows, setVutmShellRows] = useState<VutmRow[]>([]);
  const [clients, setClients] = useState<ClientItem[]>([]);`,
`  const [vutmShellRows, setVutmShellRows] = useState<VutmRow[]>([]);
${snippet("states.txt")}
  const [clients, setClients] = useState<ClientItem[]>([]);`);

// 6. Hydrate: header fields after vutmNozzleRows.
s = rep(s, "hydrate header fields",
`          vutmShellRows: r.vutmShellRows ?? "[]",
          vutmDishRows: r.vutmDishRows ?? "[]",
          vutmNozzleRows: r.vutmNozzleRows ?? "[]",
          // Condition fields (only populated for PIPELINE_CONDITION reports)`,
`          vutmShellRows: r.vutmShellRows ?? "[]",
          vutmDishRows: r.vutmDishRows ?? "[]",
          vutmNozzleRows: r.vutmNozzleRows ?? "[]",
${snippet("hydrate-header.txt")}
          // Condition fields (only populated for PIPELINE_CONDITION reports)`);

// 7. Hydrate: row parsing after setVutmShellRows(...).
s = rep(s, "hydrate row parsing",
`            (r.vesselOrientation as VutmOrientation | null) ?? null,
          ),
        );
      })
      .catch((e) => setError(e.message))`,
`            (r.vesselOrientation as VutmOrientation | null) ?? null,
          ),
        );
${snippet("hydrate-rows.txt")}
      })
      .catch((e) => setError(e.message))`);

// 8. Save payload — tank branches after the VESSEL_UTM branch.
s = rep(s, "save payload branches",
`        payload.vutmShellRows = JSON.stringify(vutmShellRows);
        payload.vutmDishRows = "[]";
        payload.vutmNozzleRows = "[]";
      } else {`,
`        payload.vutmShellRows = JSON.stringify(vutmShellRows);
        payload.vutmDishRows = "[]";
        payload.vutmNozzleRows = "[]";
${snippet("save.txt")}
      } else {`);

// 9. validateStep2 — tank warnings before the trailing comment.
s = rep(s, "validateStep2 tank branches",
`      if (vutmShellRows.length === 0) {
        toast.warning("No UT thickness measurement rows yet. You can proceed, but you'll need to add at least one component reading before submitting.");
      }
    }
    // PIPELINE_CONDITION and PIPELINE_MPT (piping) have no row requirement.`,
`      if (vutmShellRows.length === 0) {
        toast.warning("No UT thickness measurement rows yet. You can proceed, but you'll need to add at least one component reading before submitting.");
      }
${snippet("validate.txt")}
    // PIPELINE_CONDITION and PIPELINE_MPT (piping) have no row requirement.`);

// 10. IS_TANK_REPORT constant + step-1 wording.
s = rep(s, "IS_TANK_REPORT const",
`  const IS_VESSEL_REPORT: boolean =
    header.reportType === "VESSEL_DPT" ||
    header.reportType === "VESSEL_MPT" ||
    header.reportType === "VESSEL_WELD_SCAN" ||
    header.reportType === "VESSEL_UTM";`,
`  const IS_VESSEL_REPORT: boolean =
    header.reportType === "VESSEL_DPT" ||
    header.reportType === "VESSEL_MPT" ||
    header.reportType === "VESSEL_WELD_SCAN" ||
    header.reportType === "VESSEL_UTM";
${snippet("step1-const.txt")}`);

s = rep(s, "step1 description label",
`            <Label>{IS_VESSEL_REPORT ? "Equipment / Vessel Description" : "Pipeline Description"}</Label>`,
`            <Label>{IS_VESSEL_REPORT ? "Equipment / Vessel Description" : IS_TANK_REPORT ? "Equipment / Tank Description" : "Pipeline Description"}</Label>`);

s = rep(s, "step1 description placeholder",
`              placeholder={
                IS_VESSEL_REPORT
                  ? "e.g. V-311 Final Separator, nozzle welds"
                  : "e.g. 2-inch water pipeline, top pipe rack, west side"
              }`,
`              placeholder={
                IS_VESSEL_REPORT
                  ? "e.g. V-311 Final Separator, nozzle welds"
                  : IS_TANK_REPORT
                    ? "e.g. Storage Tank T-101, shell course welds"
                    : "e.g. 2-inch water pipeline, top pipe rack, west side"
              }`);

s = rep(s, "step1 identification label",
`            <Label>{IS_VESSEL_REPORT ? "Equipment Identification No." : "Pipeline Identification No."}</Label>`,
`            <Label>{IS_VESSEL_REPORT || IS_TANK_REPORT ? "Equipment Identification No." : "Pipeline Identification No."}</Label>`);

s = rep(s, "step1 identification placeholder",
`              placeholder={IS_VESSEL_REPORT ? "Equipment / tag number" : "PID line number"}`,
`              placeholder={IS_VESSEL_REPORT ? "Equipment / tag number" : IS_TANK_REPORT ? "Equipment / tank tag number" : "PID line number"}`);

// 11. Row-operation handlers — after removeVutmLwProbe, before SAVE DRAFT.
s = rep(s, "tank row handlers",
`  // ─── SAVE DRAFT (saves header + custom columns without navigating) ───`,
`${snippet("handlers.txt")}
  // ─── SAVE DRAFT (saves header + custom columns without navigating) ───`);

write(p, s);
console.log("PASS2A DONE");
