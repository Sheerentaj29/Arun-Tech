// Runtime verification for the REWORKED VESSEL → UT Thickness Measurement
// (VESSEL_UTM) module — Horizontal/Vertical selection REMOVED, readings are
// ONE unified clock-position table (12/3/6/9 o'clock) starting with ONE
// reading per position, dynamic "+ Add Reading", read-only auto Minimum.
// Also checks Piping / Vessel DPT / MPT / Weld Scan are untouched.
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

// ─── 1. Create VESSEL_UTM report — NO orientation field sent at all ───
console.log("── 1. Unified clock-position readings (no orientation) ──");
const utm = await api("/api/pipeline-inspections", {
  method: "POST",
  body: JSON.stringify({
    reportNumber: `VUTM-C-${ts}`,
    reportType: "VESSEL_UTM",
    equipmentType: "VESSEL",
    clientId: coro.id,
    plantId: ennore.id,
    pipelineDescription: "Test vessel S-V-1 (East side)",
    pipelineIdentificationNumber: "V-C-001",
    vutmDateOfExamination: "2026-11-14",
    vutmTestingStandard: "ASME Section VIII Div. 1",
    vutmAcceptanceCriteria: "Min wall 6.0 mm",
    vutmMethod: "Contact Pulse Echo",
    // One unified row per component. Row 1 mirrors the user's example:
    // 12 o'clock 8.2/8.1, 3 o'clock 8.4, 6 o'clock 8.0/8.3, 9 o'clock 8.5.
    vutmShellRows: JSON.stringify([
      { moc: "Carbon Steel", componentType: "Shell-1", componentId: "S-01", nominalThickness: "12",
        c12: ["8.2", "8.1"], c3: ["8.4"], c6: ["8.0", "8.3"], c9: ["8.5"] },
      { moc: "SS316", componentType: "Nozzle", componentId: "N1", nominalThickness: "8",
        c12: ["7.6"], c3: [], c6: ["7.4", "7.7"], c9: [] },
      { moc: "Carbon Steel", componentType: "Top Dish", componentId: "", nominalThickness: "14",
        c12: [], c3: [], c6: [], c9: [] },
    ]),
  }),
});
check("POST creates VESSEL_UTM without orientation (201)", utm.httpStatus === 201, JSON.stringify(utm).slice(0, 200));
check("vesselOrientation NOT stored (null)", utm.vesselOrientation === null || utm.vesselOrientation === undefined, `got ${utm.vesselOrientation}`);
const utmId = utm.id;

let rows = JSON.parse(utm.vutmShellRows ?? "[]");
check("row count = 3", rows.length === 3, `got ${rows.length}`);
check("row1 min = 8.0 (min of ALL readings across positions)", rows[0]?.min === "8.0", `got ${rows[0]?.min}`);
check("arrays NOT padded to 4 spots (c12 len 2)", rows[0]?.c12?.length === 2, `got ${JSON.stringify(rows[0]?.c12)}`);
check("arrays NOT padded (c3 len 1)", rows[0]?.c3?.length === 1, `got ${JSON.stringify(rows[0]?.c3)}`);
check("empty clock array → one blank slot ['']", rows[1]?.c3?.length === 1 && rows[1]?.c3?.[0] === "", `got ${JSON.stringify(rows[1]?.c3)}`);
check("nozzle row min = 7.4", rows[1]?.min === "7.4", `got ${rows[1]?.min}`);
check("componentType Nozzle + componentId N1 preserved", rows[1]?.componentType === "Nozzle" && rows[1]?.componentId === "N1");
check("Top Dish row with no readings → min empty", rows[2]?.min === "", `got ${rows[2]?.min}`);

// ─── 2. GET preserves everything ───
console.log("── 2. GET preserves the unified rows ──");
const got1 = await api(`/api/pipeline-inspections/${utmId}`);
check("GET returns report", got1.reportNumber === `VUTM-C-${ts}`);
const gotRows = JSON.parse(got1.vutmShellRows ?? "[]");
check("GET rows = 3", gotRows.length === 3);
check("GET row1 readings preserved", JSON.stringify(gotRows[0]?.c12) === JSON.stringify(["8.2", "8.1"]));
check("GET min still 8.0", gotRows[0]?.min === "8.0");

// ─── 3. PUT edit — dynamic add / change / remove readings, min recomputes ───
console.log("── 3. PUT — add / change readings, min recomputes ──");
const edited = JSON.parse(JSON.stringify(gotRows));
edited[0].c12.push("7.9");            // + Add Reading on 12 o'clock → new minimum
edited[0].c6 = ["8.0"];               // remove reading on 6 o'clock
edited[1].c3.push("7.2");             // + Add Reading on 3 o'clock (was empty → [''])
const put1 = await api(`/api/pipeline-inspections/${utmId}`, {
  method: "PUT",
  body: JSON.stringify({ vutmShellRows: JSON.stringify(edited), vutmDishRows: "[]", vutmNozzleRows: "[]" }),
});
check("PUT 200", put1.httpStatus === 200, JSON.stringify(put1).slice(0, 200));
const putRows = JSON.parse(put1.vutmShellRows ?? "[]");
check("12 o'clock now has 3 readings", putRows[0]?.c12?.length === 3, `got ${JSON.stringify(putRows[0]?.c12)}`);
check("6 o'clock reduced to 1 reading", putRows[0]?.c6?.length === 1);
check("min recomputed to 7.9 after adding reading", putRows[0]?.min === "7.9", `got ${putRows[0]?.min}`);
check("nozzle min recomputed to 7.2", putRows[1]?.min === "7.2", `got ${putRows[1]?.min}`);
check("dish/nozzle columns cleared on save", put1.vutmDishRows === "[]" && put1.vutmNozzleRows === "[]");

// ─── 4. Legacy report shapes convert transparently ───
console.log("── 4. Legacy H/V/dish/nozzle data converts, nothing lost ──");
const legacy = await api("/api/pipeline-inspections", {
  method: "POST",
  body: JSON.stringify({
    reportNumber: `VUTM-L-${ts}`,
    reportType: "VESSEL_UTM",
    equipmentType: "VESSEL",
    vesselOrientation: "VERTICAL", // legacy column value — ignored now
    clientId: coro.id,
    plantId: ennore.id,
    pipelineDescription: "Legacy shape conversion test",
    pipelineIdentificationNumber: "V-L-001",
    vutmShellRows: JSON.stringify([
      // Legacy VERTICAL shell rows: one row per direction.
      { moc: "Carbon Steel", componentType: "Shell-1", direction: "North", nominalThickness: "12",
        spot1: "12.1", spot2: "12.0", spot3: "11.9", spot4: "11.8" },
      { moc: "Carbon Steel", componentType: "Shell-1", direction: "East", nominalThickness: "12",
        spot1: "11.7", spot2: "11.6", spot3: "11.5", spot4: "11.4" },
      { moc: "Carbon Steel", componentType: "Shell-1", direction: "South", nominalThickness: "12",
        spot1: "11.3", spot2: "11.2", spot3: "11.1", spot4: "11.0" },
      { moc: "Carbon Steel", componentType: "Shell-1", direction: "West", nominalThickness: "12",
        spot1: "10.9", spot2: "10.8", spot3: "10.7", spot4: "10.6" },
    ]),
    vutmDishRows: JSON.stringify([
      { component: "Bottom Dish", direction: "South", spot1: "9.9", spot2: "9.8", spot3: "9.7", spot4: "9.6" },
    ]),
    vutmNozzleRows: JSON.stringify([
      { nozzleId: "N2", nominalThickness: "8", size: '2"', schedule: "SCH 40", moc: "SS304", spot1: "7.5", spot2: "7.4", spot3: "7.3", spot4: "7.2" },
    ]),
  }),
});
check("POST legacy-shaped report (201)", legacy.httpStatus === 201, JSON.stringify(legacy).slice(0, 200));
const legacyRows = JSON.parse(legacy.vutmShellRows ?? "[]");
check("4 direction rows merged into ONE Shell-1 row", legacyRows.length === 1 && legacyRows[0]?.componentType === "Shell-1", `got ${legacyRows.length}`);
check("North → 12 o'clock (4 readings)", legacyRows[0]?.c12?.length === 4 && legacyRows[0]?.c12?.[0] === "12.1", `got ${JSON.stringify(legacyRows[0]?.c12)}`);
check("East → 3 o'clock", legacyRows[0]?.c3?.[0] === "11.7", `got ${JSON.stringify(legacyRows[0]?.c3)}`);
check("South → 6 o'clock", legacyRows[0]?.c6?.[0] === "11.3");
check("West → 9 o'clock", legacyRows[0]?.c9?.[0] === "10.9");
check("legacy min = 10.6 across merged directions", legacyRows[0]?.min === "10.6", `got ${legacyRows[0]?.min}`);
const legacyDish = JSON.parse(legacy.vutmDishRows ?? "[]");
check("legacy dish → unified row (Top/Bottom Dish in componentType)", legacyDish.length === 1 && legacyDish[0]?.componentType === "Bottom Dish", `got ${JSON.stringify(legacyDish[0])}`);
check("legacy dish readings kept (South→6 o'clock)", legacyDish[0]?.c6?.length === 4 && legacyDish[0]?.min === "9.6", `got ${legacyDish[0]?.min}`);
const legacyNoz = JSON.parse(legacy.vutmNozzleRows ?? "[]");
check("legacy nozzle → unified Nozzle row, spots map to 12/3/6/9", legacyNoz.length === 1 && legacyNoz[0]?.componentType === "Nozzle" && legacyNoz[0]?.componentId === "N2", `got ${JSON.stringify(legacyNoz[0])}`);
check("legacy nozzle min = 7.2", legacyNoz[0]?.min === "7.2", `got ${legacyNoz[0]?.min}`);

// Old horizontal legacy shape (4 fixed spots per clock) also still loads.
const legacyH = await api("/api/pipeline-inspections", {
  method: "POST",
  body: JSON.stringify({
    reportNumber: `VUTM-LH-${ts}`,
    reportType: "VESSEL_UTM",
    equipmentType: "VESSEL",
    vesselOrientation: "HORIZONTAL",
    clientId: coro.id,
    plantId: ennore.id,
    pipelineDescription: "Legacy horizontal shape",
    vutmShellRows: JSON.stringify([
      { moc: "CS", componentType: "Shell-2", componentId: "S-02", nominalThickness: "10",
        c12: ["9.9", "9.8", "9.7", "9.6"], c3: ["9.5"], c6: [], c9: ["9.2", "9.1"] },
    ]),
  }),
});
const legacyHRows = JSON.parse(legacyH.vutmShellRows ?? "[]");
check("legacy horizontal rows pass through with all spots", legacyHRows[0]?.c12?.length === 4 && legacyHRows[0]?.c12?.[3] === "9.6", `got ${JSON.stringify(legacyHRows[0]?.c12)}`);
check("legacy horizontal min = 9.1", legacyHRows[0]?.min === "9.1", `got ${legacyHRows[0]?.min}`);

// ─── 5. PDF: unified layout, entered readings only, no orientation ───
console.log("── 5. PDF output ──");
const pdfRes = await fetch(`${BASE}/api/pipeline-inspections/${utmId}/pdf?orientation=landscape`, { headers: H });
check("PDF 200", pdfRes.status === 200, `${pdfRes.status}`);
const pdfBuf = Buffer.from(await pdfRes.arrayBuffer());
fs.writeFileSync(`/tmp/vutm-clock-${ts}.pdf`, pdfBuf);
check("PDF is a real PDF", pdfBuf.subarray(0, 4).toString() === "%PDF");
const { execSync } = await import("child_process");
let txt = "";
try { txt = execSync(`pdftotext /tmp/vutm-clock-${ts}.pdf - 2>/dev/null`, { encoding: "utf8" }); } catch {}
check("pdftotext available + extracted", txt.length > 100, `len=${txt.length}`);
check("PDF shows UT Thickness Measurement Parameters", txt.includes("UT Thickness Measurement Parameters"));
check("PDF shows UT Thickness Measurement Readings", txt.includes("UT Thickness Measurement Readings"));
check("PDF shows Component Measurements (Clock Positions)", txt.includes("Component Measurements (Clock Positions)"));
check("PDF shows all entered readings (8.2)", txt.includes("8.2"));
check("PDF shows added reading (7.9)", txt.includes("7.9"));
check("PDF shows min 7.9", txt.includes("7.9"));
check("PDF shows Nozzle component row", txt.includes("Nozzle"));
check("PDF shows Top Dish component row", txt.includes("Top Dish"));
check("PDF does NOT mention Orientation", !/orientation/i.test(txt), "found orientation text");

const pdfLegacyRes = await fetch(`${BASE}/api/pipeline-inspections/${legacy.id}/pdf?orientation=landscape`, { headers: H });
const pdfLegacyBuf = Buffer.from(await pdfLegacyRes.arrayBuffer());
fs.writeFileSync(`/tmp/vutm-legacy-${ts}.pdf`, pdfLegacyBuf);
let ltxt = "";
try { ltxt = execSync(`pdftotext /tmp/vutm-legacy-${ts}.pdf - 2>/dev/null`, { encoding: "utf8" }); } catch {}
check("legacy PDF renders all converted readings (10.6 min)", ltxt.includes("10.6"), "");
check("legacy PDF keeps dish readings (9.6)", ltxt.includes("9.6"));
check("legacy PDF keeps nozzle readings (7.2)", ltxt.includes("7.2"));
check("legacy PDF does NOT mention Orientation", !/orientation/i.test(ltxt), "");

// ─── 6. Regression — all other modules work without any orientation ───
console.log("── 6. Regression: other modules unchanged ──");
const base = {
  clientId: coro.id, plantId: ennore.id,
  pipelineDescription: "Regression check", pipelineIdentificationNumber: "R-001",
  inspectionDate: "2026-11-14", fromDate: "2026-11-14", toDate: "2026-11-14",
};
for (const [type, num] of [
  ["PIPELINE_DPT", `RGS-DPT-${ts}`], ["PIPELINE_MPT", `RGS-MPT-${ts}`],
  ["PIPELINE_THICKNESS", `RGS-PT-${ts}`], ["VESSEL_DPT", `RGS-VDPT-${ts}`],
  ["VESSEL_MPT", `RGS-VMPT-${ts}`], ["VESSEL_WELD_SCAN", `RGS-VWS-${ts}`],
]) {
  const r = await api("/api/pipeline-inspections", {
    method: "POST",
    body: JSON.stringify({ ...base, reportNumber: num, reportType: type, equipmentType: type.startsWith("VESSEL") ? "VESSEL" : "PIPING" }),
  });
  check(`${type} creates without orientation (201)`, r.httpStatus === 201, JSON.stringify(r).slice(0, 160));
  check(`${type} vesselOrientation null`, r.vesselOrientation === null || r.vesselOrientation === undefined);
}
const pipingList = await api("/api/pipeline-inspections?limit=100");
check("report list still loads", pipingList.httpStatus === 200 && Array.isArray(pipingList.items));

console.log(`\n═══ RESULT: ${pass} passed, ${fail} failed ═══`);
process.exit(fail === 0 ? 0 : 1);
