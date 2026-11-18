/**
 * Req-5 tests:
 *  a) PIPELINE_WELD_SCAN 1234567 + synthesized Test Results rows WITH probeType
 *     (Shear Wave / Longitudinal Wave) — portrait + landscape headers.
 *  b) TANK_DPT TKVERIFY-DPT-9835 + 3 in-memory certs → 2+1 flow.
 *  c) VESSEL_UTM VUTM-H2-532907 + 5 in-memory certs → 2+2+1 flow.
 * Nothing persisted to the DB; uploaded files only read.
 */
import { db } from "../src/lib/db";
import { generatePipelineReportPdf } from "../src/lib/pdf/pipeline-report";
import { mkdirSync, statSync, createWriteStream } from "fs";
import { join } from "path";

const OUT = "/home/z/my-project/scripts/out";
mkdirSync(OUT, { recursive: true });

const INCLUDE = {
  client: { select: { id: true, name: true, logoPath: true } },
  plant: { select: { id: true, name: true, location: true, address: true } },
  inspector: { select: { id: true, name: true, email: true } },
  approver: { select: { id: true, name: true, email: true } },
  measurements: true, reportPhotos: true, visualObservations: true,
  dptObservations: true, certificates: { orderBy: [{ category: "asc" as const }, { sortOrder: "asc" as const }] },
};

async function gen(report: any, tag: string, orientation: "portrait" | "landscape" = "portrait") {
  const outPath = join(OUT, `ws_${tag}.pdf`);
  const ws = createWriteStream(outPath);
  const done = new Promise<void>((res, rej) => { ws.on("finish", res); ws.on("error", rej); });
  await generatePipelineReportPdf(
    { report, measurements: report.measurements ?? [], photos: report.reportPhotos ?? [], linkedDrawings: [] },
    ws, orientation,
  );
  await done;
  console.log(`OK  ${tag} (${orientation})  ${(statSync(outPath).size / 1024).toFixed(0)} KB`);
}

const cloneCert = (src: any, title: string) => ({
  ...src, id: `${src.id}-c-${Math.random().toString(36).slice(2, 8)}`, title,
});

async function main() {
  // Source cert files for cloning (read-only)
  const certSrc = await db.pipelineInspection.findFirst({
    where: { reportNumber: "LAYOUT-FIX-001" },
    include: { certificates: true },
  });
  const eqCert = certSrc!.certificates.find((c) => c.category === "EQUIPMENT")!;
  const perCert = certSrc!.certificates.find((c) => c.category === "PERSONNEL")!;

  // a) Weld-scan with probeType rows
  const ws7 = await db.pipelineInspection.findFirst({ where: { reportNumber: "1234567" }, include: INCLUDE });
  if (!ws7) throw new Error("1234567 not found");
  const w: any = { ...ws7 };
  w.wsTestResultRows = JSON.stringify([
    { description: "Long seam weld LS-01", identificationNo: "W-101", weldType: "Butt Weld", probeType: "Shear Wave", probe: "5 MHz 70°", bp: "42.5", sd: "18.0", depth: "12.4", echoHeight: "38", length: "150", observation: "No relevant indication", result: "Accept" },
    { description: "Circumferential weld CJ-02", identificationNo: "W-102", weldType: "Butt Weld", probeType: "Longitudinal Wave", probe: "4 MHz 0°", bp: "30.0", sd: "0", depth: "9.8", echoHeight: "22", length: "150", observation: "No relevant indication", result: "Accept" },
    { description: "Nozzle weld NW-03", identificationNo: "W-103", weldType: "Fillet Weld", probeType: "Shear Wave", probe: "5 MHz 60°", bp: "55.2", sd: "24.5", depth: "15.1", echoHeight: "45", length: "200", observation: "Indication at 180 mm, re-verified", result: "Accept" },
  ]);
  await gen(w, "a_weldscan_ptype", "portrait");
  await gen(w, "a_weldscan_ptype_ls", "landscape");

  // b) Tank DPT + 3 certs → 2+1
  const tank = await db.pipelineInspection.findFirst({ where: { reportNumber: "TKVERIFY-DPT-9835" }, include: INCLUDE });
  if (!tank) throw new Error("tank not found");
  const t: any = { ...tank };
  t.certificates = [eqCert, { ...eqCert, title: "UT Calibration Cert 2" }, cloneCert(eqCert, "UT Calibration Cert 3")];
  await gen(t, "b_tank_3certs");

  // c) Vessel UTM + 5 certs → 2+2+1 (equipment) + none personnel
  const vessel = await db.pipelineInspection.findFirst({ where: { reportNumber: "VUTM-H2-532907" }, include: INCLUDE });
  if (!vessel) throw new Error("vessel not found");
  const v: any = { ...vessel };
  v.certificates = [
    eqCert, { ...eqCert, title: "Instrument Cert 2" }, cloneCert(eqCert, "Instrument Cert 3"),
    { ...eqCert, title: "Instrument Cert 4" }, perCert,
  ];
  await gen(v, "c_vessel_5certs");

  await db.$disconnect();
}
main().catch((e) => { console.error("FATAL:", e); process.exit(1); });
