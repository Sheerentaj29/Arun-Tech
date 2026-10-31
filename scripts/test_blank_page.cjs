const { PrismaClient } = require('/home/z/my-project/node_modules/@prisma/client');
const prisma = new PrismaClient();
const { generatePipelineReportPdf } = require('/home/z/my-project/src/lib/pdf/pipeline-report');
const { Writable } = require('stream');
const fs = require('fs');
const path = require('path');

class BufferWritable extends Writable {
  constructor() { super(); this.chunks = []; }
  _write(chunk, _enc, cb) { this.chunks.push(chunk); cb(); }
  toBuffer() { return Buffer.concat(this.chunks); }
}

(async () => {
  const admin = await prisma.user.findFirst({ where: { email: 'admin@inspections.demo' } });
  const coromandel = await prisma.client.findFirst({ where: { name: { contains: 'COROMANDEL' } } });
  const plant = await prisma.plant.findFirst({ where: { clientId: coromandel.id } });

  // Create test drawing files if they don't exist
  const drawDir = '/tmp/test-drawings';
  fs.mkdirSync(drawDir, { recursive: true });
  // Create 2 simple PNG drawings
  const { execFileSync } = require('child_process');
  try {
    execFileSync('python3', ['-c', `
from PIL import Image, ImageDraw
for name, color, label in [('blank_a.png', '#4a90e2', 'DRAWING A'), ('blank_b.png', '#e24a4a', 'DRAWING B')]:
    img = Image.new('RGB', (800, 600), color=color)
    draw = ImageDraw.Draw(img)
    draw.rectangle([50,50,750,550], outline='white', width=4)
    draw.text((300, 280), label, fill='white')
    img.save('${drawDir}/' + name)
`]);
  } catch(e) { console.error('Could not create test drawings:', e.message); }

  // Create a thickness report
  const report = await prisma.pipelineInspection.create({
    data: {
      reportNumber: `BLANK-TEST-${Date.now().toString().slice(-6)}`,
      reportType: 'PIPELINE_THICKNESS',
      clientId: coromandel.id,
      plantId: plant.id,
      pipelineDescription: 'Test for blank pages',
      materialOfConstruction: 'Carbon Steel',
      applicableStandard: 'ASME B36.10M',
      standardEdition: '2018',
      inspectorId: admin.id,
      inspectorName: admin.name,
      inspectionDate: new Date(),
    },
  });

  // Add a measurement
  const standard = await prisma.pipeStandard.findFirst({ where: { nominalSizeInch: '6', schedule: 'SCH 40' } });
  const ct = await prisma.componentType.findFirst({ where: { code: 'PIPE' } });
  await prisma.thicknessMeasurement.create({
    data: {
      pipelineInspectionId: report.id,
      pointNo: 'P-1', sortOrder: 0,
      pipeSizeInch: '6', pipeSchedule: 'SCH 40',
      nominalThicknessMm: 7.11, standardId: standard?.id,
      componentTypeCode: 'PIPE', componentTypeId: ct?.id,
      northMm: 7.05, northStatus: 'Measured',
      eastMm: 7.10, eastStatus: 'Measured',
      southMm: 7.00, southStatus: 'Measured',
      westMm: 7.15, westStatus: 'Measured',
      observedMinimumMm: 7.00,
      findingsComments: 'OK',
      customColumnValues: '{}',
    },
  });

  // Attach 2 drawings
  const DRAWING_STORAGE_DIR = '/home/z/my-project/storage/drawings';
  fs.mkdirSync(DRAWING_STORAGE_DIR, { recursive: true });
  const linkedDrawings = [];
  for (const [name, title] of [['blank_a.png', 'Drawing A'], ['blank_b.png', 'Drawing B']]) {
    const buf = fs.readFileSync(`${drawDir}/${name}`);
    const drawingNumber = `${report.reportNumber}-DWG-${Math.random().toString(36).slice(2,8)}`;
    const filePath = path.join(DRAWING_STORAGE_DIR, `${drawingNumber}.png`);
    fs.writeFileSync(filePath, buf);
    const result = await prisma.$transaction(async (tx) => {
      const drawing = await tx.engineeringDrawing.create({
        data: { title, drawingNumber, drawingType: 'Other', description: `Attached to report ${report.reportNumber}`, clientId: report.clientId, plantId: report.plantId },
      });
      const revision = await tx.drawingRevision.create({
        data: { drawingId: drawing.id, revisionNumber: 'Rev 0', fileName: name, filePath, fileSize: buf.length, mimeType: 'image/png', fileExtension: '.png', previewPath: filePath, uploadedById: admin.id, uploadedByName: admin.name, isActive: true },
      });
      await tx.engineeringDrawing.update({ where: { id: drawing.id }, data: { activeRevisionId: revision.id } });
      await tx.drawingInspectionLink.create({ data: { drawingId: drawing.id, drawingRevisionId: revision.id, pipelineInspectionId: report.id, attachedById: admin.id, attachedByName: admin.name } });
      return { drawing, revision };
    });
    linkedDrawings.push({
      id: result.drawing.id, title: result.drawing.title, drawingNumber: result.drawing.drawingNumber, drawingType: result.drawing.drawingType,
      revisionNumber: result.revision.revisionNumber, fileName: result.revision.fileName, filePath: result.revision.filePath,
      fileExtension: result.revision.fileExtension, mimeType: result.revision.mimeType, clientName: coromandel.name, plantName: plant.name,
    });
  }

  // Reload report with relations
  const reloaded = await prisma.pipelineInspection.findUnique({
    where: { id: report.id },
    include: {
      client: { select: { id: true, name: true } },
      plant: { select: { id: true, name: true, location: true, address: true } },
      inspector: { select: { id: true, name: true, email: true } },
      approver: { select: { id: true, name: true, email: true } },
      measurements: { orderBy: { sortOrder: 'asc' }, include: { componentType: true, standard: true } },
      reportPhotos: { orderBy: { sortOrder: 'asc' } },
    },
  });

  // Generate PDF
  const writable = new BufferWritable();
  await new Promise((resolve, reject) => {
    writable.on('finish', resolve);
    writable.on('error', reject);
    void generatePipelineReportPdf(
      { report: reloaded, measurements: reloaded.measurements, photos: reloaded.reportPhotos, linkedDrawings },
      writable, 'landscape',
    );
  });
  const pdfPath = '/tmp/blank_test.pdf';
  fs.writeFileSync(pdfPath, writable.toBuffer());

  // Check pages
  const info = execFileSync('pdfinfo', [pdfPath], { encoding: 'utf-8' });
  const pages = info.match(/Pages:\s+(\d+)/)?.[1];
  console.log(`\nPDF: ${pages} pages, ${writable.toBuffer().length} bytes`);
  console.log(`Expected: 4 pages (1 header + 2 drawings + 1 table)`);
  console.log(`If ${parseInt(pages)} > 4, there are ${parseInt(pages) - 4} blank page(s)`);

  for (let i = 1; i <= parseInt(pages); i++) {
    const text = execFileSync('pdftotext', ['-layout', '-f', String(i), '-l', String(i), pdfPath, '-'], { encoding: 'utf-8' });
    const firstLine = text.trim().split('\n')[0]?.slice(0, 80) || '(empty)';
    const len = text.trim().length;
    console.log(`  Page ${i}: ${len} chars — ${firstLine}`);
  }

  await prisma.$disconnect();
})().catch(e => { console.error('FAIL:', e); process.exit(1); });
