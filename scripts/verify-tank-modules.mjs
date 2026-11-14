// Verify all 4 Tank modules end-to-end via API: create with field values,
// re-read stored values, generate PDF, assert PDF text contains the
// tank-specific sections. Run: node scripts/verify-tank-modules.mjs
import fs from "fs";
import { execFileSync } from "child_process";

const BASE = "http://localhost:3000";

async function main() {
  const loginRes = await fetch(`${BASE}/api/auth`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "admin@inspections.demo", password: "admin123" }),
  });
  const setCookie = loginRes.headers.getSetCookie?.() ?? [];
  const cookie = setCookie.map((c) => c.split(";")[0]).join("; ");
  if (!cookie) throw new Error("login failed");
  const h = { "Content-Type": "application/json", Cookie: cookie };

  const mk = (n) => `TKVERIFY-${n}-${Math.floor(1000 + Math.random() * 9000)}`;
  const results = [];
  const check = (label, ok, got) => {
    results.push(`${ok ? "✓" : "✗ FAIL"}: ${label}${got !== undefined ? ` got ${JSON.stringify(got)}` : ""}`);
    if (!ok) process.exitCode = 1;
  };

  // ─── 1. TANK_MPT ───
  {
    const rn = mk("MPT");
    const body = {
      reportNumber: rn, reportType: "TANK_MPT", equipmentType: "TANK",
      clientId: "demo", plantId: "demo",
      tmptTestingStandard: "ASME Section V 2023, Article 7",
      tmptMethod: "Wet Continuous", tmptMagneticMedium: "Wet particle iron ink",
      tmptWhiteContrastMake: "Magnaflux", tmptInkProduct: "14A ink",
      tmptRows: JSON.stringify([{ partDetails: "Course-1 vertical seam", idNo: "VS-1", weldDimension: "12 mm thk", indicationSize: "Nil", observationResult: "No relevant indication" }]),
    };
    const ids = await resolveIds(h);
    body.clientId = ids.clientId; body.plantId = ids.plantId;
    const res = await fetch(`${BASE}/api/pipeline-inspections`, { method: "POST", headers: h, body: JSON.stringify(body) });
    const created = await res.json();
    check("TANK_MPT created (201)", res.status === 201, res.status);
    const got = await fetch(`${BASE}/api/pipeline-inspections/${created.id}`, { headers: h }).then((r) => r.json());
    check("TANK_MPT equipmentType=TANK", got.equipmentType === "TANK", got.equipmentType);
    check("TANK_MPT tmptMethod stored", got.tmptMethod === "Wet Continuous", got.tmptMethod);
    check("TANK_MPT rows stored", JSON.parse(got.tmptRows ?? "[]").length === 1);
    await pdfCheck(h, created.id, [
      "STORAGE TANK MAGNETIC PARTICLE TESTING REPORT",
      "Magnetic Particle Testing Parameters",
      "Wet Continuous",
      "Course-1 vertical seam",
      "Magnetic Particle Testing Details",
    ], `TANK_MPT ${rn}`);
  }

  // ─── 2. TANK_DPT ───
  {
    const rn = mk("DPT");
    const ids = await resolveIds(h);
    const body = {
      reportNumber: rn, reportType: "TANK_DPT", equipmentType: "TANK",
      clientId: ids.clientId, plantId: ids.plantId,
      tdptPenetrantType: "Colour contrast (visible)", tdptPenetratingTime: "10 minutes",
      tdptSolventMake: "Magnaflux",
      tdptObservationRows: JSON.stringify([{ partDetails: "Bottom-to-shell weld", idNo: "BS-1", weldDimension: "10 mm thk", indicationSize: "Nil", observationResult: "Accept" }]),
    };
    const res = await fetch(`${BASE}/api/pipeline-inspections`, { method: "POST", headers: h, body: JSON.stringify(body) });
    const created = await res.json();
    check("TANK_DPT created (201)", res.status === 201, res.status);
    const got = await fetch(`${BASE}/api/pipeline-inspections/${created.id}`, { headers: h }).then((r) => r.json());
    check("TANK_DPT equipmentType=TANK", got.equipmentType === "TANK", got.equipmentType);
    check("TANK_DPT tdptPenetrantType stored", got.tdptPenetrantType === "Colour contrast (visible)", got.tdptPenetrantType);
    check("TANK_DPT tdptPenetratingTime stored", got.tdptPenetratingTime === "10 minutes", got.tdptPenetratingTime);
    check("TANK_DPT rows stored", JSON.parse(got.tdptObservationRows ?? "[]").length === 1);
    await pdfCheck(h, created.id, [
      "STORAGE TANK DYE PENETRANT TESTING REPORT",
      "Dye Penetrant Testing Parameters",
      "Colour contrast (visible)",
      "Bottom-to-shell weld",
      "Consumable Details",
    ], `TANK_DPT ${rn}`);
  }

  // ─── 3. TANK_WELD_SCAN ───
  {
    const rn = mk("WS");
    const ids = await resolveIds(h);
    const body = {
      reportNumber: rn, reportType: "TANK_WELD_SCAN", equipmentType: "TANK",
      clientId: ids.clientId, plantId: ids.plantId,
      twsTestingStandard: "ASME Section V 2023, Article 4",
      twsCouplant: "Gel",
      twsProbeDetails: JSON.stringify([
        { probeType: "Longitudinal Wave", probeAngle: "0°", frequency: "4 MHz", probeSize: "10 × 10", serialNo: "P-1" },
        { probeType: "Shear Wave", probeAngle: "45°", frequency: "2 MHz", probeSize: "8 × 9", serialNo: "P-2" },
        { probeType: "Shear Wave", probeAngle: "60°", frequency: "2 MHz", probeSize: "8 × 9", serialNo: "P-3" },
        { probeType: "Shear Wave", probeAngle: "70°", frequency: "2 MHz", probeSize: "8 × 9", serialNo: "P-4" },
      ]),
      twsDetailRows: JSON.stringify([{ component: "Course-2", plateWeldId: "Vertical Seam CS-2", weldDimension: "L600 × T24", probeAngle: "60°", probeFrequency: "2 MHz", observationResult: "No Significant Indication Observed" }]),
    };
    const res = await fetch(`${BASE}/api/pipeline-inspections`, { method: "POST", headers: h, body: JSON.stringify(body) });
    const created = await res.json();
    check("TANK_WELD_SCAN created (201)", res.status === 201, res.status);
    const got = await fetch(`${BASE}/api/pipeline-inspections/${created.id}`, { headers: h }).then((r) => r.json());
    check("TANK_WELD_SCAN equipmentType=TANK", got.equipmentType === "TANK", got.equipmentType);
    check("TANK_WELD_SCAN twsCouplant stored", got.twsCouplant === "Gel", got.twsCouplant);
    check("TANK_WELD_SCAN probe grid stored", JSON.parse(got.twsProbeDetails ?? "[]").length === 4);
    check("TANK_WELD_SCAN rows stored", JSON.parse(got.twsDetailRows ?? "[]").length === 1);
    await pdfCheck(h, created.id, [
      "STORAGE TANK WELD SCAN REPORT",
      "Weld Scan Testing Parameters",
      "Course-2",
      "Vertical Seam CS-2",
      "Probe Details",
    ], `TANK_WELD_SCAN ${rn}`);
  }

  // ─── 4. TANK_UTM readings (already browser-verified; check API min recompute) ───
  {
    const rn = mk("UTM");
    const ids = await resolveIds(h);
    const body = {
      reportNumber: rn, reportType: "TANK_UTM", equipmentType: "TANK",
      clientId: ids.clientId, plantId: ids.plantId,
      tutmTestingStandard: "API 653",
      tutmLwProbeRows: JSON.stringify([{ frequency: "4 MHz", probeSize: "10 mm Ø", serialNo: "UT-9" }]),
      tutmPlateRows: JSON.stringify([
        { moc: "CS", componentType: "Course-1", componentId: "Plate-1", nominalThickness: "10.0", c12: ["9.5"], c3: ["9.9"], c6: ["10.0"], c9: ["9.7"] },
      ]),
    };
    const res = await fetch(`${BASE}/api/pipeline-inspections`, { method: "POST", headers: h, body: JSON.stringify(body) });
    const created = await res.json();
    check("TANK_UTM created (201)", res.status === 201, res.status);
    const got = await fetch(`${BASE}/api/pipeline-inspections/${created.id}`, { headers: h }).then((r) => r.json());
    check("TANK_UTM equipmentType=TANK", got.equipmentType === "TANK", got.equipmentType);
    check("TANK_UTM tutmTestingStandard stored", got.tutmTestingStandard === "API 653", got.tutmTestingStandard);
    check("TANK_UTM readings normalized (clock rows)", JSON.parse(got.tutmPlateRows ?? "[]")[0]?.c12?.[0] === "9.5");
    await pdfCheck(h, created.id, [
      "STORAGE TANK UT THICKNESS MEASUREMENT REPORT",
      "UT Thickness Measurement Parameters",
      "API 653",
      "Course / Plate Measurements (Clock Positions)",
      "Equipment Type: Tank",
    ], `TANK_UTM ${rn}`);
  }

  console.log(results.join("\n"));
  console.log(`\n═══ RESULT: ${results.filter((r) => r.startsWith("✓")).length} passed, ${results.filter((r) => r.startsWith("✗")).length} failed ═══`);
}

async function resolveIds(h) {
  const clients = await fetch(`${BASE}/api/clients`, { headers: h }).then((r) => r.json());
  const coro = clients.items.find((c) => c.name.includes("COROMANDEL"));
  const ennore = coro.plants.find((p) => p.name.includes("Ennore")) ?? coro.plants[0];
  return { clientId: coro.id, plantId: ennore.id };
}

async function pdfCheck(h, id, needles, label) {
  const results = [];
  const check = (ok, msg) => results.push(`${ok ? "✓" : "✗ FAIL"}: ${msg}`);
  const res = await fetch(`${BASE}/api/pipeline-inspections/${id}/pdf?orientation=portrait`, { headers: h });
  check(res.status === 200, `${label}: PDF generated (200) got ${res.status}`);
  if (res.status !== 200) { console.log(results.join("\n")); process.exitCode = 1; return; }
  const buf = Buffer.from(await res.arrayBuffer());
  const tmp = `/tmp/${id}.pdf`;
  fs.writeFileSync(tmp, buf);
  const text = execFileSync("pdftotext", [tmp, "-"], { encoding: "utf8" });
  for (const n of needles) {
    check(text.includes(n), `${label}: PDF contains "${n}"`);
  }
  console.log(results.join("\n"));
  if (results.some((r) => r.startsWith("✗"))) process.exitCode = 1;
  return results;
}


main().catch((e) => { console.error(e); process.exit(1); });
