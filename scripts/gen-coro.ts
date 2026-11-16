import { db } from "../src/lib/db";
import { generatePipelineReportPdf } from "../src/lib/pdf/pipeline-report";
import { createWriteStream } from "fs";
const client = await db.client.findFirst({ where: { name: { contains: "COROMANDEL" } } });
if (!client) throw new Error("no coromandel client");
const report = await db.pipelineInspection.findFirst({
  where: { clientId: client.id }, orderBy: { updatedAt: "desc" },
  include: {
    client: { select: { id: true, name: true, logoPath: true } },
    plant: { select: { id: true, name: true, location: true, address: true } },
    inspector: { select: { id: true, name: true, email: true } },
    approver: { select: { id: true, name: true, email: true } },
    measurements: true, reportPhotos: true, visualObservations: true,
    dptObservations: true, certificates: true,
  },
});
console.log("report:", report?.reportNumber, report?.reportType, "| client logoPath:", client.logoPath);
if (report) {
  const ws = createWriteStream("/home/z/my-project/scripts/out/COROMANDEL-check.pdf");
  await new Promise((res, rej) => { ws.on("finish", res); ws.on("error", rej);
    generatePipelineReportPdf({ report: report as never, measurements: (report as never as any).measurements, photos: report.reportPhotos ?? [], linkedDrawings: [] }, ws, "landscape");
  });
  console.log("generated");
}
await db.$disconnect();
