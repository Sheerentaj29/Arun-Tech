/**
 * Certificate layout verification: generates PDFs for
 *   a) LAYOUT-FIX-001 as-is        → 2 equipment + 2 personnel (one page each)
 *   b) +1 equipment (in memory)    → 3 equipment: page 1 = 2, page 2 = 1
 *   c) +3 equipment, +1 personnel  → 5 equipment: 2+2+1; 3 personnel: 2+1
 *   d) report 1111                 → 1 equipment + 1 personnel (full pages)
 * Nothing is written to the database or to uploaded files.
 */
import { db } from "../src/lib/db";
import { generatePipelineReportPdf } from "../src/lib/pdf/pipeline-report";
import { mkdirSync, statSync, createWriteStream } from "fs";
import { join } from "path";

const OUT_DIR = "/home/z/my-project/scripts/out";
mkdirSync(OUT_DIR, { recursive: true });

async function gen(report: any, tag: string) {
  const outPath = join(OUT_DIR, `certs_${tag}.pdf`);
  const ws = createWriteStream(outPath);
  const done = new Promise<void>((res, rej) => {
    ws.on("finish", res);
    ws.on("error", rej);
  });
  await generatePipelineReportPdf(
    {
      report,
      measurements: (report as any).measurements ?? [],
      photos: report.reportPhotos ?? [],
      linkedDrawings: [],
    },
    ws,
    "portrait",
  );
  await done;
  console.log(`OK  ${tag}  ${(statSync(outPath).size / 1024).toFixed(0)} KB`);
}

async function main() {
  const base = await db.pipelineInspection.findFirst({
    where: { reportNumber: "LAYOUT-FIX-001" },
    include: {
      client: { select: { id: true, name: true, logoPath: true } },
      plant: { select: { id: true, name: true, location: true, address: true } },
      inspector: { select: { id: true, name: true, email: true } },
      approver: { select: { id: true, name: true, email: true } },
      measurements: true,
      reportPhotos: true,
      visualObservations: true,
      dptObservations: true,
      certificates: { orderBy: [{ category: "asc" }, { sortOrder: "asc" }] },
    },
  });
  if (!base) throw new Error("LAYOUT-FIX-001 not found");
  const r: any = { ...base };

  await gen(r, "a_2eq_2per");

  const eq = base.certificates.filter((c: any) => c.category === "EQUIPMENT");
  const per = base.certificates.filter((c: any) => c.category === "PERSONNEL");
  const mk = (src: any, title: string) => ({
    ...src,
    id: `${src.id}-clone-${Math.random().toString(36).slice(2, 8)}`,
    title,
  });

  // b) 3 equipment certs → 2 on page 1, 1 on page 2
  r.certificates = [...eq, mk(eq[0], "Equipment Certificate 3 (test)"), ...per];
  await gen(r, "b_3eq_2per");

  // c) 5 equipment + 3 personnel → 2+2+1 and 2+1
  r.certificates = [
    ...eq,
    mk(eq[0], "Equipment Certificate 3 (test)"),
    mk(eq[1], "Equipment Certificate 4 (test)"),
    mk(eq[0], "Equipment Certificate 5 (test)"),
    ...per,
    mk(per[0], "Inspector Certificate 3 (test)"),
  ];
  await gen(r, "c_5eq_3per");

  // d) 1 equipment + 1 personnel → one full-page cert each
  const one = await db.pipelineInspection.findFirst({
    where: { reportNumber: "1111" },
    include: {
      client: { select: { id: true, name: true, logoPath: true } },
      plant: { select: { id: true, name: true, location: true, address: true } },
      inspector: { select: { id: true, name: true, email: true } },
      approver: { select: { id: true, name: true, email: true } },
      measurements: true, reportPhotos: true, visualObservations: true,
      dptObservations: true, certificates: { orderBy: [{ category: "asc" }, { sortOrder: "asc" }] },
    },
  });
  if (one) await gen(one, "d_1eq_1per");

  await db.$disconnect();
}

main().catch((e) => { console.error("FATAL:", e); process.exit(1); });
