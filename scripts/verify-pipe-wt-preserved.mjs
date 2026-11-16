// Verifies requirement 7: existing Piping reports still retrieve nominal
// wall thickness reference values from the PRESERVED PipeStandard table
// (the admin Pipe Standards page was removed, but the data + APIs remain).
//
// Flow: login → pick a real size/schedule from /api/pipe-standards →
// create a PIPELINE_THICKNESS report → POST a measurement → assert the
// returned nominalThicknessMm equals the PipeStandard value → cleanup.
const BASE = "http://localhost:3000";

const loginRes = await fetch(`${BASE}/api/auth`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email: "admin@inspections.demo", password: "admin123" }),
});
const setCookie = loginRes.headers.getSetCookie?.() ?? [];
const token = setCookie.map((c) => c.split(";")[0]).find((c) => c.startsWith("ira_session")) ?? "";
if (!token) { console.error("FATAL: no session token"); process.exit(1); }
const H = { "Content-Type": "application/json", Cookie: token, Authorization: `Bearer ${token}` };

let pass = 0, fail = 0;
function check(name, cond, extra = "") {
  if (cond) { pass++; console.log(`  ✓ ${name}${extra ? " — " + extra : ""}`); }
  else { fail++; console.log(`  ✗ ${name}${extra ? " — " + extra : ""}`); }
}

// 1) Pipe standards reference data still served
const stdRes = await fetch(`${BASE}/api/pipe-standards`, { headers: H });
const std = await stdRes.json();
const items = std.items ?? [];
check("GET /api/pipe-standards works after admin-page removal", stdRes.ok && items.length > 0, `${items.length} rows`);

const pick = items.find((s) => s.nominalSizeInch === "2" && s.schedule === "40")
  ?? items.find((s) => s.nominalSizeInch && s.schedule);
check("found a size/schedule row to test with",
  !!pick, pick ? `${pick.nominalSizeInch}" ${pick.schedule} → nominal ${pick.wallThicknessMm} mm` : "");

// 2) Create a PIPING thickness report
const clients = (await (await fetch(`${BASE}/api/clients`, { headers: H })).json()).items;
const plants = (await (await fetch(`${BASE}/api/plants`, { headers: H })).json()).items;
const plant = plants.find((p) => p.clientId === clients[0]?.id) ?? plants[0];
const employees = (await (await fetch(`${BASE}/api/users`, { headers: H })).json()).items
  ?? (await (await fetch(`${BASE}/api/users`, { headers: H })).json());
const inspector = (Array.isArray(employees) ? employees : employees.items)
  .find((u) => u.role === "EMPLOYEE" || u.role === "INSPECTOR") ?? { id: clients[0]?.id };

const createRes = await fetch(`${BASE}/api/pipeline-inspections`, {
  method: "POST", headers: H,
  body: JSON.stringify({
    reportType: "PIPELINE_THICKNESS",
    clientId: plant?.clientId ?? clients[0]?.id,
    plantId: plant?.id,
    inspectorId: inspector.id,
    reportNumber: `WT-REGRESSION-${Date.now()}`,
    inspectionDate: new Date().toISOString().slice(0, 10),
  }),
});
const report = await createRes.json();
check("PIPELINE_THICKNESS report creates (201)", createRes.status === 201, createRes.status !== 201 ? JSON.stringify(report).slice(0, 160) : report.id);

// 3) POST a measurement — nominal thickness must resolve from PipeStandard
const mRes = await fetch(`${BASE}/api/pipeline-inspections/${report.id}/measurements`, {
  method: "POST", headers: H,
  body: JSON.stringify({
    pipeSizeInch: pick.nominalSizeInch,
    pipeSchedule: pick.schedule,
    actualThicknessMm: pick.wallThicknessMm - 0.2,
    location: "E2E-WT-check",
  }),
});
const measurement = await mRes.json();
check("measurement POST accepted", mRes.status === 201, mRes.status !== 201 ? JSON.stringify(measurement).slice(0, 200) : "");
check("nominalThicknessMm resolved from PipeStandard table",
  measurement?.nominalThicknessMm === pick.wallThicknessMm,
  `expected ${pick.wallThicknessMm}, got ${measurement?.nominalThicknessMm}`);

// 4) Cleanup — delete the test report (keeps DB tidy)
const delRes = await fetch(`${BASE}/api/pipeline-inspections/${report.id}`, { method: "DELETE", headers: H });
check("test report cleaned up", delRes.ok || delRes.status === 404, `HTTP ${delRes.status}`);

console.log(`\n═══ RESULT: ${pass} passed, ${fail} failed ═══`);
process.exit(fail === 0 ? 0 : 1);
