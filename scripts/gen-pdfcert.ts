import { db } from "../src/lib/db";
import { generatePipelineReportPdf } from "../src/lib/pdf/pipeline-report";
import { createWriteStream } from "fs";
const r = await db.pipelineInspection.findFirst({
  where: { reportNumber: "1111111" },
  include: {
    client: { select: { id: true, name: true, logoPath: true } },
    plant: { select: { id: true, name: true, location: true, address: true } },
    inspector: { select: { id: true, name: true, email: true } },
    approver: { select: { id: true, name: true, email: true } },
    measurements: true, reportPhotos: true, visualObservations: true,
    dptObservations: true, certificates: true,
  },
});
console.log("certs:", r?.certificates.map((c) => `${c.category}:${c.fileExtension}`).join(", "));
const ws = createWriteStream("/home/z/my-project/scripts/out/certs_pdfcert.pdf");
await new Promise((res, rej) => { ws.on("finish", res); ws.on("error", rej);
  generatePipelineReportPdf({ report: r as never, measurements: (r as never as any).measurements, photos: r!.reportPhotos ?? [], linkedDrawings: [] }, ws, "portrait");
});
console.log("generated");
await db.$disconnect();
