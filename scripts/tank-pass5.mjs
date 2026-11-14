// TANK — Pass 5: list/history/dashboard badge labels + equipment filter.
// Idempotent. Run: node scripts/tank-pass5.mjs
import fs from "fs";

function read(p) { return fs.readFileSync(p, "utf8"); }
function write(p, s) { fs.writeFileSync(p, s); }
function rep(src, label, find, repl) {
  if (src.includes(repl)) { console.log(`  • ${label}: already applied`); return src; }
  const n = src.split(find).length - 1;
  if (n !== 1) throw new Error(`${label}: expected 1 occurrence, found ${n}`);
  console.log(`  ✓ ${label}`);
  return src.replace(find, repl);
}

const tankLabels = `  TANK_DPT:           { label: "Tank DPT", color: "border-fuchsia-500 text-fuchsia-700" },
  TANK_MPT:           { label: "Tank MPT", color: "border-amber-500 text-amber-700" },
  TANK_WELD_SCAN:     { label: "Tank Weld Scan", color: "border-sky-500 text-sky-700" },
  TANK_UTM:           { label: "Tank UT Thickness", color: "border-teal-500 text-teal-700" },
`;

// 1. pipeline-reports-list-view.tsx — type union + badge map.
{
  const p = "src/components/views/pipeline-reports-list-view.tsx";
  let s = read(p);
  s = rep(s, "list type union",
`  reportType: "PIPELINE_THICKNESS" | "PIPELINE_VISUAL" | "PIPELINE_CONDITION" | "PIPELINE_DPT" | "PIPELINE_MPT" | "PIPELINE_WELD_SCAN" | "VESSEL_DPT" | "VESSEL_MPT" | "VESSEL_WELD_SCAN" | "VESSEL_UTM";`,
`  reportType: "PIPELINE_THICKNESS" | "PIPELINE_VISUAL" | "PIPELINE_CONDITION" | "PIPELINE_DPT" | "PIPELINE_MPT" | "PIPELINE_WELD_SCAN" | "VESSEL_DPT" | "VESSEL_MPT" | "VESSEL_WELD_SCAN" | "VESSEL_UTM" | "TANK_DPT" | "TANK_MPT" | "TANK_WELD_SCAN" | "TANK_UTM";`);
  s = rep(s, "list badge map",
`  VESSEL_UTM:         { label: "Vessel UT Thickness", color: "border-emerald-500 text-emerald-700" },
};`,
`  VESSEL_UTM:         { label: "Vessel UT Thickness", color: "border-emerald-500 text-emerald-700" },
${tankLabels}};`);
  write(p, s);
}

// 2. report-history-view.tsx — badge map + ACTIVE_TYPES + equipment filter.
{
  const p = "src/components/views/report-history-view.tsx";
  let s = read(p);
  s = rep(s, "history badge map",
`  PIPELINE_CONDITION: { label: "Condition",              color: "border-amber-500 text-amber-700" },
};`,
`  PIPELINE_CONDITION: { label: "Condition",              color: "border-amber-500 text-amber-700" },
  // Tank (Storage Tank) modules
  TANK_DPT:           { label: "Tank DPT",               color: "border-fuchsia-500 text-fuchsia-700" },
  TANK_MPT:           { label: "Tank MPT",               color: "border-amber-500 text-amber-700" },
  TANK_WELD_SCAN:     { label: "Tank Weld Scan",         color: "border-sky-500 text-sky-700" },
  TANK_UTM:           { label: "Tank UT Thickness",      color: "border-teal-500 text-teal-700" },
};`);
  s = rep(s, "history ACTIVE_TYPES",
`const ACTIVE_TYPES: Array<{ value: string; label: string }> = [
  { value: "PIPELINE_DPT", label: "Penetrant Testing" },
  { value: "PIPELINE_MPT", label: "Particle Testing" },
  { value: "PIPELINE_WELD_SCAN", label: "Weld Scan" },
  { value: "PIPELINE_THICKNESS", label: "Thickness Measurement" },
];`,
`const ACTIVE_TYPES: Array<{ value: string; label: string }> = [
  { value: "PIPELINE_DPT", label: "Penetrant Testing" },
  { value: "PIPELINE_MPT", label: "Particle Testing" },
  { value: "PIPELINE_WELD_SCAN", label: "Weld Scan" },
  { value: "PIPELINE_THICKNESS", label: "Thickness Measurement" },
  // Tank (Storage Tank) modules
  { value: "TANK_DPT", label: "Tank Penetrant Testing" },
  { value: "TANK_MPT", label: "Tank Particle Testing" },
  { value: "TANK_WELD_SCAN", label: "Tank Weld Scan" },
  { value: "TANK_UTM", label: "Tank Thickness Measurement" },
];`);
  s = rep(s, "history equipment filter",
`                  <SelectItem value="ALL">All equipment</SelectItem>
                  <SelectItem value="PIPING">Piping</SelectItem>
                  <SelectItem value="VESSEL">Vessel</SelectItem>`,
`                  <SelectItem value="ALL">All equipment</SelectItem>
                  <SelectItem value="PIPING">Piping</SelectItem>
                  <SelectItem value="VESSEL">Vessel</SelectItem>
                  <SelectItem value="TANK">Tank</SelectItem>`);
  write(p, s);
}

// 3. Dashboards — badge maps (safe fallback exists; add explicit entries).
for (const p of [
  "src/components/views/admin-dashboard-view.tsx",
  "src/components/views/employee-dashboard-view.tsx",
]) {
  let s = read(p);
  s = rep(s, `${p} badge map`,
`  VESSEL_UTM:         { label: "Vessel UT Thickness", color: "border-emerald-500 text-emerald-700" },
};`,
`  VESSEL_UTM:         { label: "Vessel UT Thickness", color: "border-emerald-500 text-emerald-700" },
${tankLabels}};`);
  write(p, s);
}

console.log("PASS5 DONE");
