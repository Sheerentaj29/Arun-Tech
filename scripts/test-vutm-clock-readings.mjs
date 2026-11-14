// Runtime verification for the REWORKED VESSEL → UT Thickness Measurement
// (VESSEL_UTM) module — Horizontal / Vertical selection restored (VESSEL_UTM
// ONLY):
//   • HORIZONTAL → clock positions (12 / 3 / 6 / 9 o'clock), ONE reading
//     slot per position initially, dynamic "+ Add Reading", auto Minimum.
//   • VERTICAL   → directions (East / West / North / South), one row per
//     component + direction, ONE reading initially, dynamic, auto Minimum.
// No other module asks for an orientation (DPT / MPT / Weld Scan / Piping).
// Run: node scripts/test-vutm-clock-readings.mjs
const BASE = "http://localhost:3000";
const fs = await import("fs");

const loginRes = await fetch(`${BASE}/api/auth`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email: "admin@inspections.demo", password: "admin123" }),
});
const setCookie = loginRes.headers.getSetCookie?.() ?? [];
const token = setCookie.map((c) => c.split(";")[0]).find((c) => c.startsWith("ira_session")) ?? "";
if (!token) { console.error("FATAL: no session token"); process.exit(1); }
const H = { "Content-Type": "application/json", Authorization: `Bearer ${token}`, Cookie: token };

async function api(path, opts = {}) {
  const res = await fetch(`${BASE}${path}`, { headers: H, ...opts });
  const ct = res.headers.get("content-type") ?? "";
  if (!ct.includes("application/json")) {
    const t = await res.text();
    return { httpStatus: res.status, error: `non-JSON (${ct}): ${t.slice(0, 120)}` };
  }
  const body = await res.json().catch(() => ({}));
  return { httpStatus: res.status, ...body };
}

let pass = 0, fail = 0;
function check(name, cond, extra = "") {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ FAIL: ${name} ${extra}`); }
}

console.log("── Setup ──");
const clients = await api("/api/clients");
const coro = (clients.items ?? []).find((c) => c.name.includes("COROMANDEL"));
check("Coromandel client exists", !!coro);
const ennore = coro.plants.find((p) => p.name.includes("Ennore"));
check("Ennore plant exists", !!ennore);
const ts = Date.now().toString().slice(-6);
const base = { clientId: coro.id, plantId: ennore.id };
const { execSync } = await import("child_process");

// ─── 1. HORIZONTAL report — clock positions, dynamic readings ───
console.log("── 1. VESSEL_UTM HORIZONTAL (clock positions) ──");
const horiz = await api("/api/pipeline-inspections", {
  method: "POST",
  body: JSON.stringify({
    ...base,
    reportNumber: `VUTM-H2-${ts}`,
    reportType: "VESSEL_UTM",
    equipmentType: "VESSEL",
    vesselOrientation: "HORIZONTAL",
    pipelineDescription: "Horizontal survey vessel",
    pipelineIdentificationNumber: "V-H-101",
    vutmDateOfExamination: "2026-11-14",
    vutmTestingStandard: "ASME Section VIII Div. 1",
    vutmMethod: "Contact Pulse Echo",
    // User's example: 12 o'clock 8.2/8.1, 3 o'clock 8.4, 6 o'clock 8.0/8.3,
    // 9 o'clock 8.5 → Minimum = 8.0.
    vutmShellRows: JSON.stringify([
      { moc: "Carbon Steel", componentType: "Shell-1", componentId: "S-01", nominalThickness: "12",
        c12: ["8.2", "8.1"], c3: ["8.4"], c6: ["8.0", "8.3"], c9: ["8.5"] },
      { moc: "SS316", componentType: "Nozzle", componentId: "N1", nominalThickness: "8",
        c12: ["7.6"], c3: [], c6: ["7.4", "7.7"], c9: [] },
    ]),
  }),
});
check("POST creates HORIZONTAL VESSEL_UTM (201)", horiz.httpStatus === 201, JSON.stringify(horiz).slice(0, 200));
check("vesselOrientation = HORIZONTAL stored", horiz.vesselOrientation === "HORIZONTAL", `got ${horiz.vesselOrientation}`);
const hRows = JSON.parse(horiz.vutmShellRows ?? "[]");
check("row1 min = 8.0 (min across ALL clock readings)", hRows[0]?.min === "8.0", `got ${hRows[0]?.min}`);
check("arrays dynamic — NOT padded to 4", hRows[0]?.c12?.length === 2 && hRows[0]?.c3?.length === 1, `got ${JSON.stringify(hRows[0]?.c12)}`);
check("empty clock array → one blank slot", hRows[1]?.c3?.length === 1 && hRows[1]?.c3?.[0] === "");
check("nozzle row min = 7.4", hRows[1]?.min === "7.4", `got ${hRows[1]?.min}`);
const horizId = horiz.id;

// ─── 2. VERTICAL report — directions, dynamic readings ───
console.log("── 2. VESSEL_UTM VERTICAL (directions) ──");
const vert = await api("/api/pipeline-inspections", {
  method: "POST",
  body: JSON.stringify({
    ...base,
    reportNumber: `VUTM-V2-${ts}`,
    reportType: "VESSEL_UTM",
    equipmentType: "VESSEL",
    vesselOrientation: "VERTICAL",
    pipelineDescription: "Vertical survey vessel",
    pipelineIdentificationNumber: "V-V-101",
    vutmDateOfExamination: "2026-11-14",
    vutmMethod: "Contact Pulse Echo",
    vutmShellRows: JSON.stringify([
      { moc: "Carbon Steel", componentType: "Shell-1", componentId: "S-01", nominalThickness: "12",
        direction: "North", readings: ["9.8", "9.6"] },
      { moc: "Carbon Steel", componentType: "Shell-1", componentId: "S-01", nominalThickness: "12",
        direction: "East", readings: ["9.4"] },
      { moc: "Carbon Steel", componentType: "Shell-1", componentId: "S-01", nominalThickness: "12",
        direction: "South", readings: ["9.2", "9.5"] },
      { moc: "Carbon Steel", componentType: "Shell-1", componentId: "S-01", nominalThickness: "12",
        direction: "West", readings: ["9.0"] },
      { moc: "SS304", componentType: "Nozzle", componentId: "N2", nominalThickness: "8",
        direction: "East", readings: ["7.8"] },
    ]),
  }),
});
check("POST creates VERTICAL VESSEL_UTM (201)", vert.httpStatus === 201, JSON.stringify(vert).slice(0, 200));
check("vesselOrientation = VERTICAL stored", vert.vesselOrientation === "VERTICAL", `got ${vert.vesselOrientation}`);
const vRows = JSON.parse(vert.vutmShellRows ?? "[]");
check("vertical rows kept as direction rows (5)", vRows.length === 5, `got ${vRows.length}`);
check("North row readings preserved (2)", vRows[0]?.direction === "North" && vRows[0]?.readings?.length === 2, `got ${JSON.stringify(vRows[0])}`);
check("North row min = 9.6", vRows[0]?.min === "9.6", `got ${vRows[0]?.min}`);
check("West row min = 9.0", vRows[3]?.min === "9.0", `got ${vRows[3]?.min}`);
check("nozzle direction row min = 7.8", vRows[4]?.min === "7.8", `got ${vRows[4]?.min}`);
const vertId = vert.id;

// ─── 3. Report WITHOUT orientation → null, clock rows (default) ───
console.log("── 3. No orientation sent → null, clock rows ──");
const noOri = await api("/api/pipeline-inspections", {
  method: "POST",
  body: JSON.stringify({
    ...base,
    reportNumber: `VUTM-N2-${ts}`,
    reportType: "VESSEL_UTM",
    equipmentType: "VESSEL",
    pipelineDescription: "No orientation report",
    vutmShellRows: JSON.stringify([
      { moc: "CS", componentType: "Shell-2", componentId: "S-02", nominalThickness: "10",
        c12: ["9.9", "9.8"], c3: ["9.7"], c6: ["9.6"], c9: ["9.5"] },
    ]),
  }),
});
check("POST without orientation (201)", noOri.httpStatus === 201);
check("vesselOrientation stored null", noOri.vesselOrientation === null || noOri.vesselOrientation === undefined, `got ${noOri.vesselOrientation}`);
const nRows = JSON.parse(noOri.vutmShellRows ?? "[]");
check("clock rows normalized + min 9.5", nRows[0]?.min === "9.5", `got ${nRows[0]?.min}`);

// ─── 4. Legacy shapes convert per orientation, nothing lost ───
console.log("── 4. Legacy conversion (VERTICAL + HORIZONTAL) ──");
const legacyV = await api("/api/pipeline-inspections", {
  method: "POST",
  body: JSON.stringify({
    ...base,
    reportNumber: `VUTM-LV-${ts}`,
    reportType: "VESSEL_UTM",
    equipmentType: "VESSEL",
    vesselOrientation: "VERTICAL",
    pipelineDescription: "Legacy vertical shapes",
    // Legacy VERTICAL shell rows: direction + fixed Spot 1–4.
    vutmShellRows: JSON.stringify([
      { moc: "Carbon Steel", componentType: "Shell-1", direction: "North", nominalThickness: "12",
        spot1: "12.1", spot2: "12.0", spot3: "11.9", spot4: "11.8" },
      { moc: "Carbon Steel", componentType: "Shell-1", direction: "East", nominalThickness: "12",
        spot1: "11.7", spot2: "11.6", spot3: "11.5", spot4: "11.4" },
    ]),
    // Legacy dish + nozzle columns.
    vutmDishRows: JSON.stringify([
      { component: "Bottom Dish", direction: "South", spot1: "9.9", spot2: "9.8", spot3: "9.7", spot4: "9.6" },
    ]),
    vutmNozzleRows: JSON.stringify([
      { nozzleId: "N3", nominalThickness: "8", size: '2"', schedule: "SCH 40", moc: "SS304", spot1: "7.5", spot2: "7.4", spot3: "7.3", spot4: "7.2" },
    ]),
  }),
});
const lvRows = JSON.parse(legacyV.vutmShellRows ?? "[]");
check("legacy direction rows → readings arrays", lvRows.length === 2 && lvRows[0]?.direction === "North" && lvRows[0]?.readings?.length === 4, `got ${JSON.stringify(lvRows[0])}`);
check("legacy North min = 11.8", lvRows[0]?.min === "11.8", `got ${lvRows[0]?.min}`);
const lvDish = JSON.parse(legacyV.vutmDishRows ?? "[]");
check("legacy dish → direction row (South, 4 readings)", lvDish.length === 1 && lvDish[0]?.direction === "South" && lvDish[0]?.readings?.length === 4 && lvDish[0]?.min === "9.6", `got ${JSON.stringify(lvDish[0])}`);
const lvNoz = JSON.parse(legacyV.vutmNozzleRows ?? "[]");
check("legacy nozzle → 4 direction rows (N/E/S/W)", lvNoz.length === 4 && lvNoz[0]?.direction === "North" && lvNoz[3]?.direction === "West", `got ${JSON.stringify(lvNoz.map(r => r.direction))}`);
check("legacy nozzle readings preserved", lvNoz[0]?.readings?.[0] === "7.5" && lvNoz[3]?.readings?.[0] === "7.2", "");

const legacyH = await api("/api/pipeline-inspections", {
  method: "POST",
  body: JSON.stringify({
    ...base,
    reportNumber: `VUTM-LH2-${ts}`,
    reportType: "VESSEL_UTM",
    equipmentType: "VESSEL",
    vesselOrientation: "HORIZONTAL",
    pipelineDescription: "Legacy horizontal shapes",
    vutmShellRows: JSON.stringify([
      { moc: "CS", componentType: "Shell-2", componentId: "S-02", nominalThickness: "10",
        c12: ["9.9", "9.8", "9.7", "9.6"], c3: ["9.5"], c6: [], c9: ["9.2", "9.1"] },
    ]),
  }),
});
const lhRows = JSON.parse(legacyH.vutmShellRows ?? "[]");
check("legacy horizontal rows pass through with all spots", lhRows[0]?.c12?.length === 4 && lhRows[0]?.min === "9.1", `got ${JSON.stringify(lhRows[0])}`);

// ─── 5. PUT — add readings dynamically, min recomputes ───
console.log("── 5. PUT — dynamic add / change readings ──");
const hEdited = JSON.parse(JSON.stringify(hRows));
hEdited[0].c12.push("7.9");              // + Add Reading on 12 o'clock
hEdited[0].c6 = ["8.0"];                 // remove reading on 6 o'clock
const putH = await api(`/api/pipeline-inspections/${horizId}`, {
  method: "PUT",
  body: JSON.stringify({ vutmShellRows: JSON.stringify(hEdited), vesselOrientation: "HORIZONTAL", vutmDishRows: "[]", vutmNozzleRows: "[]" }),
});
check("HORIZONTAL PUT 200", putH.httpStatus === 200, JSON.stringify(putH).slice(0, 160));
const putHRows = JSON.parse(putH.vutmShellRows ?? "[]");
check("12 o'clock now has 3 readings", putHRows[0]?.c12?.length === 3);
check("min recomputed to 7.9", putHRows[0]?.min === "7.9", `got ${putHRows[0]?.min}`);

const vEdited = JSON.parse(JSON.stringify(vRows));
vEdited[1].readings.push("8.8");         // + Add Reading on East row
const putV = await api(`/api/pipeline-inspections/${vertId}`, {
  method: "PUT",
  body: JSON.stringify({ vutmShellRows: JSON.stringify(vEdited), vesselOrientation: "VERTICAL", vutmDishRows: "[]", vutmNozzleRows: "[]" }),
});
check("VERTICAL PUT 200", putV.httpStatus === 200, JSON.stringify(putV).slice(0, 160));
const putVRows = JSON.parse(putV.vutmShellRows ?? "[]");
check("East row now has 2 readings", putVRows[1]?.readings?.length === 2);
check("East min recomputed to 8.8", putVRows[1]?.min === "8.8", `got ${putVRows[1]?.min}`);
check("orientation unchanged on edit", putV.vesselOrientation === "VERTICAL");

// ─── 6. PDF — orientation line + correct structure ───
console.log("── 6. PDF output (H and V) ──");
const pdfH = await fetch(`${BASE}/api/pipeline-inspections/${horizId}/pdf?orientation=landscape`, { headers: H });
const pdfHBuf = Buffer.from(await pdfH.arrayBuffer());
fs.writeFileSync(`/tmp/vutm-h2-${ts}.pdf`, pdfHBuf);
check("HORIZONTAL PDF 200", pdfH.status === 200 && pdfHBuf.subarray(0, 4).toString() === "%PDF");
let htxt = "";
try { htxt = execSync(`pdftotext /tmp/vutm-h2-${ts}.pdf - 2>/dev/null`, { encoding: "utf8" }); } catch {}
check("H PDF: Equipment Type: Vessel", htxt.includes("Equipment Type: Vessel"));
check("H PDF: Inspection: UT Thickness Measurement", htxt.includes("Inspection: UT Thickness Measurement"));
check("H PDF: Orientation: Horizontal", htxt.includes("Orientation: Horizontal"));
check("H PDF: clock table heading", htxt.includes("Component Measurements (Clock Positions)"));
check("H PDF: 12 O'clock column", /12 O'?clock/.test(htxt));
check("H PDF: added reading 7.9 + min 7.9", htxt.includes("7.9"));
check("H PDF: no direction table", !htxt.includes("Component Measurements (Directions)"));
check("H PDF: cover shows Vessel Orientation row", htxt.includes("Vessel Orientation") && htxt.includes("Horizontal Vessel"));

const pdfV = await fetch(`${BASE}/api/pipeline-inspections/${vertId}/pdf?orientation=landscape`, { headers: H });
const pdfVBuf = Buffer.from(await pdfV.arrayBuffer());
fs.writeFileSync(`/tmp/vutm-v2-${ts}.pdf`, pdfVBuf);
check("VERTICAL PDF 200", pdfV.status === 200 && pdfVBuf.subarray(0, 4).toString() === "%PDF");
let vtxt = "";
try { vtxt = execSync(`pdftotext /tmp/vutm-v2-${ts}.pdf - 2>/dev/null`, { encoding: "utf8" }); } catch {}
check("V PDF: Orientation: Vertical", vtxt.includes("Orientation: Vertical"));
check("V PDF: direction table heading", vtxt.includes("Component Measurements (Directions)"));
check("V PDF: Direction column + North/East rows", vtxt.includes("Direction") && vtxt.includes("North") && vtxt.includes("East"));
check("V PDF: added reading 8.8 + min 8.8", vtxt.includes("8.8"));
check("V PDF: no clock table", !vtxt.includes("Component Measurements (Clock Positions)"));

// ─── 7. Regression — orientation accepted ONLY for VESSEL_UTM ───
console.log("── 7. Regression: other modules never get an orientation ──");
for (const [type, num, eq] of [
  ["PIPELINE_DPT", `RGS2-DPT-${ts}`, "PIPING"],
  ["PIPELINE_MPT", `RGS2-MPT-${ts}`, "PIPING"],
  ["PIPELINE_THICKNESS", `RGS2-PT-${ts}`, "PIPING"],
  ["VESSEL_DPT", `RGS2-VDPT-${ts}`, "VESSEL"],
  ["VESSEL_MPT", `RGS2-VMPT-${ts}`, "VESSEL"],
  ["VESSEL_WELD_SCAN", `RGS2-VWS-${ts}`, "VESSEL"],
]) {
  // Send vesselOrientation: "HORIZONTAL" — it must be IGNORED (stored null).
  const r = await api("/api/pipeline-inspections", {
    method: "POST",
    body: JSON.stringify({
      ...base, reportNumber: num, reportType: type, equipmentType: eq,
      vesselOrientation: "HORIZONTAL",
      pipelineDescription: "Regression check", pipelineIdentificationNumber: "R-002",
      inspectionDate: "2026-11-14", fromDate: "2026-11-14", toDate: "2026-11-14",
    }),
  });
  check(`${type} creates (201) even with orientation in payload`, r.httpStatus === 201, JSON.stringify(r).slice(0, 140));
  check(`${type} vesselOrientation forced to null`, r.vesselOrientation === null || r.vesselOrientation === undefined, `got ${r.vesselOrientation}`);
}
const list = await api("/api/pipeline-inspections?limit=100");
check("report list still loads", list.httpStatus === 200 && Array.isArray(list.items));

console.log(`\n═══ RESULT: ${pass} passed, ${fail} failed ═══`);
process.exit(fail === 0 ? 0 : 1);
