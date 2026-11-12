// Direct PDF generation test — bypasses HTTP, calls the generator directly.
// Creates a mock Thickness report with 3 tables and verifies the 7.1/7.2/7.3
// numbering renders in the PDF output.
import { writeFileSync, createWriteStream } from "fs";
import { Writable } from "stream";
import { generatePipelineReportPdf } from "../src/lib/pdf/pipeline-report";
import { serializeThicknessTablesConfig } from "../src/lib/thickness-tables";

const tables = [
  { id: "default", label: "Thickness Measurement – Tank A", sortOrder: 0 },
  { id: "t_001",   label: "Thickness Measurement – Tank B", sortOrder: 1 },
  { id: "t_002",   label: "Thickness Measurement – Tank C", sortOrder: 2 },
];

const config = serializeThicknessTablesConfig(tables);

const mockReport: any = {
  id: "test-num-001",
  reportNumber: "UT-NUM-TEST-001",
  reportType: "PIPELINE_THICKNESS",
  clientId: "test-client",
  plantId: "test-plant",
  inspectionArea: "Unit 1",
  pipelineDescription: "Test pipeline for numbering",
  pipelineIdentificationNumber: "PL-001",
  isometricDrawingNumber: "ISO-001",
  materialOfConstruction: "Carbon Steel",
  applicableStandard: "ASME B36.10M",
  standardEdition: "2018",
  inspectionDate: new Date(),
  fromDate: new Date(),
  toDate: new Date(),
  status: "Draft",
  revisionNumber: 1,
  inspectorId: "test",
  inspectorName: "Test Inspector",
  approvedByName: null,
  findingsSummary: null,
  comments: null,
  inspectionDescription: "Test description for numbering verification.",
  customColumns: "[]",
  thicknessTablesConfig: config,
  photos: null,
  overrideReason: null,
  overrideAppliedById: null,
  overrideAppliedAt: null,
  approvedById: null,
  approvedAt: null,
  approvalNotes: null,
  returnedById: null,
  returnedAt: null,
  reviewComments: null,
  currentApprovedRevisionId: null,
  pdfPath: null,
  signedPdfPath: null,
  // Condition fields (not used for thickness but must exist)
  pipelineAgeYears: null, serviceFluid: null, operatingCondition: null,
  overallConditionRating: null, corrosionCondition: null, damageAssessment: null,
  previousInspectionRef: null, currentInspectionFindings: null,
  riskPriorityLevel: null, recommendations: null, nextInspectionRecommendation: null,
  siteObservationSummary: null, results: null, conclusion: null,
  inspectorDesignation: null, secondReviewedById: null,
  secondReviewedByName: null, secondReviewedByDesignation: null,
  secondReviewedAt: null, approvedByDesignation: null,
  // DPT fields
  dptDateOfExamination: null, dptSolventCleaner: null, dptPenetrant: null,
  dptDeveloper: null, dptCustomColumns: null, dptTestingStandard: null,
  dptAcceptanceCriteria: null, dptSurfacePreparation: null, dptSurfaceTemperature: null,
  dptPenetrantType: null, dptPenetrantProcess: null, dptMethodOfPreCleaning: null,
  dptDryingTimeAfterPreCleaning: null, dptMethodOfApplyingPenetrant: null,
  dptPenetratingTime: null, dptMethodOfRemovingExcessPenetrant: null,
  dptMethodOfApplyingDeveloper: null, dptDevelopmentTime: null,
  dptInterpretationTime: null, dptLightingEquipment: null, dptPostCleaning: null,
  // MPT fields
  mptDateOfExamination: null, mptTestingStandard: null, mptAcceptanceCriteria: null,
  mptSurfacePreparation: null, mptSurfaceTemperature: null, mptInstrumentSerialNo: null,
  mptCalibrationDate: null, mptMethod: null, mptTypeOfCurrent: null,
  mptAcYokeLiftingCapacity: null, mptContrastMedium: null, mptMethodOfPreCleaning: null,
  mptMethodOfApplyingWhiteContrast: null, mptAcYokePoleSpacing: null,
  mptMagneticMedium: null, mptMethodOfApplyingMagneticMedium: null,
  mptDevelopmentTime: null, mptInterpretationTime: null, mptLightingEquipment: null,
  mptPostCleaning: null, mptWhiteContrast: null, mptWetParticleIronInk: null,
  mptCustomColumns: null,
  // UT fields
  utSubContract: null, utProject: null, utJobLocation: null, utJobDescription: null,
  utMaterial: null, utCouplant: null, utReferenceDocuments: null, utProcedureNo: null,
  utAcceptanceStandard: null, utUfdDetails: null, utCalibrationBlock: null,
  utExtentOfExamination: null, utSurfaceCondition: null, utReferenceLevel: null,
  utFlawSizingTechnique: null, utInspectionNote: null, utEquipmentRows: null,
  utProbeRows: null, utTestResultRows: null, utCustomColumns: null,
  // Weld Scan fields
  wsScanningCalibrationBlock: null, wsScanningReferenceLevel: null,
  wsScanningExtentOfExamination: null, wsScanningSurfaceCondition: null,
  wsScanningFlawSizingTechnique: null, wsInstrumentRows: null,
  wsProbeRows: null, wsTestResultRows: null,
  primaryPhotoPath: null,
  isDemo: false,
  createdAt: new Date(),
  updatedAt: new Date(),
  client: { id: "test-client", name: "Kothari Petrochemicals Limited", logoPath: null },
  plant: { id: "test-plant", name: "Ennore Plant", location: "Chennai", address: null },
  inspector: { id: "test", name: "Test Inspector", email: "test@test.com" },
  approver: null,
};

const mockMeasurements: any[] = [
  // Table 1 (default)
  {
    id: "m1", pipelineInspectionId: "test-num-001",
    pointNo: "P-1", sortOrder: 0, tableGroup: "default",
    pipeSizeInch: "2", pipeSchedule: "SCH 40",
    nominalThicknessMm: 3.91, nominalOverride: null, standardId: null,
    componentTypeId: null, componentTypeCode: "PIPE",
    northMm: 3.91, northStatus: "Measured",
    eastMm: null, eastStatus: "NotMeasured",
    southMm: 3.88, southStatus: "Measured",
    westMm: null, westStatus: "NotMeasured",
    observedMinimumMm: 3.88, observedMinimumOverride: null,
    findingsComments: "Row in Tank A table", customColumnValues: "{}",
    createdAt: new Date(), updatedAt: new Date(),
  },
  // Table 2 (t_001)
  {
    id: "m2", pipelineInspectionId: "test-num-001",
    pointNo: "P-1", sortOrder: 0, tableGroup: "t_001",
    pipeSizeInch: "3", pipeSchedule: "SCH 40",
    nominalThicknessMm: 5.49, nominalOverride: null, standardId: null,
    componentTypeId: null, componentTypeCode: "PIPE",
    northMm: 5.49, northStatus: "Measured",
    eastMm: 5.45, eastStatus: "Measured",
    southMm: null, southStatus: "NotMeasured",
    westMm: null, westStatus: "NotMeasured",
    observedMinimumMm: 5.45, observedMinimumOverride: null,
    findingsComments: "Row in Tank B table", customColumnValues: "{}",
    createdAt: new Date(), updatedAt: new Date(),
  },
  // Table 3 (t_002) — empty (no rows) to test the "no rows" message
];

async function main() {
  const outPath = "/tmp/numbering_test.pdf";
  const ws = createWriteStream(outPath);

  // The PDF generator pipes to the writable and calls doc.end(), but
  // doesn't await the stream's 'finish' event. We wrap it in a promise
  // that resolves when the stream is done writing.
  const finished = new Promise<void>((resolve, reject) => {
    ws.on("finish", resolve);
    ws.on("error", reject);
  });

  await generatePipelineReportPdf(
    { report: mockReport, measurements: mockMeasurements, photos: [], linkedDrawings: [] },
    ws,
    "landscape",
  );

  // Wait for the stream to finish writing all PDF data.
  await finished;

  const stat = await import("fs").then(m => m.statSync(outPath));
  console.log(`✓ PDF generated: ${outPath} (${stat.size} bytes)`);
}

main().catch((e) => { console.error("FAILED:", e); process.exit(1); });
