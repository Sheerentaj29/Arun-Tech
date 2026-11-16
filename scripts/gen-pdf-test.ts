/**
 * Direct PDF generation test — replicates the API route's input assembly and
 * generates PDFs for several report types to catch runtime errors and verify
 * the layout. Run: bun scripts/gen-pdf-test.ts
 */
import { db } from "../src/lib/db";
import { generatePipelineReportPdf } from "../src/lib/pdf/pipeline-report";
import { mkdirSync, statSync, createWriteStream } from "fs";
import { join } from "path";

const OUT_DIR = "/home/z/my-project/scripts/out";
mkdirSync(OUT_DIR, { recursive: true });

const TYPES = [
  "PIPELINE_THICKNESS",
  "PIPELINE_WELD_SCAN",
  "VESSEL_WELD_SCAN",
  "VESSEL_UTM",
  "PIPELINE_DPT",
  "TANK_DPT",
  "PIPELINE_VISUAL",
];

async function genFor(report: any, tag: string) {
  const full = await db.pipelineInspection.findUnique({
    where: { id: report.id },
    include: {
      client: { select: { id: true, name: true, logoPath: true } },
      plant: { select: { id: true, name: true, location: true, address: true } },
      inspector: { select: { id: true, name: true, email: true } },
      approver: { select: { id: true, name: true, email: true } },
      measurements: { orderBy: { sortOrder: "asc" } },
      reportPhotos: { orderBy: { sortOrder: "asc" } },
      visualObservations: { orderBy: { sortOrder: "asc" } },
      dptObservations: { orderBy: { sortOrder: "asc" } },
      certificates: { orderBy: [{ category: "asc" }, { sortOrder: "asc" }] },
    },
  });
  if (!full) return;
  const outPath = join(OUT_DIR, `${tag}_${full.reportNumber.replace(/[^\w.-]/g, "_")}.pdf`);
  const ws = createWriteStream(outPath);
  const done = new Promise<void>((resolve, reject) => {
    ws.on("finish", resolve);
    ws.on("error", reject);
  });
  const started = Date.now();
  try {
    await generatePipelineReportPdf(
      {
        report: full as never,
        measurements: (full as never as any).measurements as never,
        photos: full.reportPhotos ?? [],
        linkedDrawings: [],
      },
      ws,
      "landscape",
    );
    await done;
    const size = statSync(outPath).size;
    console.log(`OK  ${tag}  ${outPath}  ${(size / 1024).toFixed(0)} KB  ${Date.now() - started}ms`);
  } catch (e) {
    console.log(`ERR ${tag}: ${(e as Error).message}\n${(e as Error).stack?.split("\n").slice(0, 6).join("\n")}`);
  }
}

async function main() {
  const all = await db.pipelineInspection.findMany({
    select: { id: true, reportType: true, reportNumber: true },
  });
  const byType = new Map<string, any[]>();
  for (const r of all) {
    const t = String(r.reportType);
    if (!byType.has(t)) byType.set(t, []);
    byType.get(t)!.push(r);
  }
  console.log("report counts:", [...byType.entries()].map(([t, a]) => `${t}=${a.length}`).join(", "));

  for (const t of TYPES) {
    const list = byType.get(t) ?? [];
    if (list.length === 0) {
      console.log(`SKIP ${t} (none in db)`);
      continue;
    }
    const full = await db.pipelineInspection.findFirst({
      where: { reportType: t },
      orderBy: { updatedAt: "desc" },
      select: { id: true },
    });
    if (full) await genFor(full as any, t);
  }
  await db.$disconnect();
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
