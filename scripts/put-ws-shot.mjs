// One-off: replicate the form's PUT to find why it fails.
const BASE = "http://localhost:3000";
const ID = "cmwg4wmn00003qhwbcvrg8bdm";

const loginRes = await fetch(`${BASE}/api/auth`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email: "admin@inspections.demo", password: "admin123" }),
});
const setCookie = loginRes.headers.getSetCookie?.() ?? [];
const token = setCookie.map((c) => c.split(";")[0]).find((c) => c.startsWith("ira_session")) ?? "";
const H = { "Content-Type": "application/json", Authorization: `Bearer ${token}`, Cookie: token };

// 1. Minimal PUT (just the two fields)
const r1 = await fetch(`${BASE}/api/pipeline-inspections/${ID}`, {
  method: "PUT", headers: H,
  body: JSON.stringify({
    wsScanningSurfaceCondition: "Rough Surface",
    wsProbeRows: JSON.stringify([
      { probeType: "Shear Wave", probeAngle: "45°", frequency: "2 MHz", size: "", probeNo: "P-001", range: "", referenceDb: "", scanningDb: "", _sizeCustom: false },
      { probeType: "Shear Wave", probeAngle: "60°", frequency: "", size: "", probeNo: "", range: "", referenceDb: "", scanningDb: "", _sizeCustom: false },
      { probeType: "Shear Wave", probeAngle: "70°", frequency: "", size: "", probeNo: "", range: "", referenceDb: "", scanningDb: "", _sizeCustom: false },
      { probeType: "Longitudinal Wave", probeAngle: "0°", frequency: "", size: "", probeNo: "", range: "", referenceDb: "", scanningDb: "", _sizeCustom: false },
    ]),
  }),
});
console.log("minimal PUT:", r1.status, (await r1.text()).slice(0, 300));

// 2. Full-object PUT (like the form): GET record, spread, add fields
const get = await fetch(`${BASE}/api/pipeline-inspections/${ID}`, { headers: H });
const rec = await get.json().catch(() => ({}));
const full = { ...rec, wsScanningSurfaceCondition: "Rough Surface" };
delete full.id; delete full.createdAt; delete full.updatedAt;
const r2 = await fetch(`${BASE}/api/pipeline-inspections/${ID}`, {
  method: "PUT", headers: H, body: JSON.stringify(full),
});
console.log("full PUT:", r2.status, (await r2.text()).slice(0, 300));

// 3. Verify stored values now
const get2 = await fetch(`${BASE}/api/pipeline-inspections/${ID}`, { headers: H });
const rec2 = await get2.json().catch(() => ({}));
console.log("stored:", rec2.wsScanningSurfaceCondition, "| row1:", JSON.parse(rec2.wsProbeRows ?? "[]")[0]);
