// Runtime verification for the VESSEL → UT Thickness Measurement (VESSEL_UTM)
// module — exercises the full API path and checks that existing modules are
// untouched. Run: node scripts/test-vessel-utm.mjs
const BASE = "http://localhost:3000";
const COOKIE_FILE = "/tmp/vutm_cookies.txt";
const TOKEN_FILE = "/tmp/vutm_token.txt";
const fs = await import("fs");

// The API also accepts a Bearer token; grab one via login.
const loginRes = await fetch(`${BASE}/api/auth`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email: "admin@inspections.demo", password: "admin123" }),
});
const setCookie = loginRes.headers.getSetCookie?.() ?? [];
const token = setCookie.map((c) => c.split(";")[0]).find((c) => c.startsWith("ira_session=")) ?? "";
fs.writeFileSync(TOKEN_FILE, token);
const AUTH = token ? { Authorization: `Bearer ${token}`, Cookie: token } : { Cookie: fs.readFileSync(COOKIE_FILE, "utf8").split("\n").filter(l => l.includes("ira_session")).map(l => l.trim().split(/\t/).slice(-2).join("=")).join("; ") };
const H = { "Content-Type": "application/json", ...AUTH };

async function api(path, opts = {}) {
  const res = await fetch(`${BASE}${path}`, { headers: H, ...opts });
  const ct = res.headers.get("content-type") ?? "";
  if (!ct.includes("application/json")) {
    const t = await res.text();
    return { httpStatus: res.status, error: `non-JSON (${ct}): ${t.slice(0, 120)}` };
  }
  const body = await res.json().catch(() => ({}));
  // NOTE: the record body itself carries a `status` workflow field (e.g.
  // "Draft" / "Submitted for Review") — expose the HTTP status separately
  // as `httpStatus` so assertions never mix the two up.
  return { httpStatus: res.status, ...body };
}

let pass = 0, fail = 0;
function check(name, cond, extra = "") {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ FAIL: ${name} ${extra}`); }
}

// ─── Setup: get client + plant (Coromandel / Ennore) ───
console.log("── Setup ──");
const clients = await api("/api/clients");
const coro = (clients.items ?? []).find((c) => c.name.includes("COROMANDEL"));
check("Coromandel client exists", !!coro);
const ennore = coro.plants.find((p) => p.name.includes("Ennore"));
check("Ennore plant exists", !!ennore);

const ts = Date.now().toString().slice(-6);

// ─── 1. Create VESSEL_UTM report — HORIZONTAL ───
console.log("── 1. VESSEL_UTM horizontal report ──");
const horiz = await api("/api/pipeline-inspections", {
  method: "POST",
  body: JSON.stringify({
    reportNumber: `VUTM-H-${ts}`,
    reportType: "VESSEL_UTM",
    equipmentType: "VESSEL",
    vesselOrientation: "HORIZONTAL",
    clientId: coro.id,
    plantId: ennore.id,
    pipelineDescription: "Horizontal test vessel, demo",
    pipelineIdentificationNumber: "V-H-001",
    vutmDateOfExamination: "2026-11-12",
    vutmTestingStandard: "ASME Section VIII Div. 1",
    vutmAcceptanceCriteria: "Min wall 6.0 mm",
    vutmUtProcedure: "UTM-PROC-001",
    vutmEquipmentMake: "Olympus",
    vutmEquipmentModel: "EPOCH 650",
    vutmEquipmentSerialNo: "SN-12345",
    vutmCalibrationDueDate: "2027-01-31",
    vutmCableLengthAndType: "2.0 meters, Coaxial",
    vutmLwProbeRows: JSON.stringify([
      { frequency: "2 MHz", probeSize: "10 mm", serialNo: "LW-01" },
      { frequency: "4 MHz", probeSize: "8 mm", serialNo: "LW-02" },
    ]),
    vutmTypeOfCrystal: "Dual Element",
    vutmCalibrationBlock: "12.5 mm step wedge, Carbon Steel",
    vutmSurfaceTemperature: "32",
    vutmMethod: "Contact Pulse Echo",
    vutmCouplant: "Gel",
    vutmSurfacePreparation: "Wire brush",
    vutmSurfaceFinish: "As welded",
    vutmShellRows: JSON.stringify([
      { moc: "Carbon Steel", componentType: "Shell-1", componentId: "S-01", nominalThickness: "12",
        c12: ["11.8", "11.9", "11.7", "11.6"], c3: ["11.5", "11.4", "11.3", "11.2"],
        c6: ["11.1", "", "10.9", "11.0"], c9: ["10.8", "10.9", "11.0", "10.85"] },
      { moc: "Carbon Steel", componentType: "Nozzle N1 shell", componentId: "S-02", nominalThickness: "10",
        c12: ["9.9", "9.8", "9.7", "9.6"], c3: ["9.5", "9.4", "9.3", "9.2"], c6: ["9.1", "9.0", "8.9", "8.8"], c9: ["8.7", "8.6", "8.5", "8.4"] },
    ]),
    vutmDishRows: JSON.stringify([
      { component: "Top Dish", direction: "East", spot1: "12.1", spot2: "12.0", spot3: "11.9", spot4: "11.8" },
      { component: "Bottom Dish", direction: "South", spot1: "12.5", spot2: "12.4", spot3: "12.3", spot4: "12.2" },
    ]),
    vutmNozzleRows: JSON.stringify([
      { nozzleId: "N1", nominalThickness: "8", size: '2"', schedule: "SCH 40", moc: "Carbon Steel", spot1: "7.9", spot2: "7.8", spot3: "7.7", spot4: "7.6" },
      { nozzleId: "CUSTOM-N9", nominalThickness: "6", size: '1"', schedule: "SCH 80", moc: "SS316", spot1: "5.5", spot2: "", spot3: "5.3", spot4: "abc" },
    ]),
  }),
});
check("POST creates VESSEL_UTM (201)", horiz.httpStatus === 201, JSON.stringify(horiz).slice(0, 200));
check("equipmentType=VESSEL stored", horiz.equipmentType === "VESSEL");
check("vesselOrientation=HORIZONTAL stored", horiz.vesselOrientation === "HORIZONTAL");
const horizId = horiz.id;

// Verify server-side min computation (normalizeVutmRows)
let shellSaved = JSON.parse(horiz.vutmShellRows ?? "[]");
check("shell row 1 min = 10.8 (min of 16 spots)", shellSaved[0]?.min === "10.8", `got ${shellSaved[0]?.min}`);
check("shell row 2 min = 8.4", shellSaved[1]?.min === "8.4", `got ${shellSaved[1]?.min}`);
check("clock arrays normalised to 4 strings", shellSaved[0]?.c12?.length === 4 && shellSaved[0]?.c6?.[1] === "");
const dishSaved = JSON.parse(horiz.vutmDishRows ?? "[]");
check("dish row 1 min = 11.8", dishSaved[0]?.min === "11.8", `got ${dishSaved[0]?.min}`);
const nozSaved = JSON.parse(horiz.vutmNozzleRows ?? "[]");
check("nozzle row 1 min = 7.6", nozSaved[0]?.min === "7.6", `got ${nozSaved[0]?.min}`);
check("nozzle custom ID preserved + non-numeric spot ignored", nozSaved[1]?.nozzleId === "CUSTOM-N9" && nozSaved[1]?.min === "5.3", `got ${nozSaved[1]?.min}`);
const lwSaved = JSON.parse(horiz.vutmLwProbeRows ?? "[]");
check("repeatable LW probe rows saved (2 rows)", lwSaved.length === 2, `got ${lwSaved.length}`);

// ─── 2. Edit-load (GET) preserves everything ───
console.log("── 2. GET preserves all entered data ──");
const got1 = await api(`/api/pipeline-inspections/${horizId}`);
check("GET returns report", got1.reportNumber === `VUTM-H-${ts}`);
check("vutmTestingStandard preserved", got1.vutmTestingStandard === "ASME Section VIII Div. 1");
check("vutmShellRows preserved (2 rows)", JSON.parse(got1.vutmShellRows ?? "[]").length === 2);
check("vutmDishRows preserved (2 rows)", JSON.parse(got1.vutmDishRows ?? "[]").length === 2);
check("vutmNozzleRows preserved (2 rows)", JSON.parse(got1.vutmNozzleRows ?? "[]").length === 2);
check("orientation preserved on GET", got1.vesselOrientation === "HORIZONTAL");

// ─── 3. PUT edit — update a spot reading, min recomputes ───
console.log("── 3. PUT recomputes min + preserves data ──");
const shellRows = JSON.parse(got1.vutmShellRows);
shellRows[0].c9 = ["10.0", "10.1", "9.9", "9.8"]; // lower the 9 o'clock group
const put1 = await api(`/api/pipeline-inspections/${horizId}`, {
  method: "PUT",
  body: JSON.stringify({
    vutmShellRows: JSON.stringify(shellRows),
    vutmSurfaceTemperature: "35",
  }),
});
check("PUT 200", put1.httpStatus === 200, JSON.stringify(put1).slice(0, 150));
const shellAfter = JSON.parse(put1.vutmShellRows ?? "[]");
check("min recomputed to 9.8 after edit", shellAfter[0]?.min === "9.8", `got ${shellAfter[0]?.min}`);
check("other param preserved on partial PUT", put1.vutmTestingStandard === "ASME Section VIII Div. 1");
check("edited param applied", put1.vutmSurfaceTemperature === "35");
check("dish rows untouched by partial PUT", JSON.parse(put1.vutmDishRows ?? "[]").length === 2);

// ─── 4. VESSEL_UTM — VERTICAL report ───
console.log("── 4. VESSEL_UTM vertical report ──");
const vert = await api("/api/pipeline-inspections", {
  method: "POST",
  body: JSON.stringify({
    reportNumber: `VUTM-V-${ts}`,
    reportType: "VESSEL_UTM",
    equipmentType: "VESSEL",
    vesselOrientation: "VERTICAL",
    clientId: coro.id,
    plantId: ennore.id,
    pipelineDescription: "Vertical test vessel, demo",
    vutmTestingStandard: "API 510",
    vutmShellRows: JSON.stringify([
      { moc: "Carbon Steel", componentType: "Shell-1", direction: "East", nominalThickness: "12", spot1: "11.9", spot2: "11.8", spot3: "11.7", spot4: "11.6" },
      { moc: "Carbon Steel", componentType: "Shell-1", direction: "West", nominalThickness: "12", spot1: "11.5", spot2: "11.4", spot3: "11.3", spot4: "11.2" },
      { moc: "Carbon Steel", componentType: "Shell-1", direction: "North", nominalThickness: "12", spot1: "11.1", spot2: "11.0", spot3: "10.9", spot4: "10.8" },
      { moc: "Carbon Steel", componentType: "Shell-1", direction: "South", nominalThickness: "12", spot1: "10.7", spot2: "10.6", spot3: "10.5", spot4: "10.4" },
      { moc: "Carbon Steel", componentType: "Shell-2", direction: "east", nominalThickness: "10", spot1: "9.9", spot2: "9.8", spot3: "9.7", spot4: "9.6" },
    ]),
    vutmDishRows: JSON.stringify([
      { component: "Top Dish", direction: "North", spot1: "12.2", spot2: "12.1", spot3: "12.0", spot4: "11.9" },
    ]),
    vutmNozzleRows: JSON.stringify([
      { nozzleId: "N1", nominalThickness: "8", size: '3"', schedule: "SCH 40", moc: "Carbon Steel", spot1: "7.9", spot2: "7.8", spot3: "7.7", spot4: "7.6" },
    ]),
  }),
});
check("POST creates vertical VESSEL_UTM (201)", vert.httpStatus === 201, JSON.stringify(vert).slice(0, 150));
check("vesselOrientation=VERTICAL stored", vert.vesselOrientation === "VERTICAL");
const vShell = JSON.parse(vert.vutmShellRows ?? "[]");
check("vertical shell min row 1 = 11.6", vShell[0]?.min === "11.6", `got ${vShell[0]?.min}`);
check("vertical shell min row 5 (E/W/N/S row) = 9.6", vShell[4]?.min === "9.6", `got ${vShell[4]?.min}`);
check("direction normalised (lowercase 'east' → 'East')", vShell[4]?.direction === "East", `got ${vShell[4]?.direction}`);

// ─── 5. Data separation: horizontal data not overwritten by vertical ───
console.log("── 5. Horizontal / vertical data separated ──");
const gotH = await api(`/api/pipeline-inspections/${horizId}`);
const gotV = await api(`/api/pipeline-inspections/${vert.id}`);
check("horizontal shell rows intact (2 rows)", JSON.parse(gotH.vutmShellRows ?? "[]").length === 2);
check("horizontal keeps clock-position shape (c12 array)", Array.isArray(JSON.parse(gotH.vutmShellRows ?? "[]")[0]?.c12));
check("vertical shell rows intact (5 rows)", JSON.parse(gotV.vutmShellRows ?? "[]").length === 5);
check("vertical keeps direction shape (spot1 field)", JSON.parse(gotV.vutmShellRows ?? "[]")[0]?.spot1 === "11.9");
check("horizontal still HORIZONTAL", gotH.vesselOrientation === "HORIZONTAL");
check("vertical still VERTICAL", gotV.vesselOrientation === "VERTICAL");

// ─── 6. Submit validation ───
console.log("── 6. Submit validation ──");
const emptyUtm = await api("/api/pipeline-inspections", {
  method: "POST",
  body: JSON.stringify({
    reportNumber: `VUTM-E-${ts}`,
    reportType: "VESSEL_UTM",
    equipmentType: "VESSEL",
    vesselOrientation: "VERTICAL",
    clientId: coro.id,
    plantId: ennore.id,
  }),
});
const submitEmpty = await api(`/api/pipeline-inspections/${emptyUtm.id}/submit`, { method: "POST", body: JSON.stringify({}) });
check("submit without rows rejected (400)", submitEmpty.httpStatus === 400, `got ${submitEmpty.httpStatus}: ${submitEmpty.error}`);
const submitH = await api(`/api/pipeline-inspections/${horizId}/submit`, { method: "POST", body: JSON.stringify({}) });
check("submit horizontal with rows works", submitH.httpStatus === 200 && submitH.status === "Submitted for Review", `HTTP ${submitH.httpStatus}: ${submitH.status} ${submitH.error ?? ""}`);
const submitV = await api(`/api/pipeline-inspections/${vert.id}/submit`, { method: "POST", body: JSON.stringify({}) });
check("submit vertical with rows works", submitV.httpStatus === 200 && submitV.status === "Submitted for Review", `HTTP ${submitV.httpStatus}: ${submitV.status} ${submitV.error ?? ""}`);

// ─── 7. PDF generation ───
console.log("── 7. PDF generation ──");
async function pdfCheck(id, name) {
  const res = await fetch(`${BASE}/api/pipeline-inspections/${id}/pdf?orientation=landscape`, { headers: AUTH });
  if (!res.ok) { check(`${name} PDF generated`, false, `HTTP ${res.status}`); return; }
  const buf = Buffer.from(await res.arrayBuffer());
  const ok = buf.subarray(0, 5).toString() === "%PDF-";
  check(`${name} PDF generated (${buf.length} bytes)`, ok && buf.length > 4000);
  fs.writeFileSync(`/tmp/vutm_${name}.pdf`, buf);
}
await pdfCheck(horizId, "horizontal");
await pdfCheck(vert.id, "vertical");

// ─── 8. Piping regression: existing data untouched + new piping report still works ───
console.log("── 8. Piping regression ──");
const list = await api("/api/pipeline-inspections?pageSize=100");
const pipingThickness = (list.items ?? []).filter((r) => r.reportType === "PIPELINE_THICKNESS");
check("existing piping thickness reports present in list", pipingThickness.length > 0, `found ${pipingThickness.length}`);
const firstPipe = pipingThickness[0];
if (firstPipe) {
  const gotP = await api(`/api/pipeline-inspections/${firstPipe.id}`);
  check("piping thickness report keeps its measurement rows", Array.isArray(gotP.measurements) && gotP.measurements.length > 0, `got ${gotP.measurements?.length}`);
  check("piping report has NO vessel orientation", gotP.vesselOrientation === null || gotP.vesselOrientation === undefined, `got ${gotP.vesselOrientation}`);
  // Existing piping thickness PDF still renders
  const res = await fetch(`${BASE}/api/pipeline-inspections/${firstPipe.id}/pdf`, { headers: AUTH });
  const buf = Buffer.from(await res.arrayBuffer());
  check("existing piping thickness PDF still renders", res.ok && buf.subarray(0, 5).toString() === "%PDF-", `HTTP ${res.status}`);
}
const newPipe = await api("/api/pipeline-inspections", {
  method: "POST",
  body: JSON.stringify({
    reportNumber: `PIPE-REG-${ts}`,
    reportType: "PIPELINE_THICKNESS",
    clientId: coro.id,
    plantId: ennore.id,
    pipelineDescription: "piping regression test",
  }),
});
check("new PIPELINE_THICKNESS (piping) report still creatable", newPipe.httpStatus === 201, JSON.stringify(newPipe).slice(0, 120));
check("piping report NOT given vessel orientation", newPipe.vesselOrientation === null, `got ${newPipe.vesselOrientation}`);

// ─── 9. Vessel siblings untouched: VESSEL_WELD_SCAN / VESSEL_DPT still accepted; VESSEL_VISUAL rejected ───
console.log("── 9. Other vessel modules unchanged ──");
const ws = await api("/api/pipeline-inspections", {
  method: "POST",
  body: JSON.stringify({
    reportNumber: `VWS-REG-${ts}`,
    reportType: "VESSEL_WELD_SCAN",
    equipmentType: "VESSEL",
    clientId: coro.id,
    plantId: ennore.id,
    vwsDetailRows: JSON.stringify([{ component: "Shell-1", plateWeldId: "Longitudinal Weld", weldDimension: "L600", probeAngle: "60°", probeFrequency: "4 MHz", observationResult: "Accept" }]),
  }),
});
check("VESSEL_WELD_SCAN still creatable (unchanged)", ws.httpStatus === 201, JSON.stringify(ws).slice(0, 120));
check("VESSEL_WELD_SCAN gets NO orientation (no orientation step)", ws.vesselOrientation === null, `got ${ws.vesselOrientation}`);
check("VESSEL_WELD_SCAN data intact", JSON.parse(ws.vwsDetailRows ?? "[]").length === 1);
const vs = await api("/api/pipeline-inspections", {
  method: "POST",
  body: JSON.stringify({
    reportNumber: `VVIS-NEG-${ts}`,
    reportType: "VESSEL_VISUAL",
    equipmentType: "VESSEL",
    clientId: coro.id,
    plantId: ennore.id,
  }),
});
check("VESSEL_VISUAL rejected by API (coming soon only — falls back to thickness)", vs.reportType !== "VESSEL_VISUAL", `got ${vs.reportType}`);

// ─── Cleanup: delete the API test reports ───
console.log("── Cleanup ──");
for (const id of [horizId, vert.id, emptyUtm.id, newPipe.id, ws.id, vs.id]) {
  const del = await api(`/api/pipeline-inspections/${id}`, { method: "DELETE" });
  check(`cleanup delete ${id.slice(-6)}`, del.httpStatus === 200 || del.ok, `HTTP ${del.httpStatus}`);
}

console.log(`\n═══ RESULT: ${pass} passed, ${fail} failed ═══`);
process.exit(fail > 0 ? 1 : 0);
