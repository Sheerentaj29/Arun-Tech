// TANK (Storage Tank) — Pass 1: schema columns, store types, selector
// view, API create/update field mappings. Idempotent: anchors that are
// already applied are skipped. Run: node scripts/tank-pass1.mjs
import fs from "fs";

function read(p) { return fs.readFileSync(p, "utf8"); }
function write(p, s) { fs.writeFileSync(p, s); }
function rep(src, label, find, repl) {
  if (src.includes(repl)) { console.log(`  • ${label}: already applied`); return src; }
  const n = src.split(find).length - 1;
  if (n !== 1) throw new Error(`${label}: expected 1 occurrence, found ${n}`);
  console.log(`  ✓ ${label}`);
  return src.replace(find, repl);
}

// ─────────────────────────────────────────────────────────────────
// 1. PRISMA SCHEMA — tank column groups + equipmentType comment
// ─────────────────────────────────────────────────────────────────
{
  const p = "prisma/schema.prisma";
  let s = read(p);
  s = rep(s, "schema equipmentType comment",
    `  equipmentType             String?  // PIPING | VESSEL`,
    `  equipmentType             String?  // PIPING | VESSEL | TANK`);

  const tankColumns = `  // ─── TANK (STORAGE TANK) FIELDS ───
  // Populated when reportType = TANK_DPT / TANK_MPT / TANK_WELD_SCAN /
  // TANK_UTM (the Tank equipment category — Storage Tank). Completely
  // separate from the Vessel (vdpt*/vmpt*/vws*/vutm*) and Piping
  // (dpt*/mpt*/ws*, ThicknessMeasurement) field groups above — storage-
  // tank reports never read or write Vessel/Piping columns. Dates are
  // DateTime columns; JSON row columns store arrays of row objects.

  // ─── TANK DPT (reportType = TANK_DPT) ───
  // 17 DPT procedure parameters + consumables (Solvent / Penetrant /
  // Developer × Make / Product / Batch No. / Expiry) + testing-details
  // rows [{partDetails, idNo, weldDimension, indicationSize,
  // observationResult}].
  tdptDateOfExamination      DateTime?
  tdptTestingStandard        String?
  tdptAcceptanceCriteria     String?
  tdptSurfacePreparation     String?
  tdptSurfaceTemperature     String?
  tdptPenetrantType          String?
  tdptPenetrantProcess       String?
  tdptMethodOfPreCleaning    String?
  tdptDryingTimeAfterPreCleaning String?
  tdptMethodOfApplyingPenetrant String?
  tdptPenetratingTime        String?
  tdptMethodOfRemovingExcessPenetrant String?
  tdptMethodOfApplyingDeveloper String?
  tdptDevelopmentTime        String?
  tdptInterpretationTime     String?
  tdptLightingEquipment      String?
  tdptPostCleaning           String?
  tdptSolventMake            String?
  tdptSolventProduct         String?
  tdptSolventBatchNo         String?
  tdptSolventExpiry          String?
  tdptPenetrantMake          String?
  tdptPenetrantProduct       String?
  tdptPenetrantBatchNo       String?
  tdptPenetrantExpiry        String?
  tdptDeveloperMake          String?
  tdptDeveloperProduct       String?
  tdptDeveloperBatchNo       String?
  tdptDeveloperExpiry        String?
  tdptObservationRows        String?

  // ─── TANK MPT (reportType = TANK_MPT) ───
  // 19 MPT procedure parameters + consumables (White Contrast / Wet
  // Particle Iron Ink × Make / Product / Lot No. / Expiry) + testing-
  // details rows [{partDetails, idNo, weldDimension, indicationSize,
  // observationResult}].
  tmptDateOfExamination      DateTime?
  tmptTestingStandard        String?
  tmptAcceptanceCriteria     String?
  tmptSurfacePreparation     String?
  tmptSurfaceTemperature     String?
  tmptInstrumentSerialNo     String?
  tmptMethod                 String?
  tmptTypeOfCurrent          String?
  tmptAcYokeLiftingCapacity  String?
  tmptContrastMedium         String?
  tmptMethodOfPreCleaning    String?
  tmptMethodOfApplyingWhiteContrast String?
  tmptAcYokePoleSpacing      String?
  tmptMagneticMedium         String?
  tmptMethodOfApplyingMagneticMedium String?
  tmptDevelopmentTime        String?
  tmptInterpretationTime     String?
  tmptLightingEquipment      String?
  tmptPostCleaning           String?
  tmptWhiteContrastMake      String?
  tmptWhiteContrastProduct   String?
  tmptWhiteContrastLotNo     String?
  tmptWhiteContrastExpiry    String?
  tmptInkMake                String?
  tmptInkProduct             String?
  tmptInkLotNo               String?
  tmptInkExpiry              String?
  tmptRows                   String?

  // ─── TANK WELD SCAN (reportType = TANK_WELD_SCAN) ───
  // Weld Scan Testing Parameters (grouped) + fixed 4-probe grid
  // [{probeType, probeAngle, frequency, probeSize, serialNo}] + testing
  // details rows [{component, plateWeldId, weldDimension, probeAngle,
  // probeFrequency, observationResult}].
  twsDateOfExamination       DateTime?
  twsTestingStandard         String?
  twsAcceptanceCriteria      String?
  twsUtProcedure             String?
  twsEquipmentMake           String?
  twsEquipmentModel          String?
  twsEquipmentSerialNo       String?
  twsCalibrationDueDate      DateTime?
  twsCableLength             String?
  twsCableType               String?
  twsProbeDetails            String?
  twsCalibrationBlock        String?
  twsCalibrationBlockMoc     String?
  twsReferenceReflector      String?
  twsReferenceLevel          String?
  twsFlawSizingTechnique     String?
  twsSurfaceTemperature      String?
  twsTestingMethod           String?
  twsCouplant                String?
  twsSurfacePreparation      String?
  twsSurfaceFinish           String?
  twsExtentOfScanning        String?
  twsDetailRows              String?

  // ─── TANK UT THICKNESS MEASUREMENT (reportType = TANK_UTM) ───
  // UT Thickness Measurement Parameters + repeatable Longitudinal Wave
  // (0°) probe rows [{frequency, probeSize, serialNo}] + course/plate
  // readings rows (12 / 3 / 6 / 9 o'clock clock positions, same row
  // shape as the vessel clock rows):
  //   [{moc, componentType, componentId, nominalThickness,
  //     c12: [...], c3: [...], c6: [...], c9: [...]}]
  tutmDateOfExamination      DateTime?
  tutmTestingStandard        String?
  tutmAcceptanceCriteria     String?
  tutmUtProcedure            String?
  tutmEquipmentMake          String?
  tutmEquipmentModel         String?
  tutmEquipmentSerialNo      String?
  tutmCalibrationDueDate     DateTime?
  tutmCableLengthAndType     String?
  tutmLwProbeRows            String?
  tutmTypeOfCrystal          String?
  tutmCalibrationBlock       String?
  tutmSurfaceTemperature     String?
  tutmMethod                 String?
  tutmCouplant               String?
  tutmSurfacePreparation     String?
  tutmSurfaceFinish          String?
  tutmPlateRows              String?

`;
  s = rep(s, "schema tank columns",
    `  isDemo                   Boolean  @default(false)`,
    tankColumns + `  isDemo                   Boolean  @default(false)`);
  write(p, s);
}

// ─────────────────────────────────────────────────────────────────
// 2. STORE — report types + equipment type
// ─────────────────────────────────────────────────────────────────
{
  const p = "src/lib/store.ts";
  let s = read(p);
  s = rep(s, "store PipelineReportType union",
    `  | "VESSEL_UTM"
  | "VESSEL_VISUAL"`,
    `  | "VESSEL_UTM"
  | "TANK_DPT"
  | "TANK_MPT"
  | "TANK_WELD_SCAN"
  | "TANK_UTM"
  | "VESSEL_VISUAL"`);
  s = rep(s, "store EquipmentType union",
    `export type EquipmentType = "PIPING" | "VESSEL";`,
    `export type EquipmentType = "PIPING" | "VESSEL" | "TANK";`);
  write(p, s);
}

// ─────────────────────────────────────────────────────────────────
// 3. SELECTOR VIEW — Tank equipment card + TANK options
// ─────────────────────────────────────────────────────────────────
{
  const p = "src/components/views/pipeline-report-type-selector-view.tsx";
  let s = read(p);
  s = rep(s, "selector lucide import",
    `  Workflow,
  Cylinder,
  MoveHorizontal,`,
    `  Workflow,
  Cylinder,
  Database,
  MoveHorizontal,`);
  s = rep(s, "selector TANK_OPTIONS",
    `// Vessel UT Thickness Measurement is the ONLY module that requires a`,
    `// Tank (Storage Tank) test-type options. Storage tanks are vertical
// cylindrical equipment; the modules mirror the Vessel module layouts
// but store their data in completely separate TANK_* columns.
const TANK_OPTIONS: TypeOption[] = [
  {
    type: "TANK_DPT",
    title: "Dye Penetrant Testing (DPT)",
    subtitle: "Dye penetrant inspection for storage tank shells and welds",
    icon: Droplet,
    accent: "border-fuchsia-500 bg-fuchsia-50 hover:bg-fuchsia-100",
  },
  {
    type: "TANK_MPT",
    title: "Magnetic Particle Testing (MPT)",
    subtitle: "Magnetic particle inspection for storage tank shells and welds",
    icon: Magnet,
    accent: "border-amber-500 bg-amber-50 hover:bg-amber-100",
  },
  {
    type: "TANK_WELD_SCAN",
    title: "Weld Scan",
    subtitle: "Weld scan inspection for storage tank shell seams and welds",
    icon: Zap,
    accent: "border-sky-500 bg-sky-50 hover:bg-sky-100",
  },
  {
    type: "TANK_UTM",
    title: "UT Thickness Measurement",
    subtitle: "UT thickness measurement for tank courses and plates",
    icon: Gauge,
    accent: "border-teal-500 bg-teal-50 hover:bg-teal-100",
  },
];

// Vessel UT Thickness Measurement is the ONLY module that requires a`);
  s = rep(s, "selector equipment state type",
    `  const [equipmentType, setEquipmentType] = useState<"PIPING" | "VESSEL" | null>(null);`,
    `  const [equipmentType, setEquipmentType] = useState<"PIPING" | "VESSEL" | "TANK" | null>(null);`);
  s = rep(s, "selector options map",
    `  const options = equipmentType === "VESSEL" ? VESSEL_OPTIONS : PIPING_OPTIONS;`,
    `  const options =
    equipmentType === "VESSEL"
      ? VESSEL_OPTIONS
      : equipmentType === "TANK"
        ? TANK_OPTIONS
        : PIPING_OPTIONS;`);
  s = rep(s, "selector pickEquipment signature",
    `  function pickEquipment(t: "PIPING" | "VESSEL") {`,
    `  function pickEquipment(t: "PIPING" | "VESSEL" | "TANK") {`);
  s = rep(s, "selector breadcrumb label",
    `              : equipmentType === "VESSEL"
                ? "Vessel"
                : "Piping"}`,
    `              : equipmentType === "VESSEL"
                ? "Vessel"
                : equipmentType === "TANK"
                  ? "Tank"
                  : "Piping"});
  s = rep(s, "selector equipment card",
    `            {
              key: "VESSEL",
              title: "Vessel",
              icon: Cylinder,
              accent: "border-blue-500 bg-blue-50 hover:bg-blue-100",
            },
          ] as const).map((opt) => {`,
    `            {
              key: "VESSEL",
              title: "Vessel",
              icon: Cylinder,
              accent: "border-blue-500 bg-blue-50 hover:bg-blue-100",
            },
            {
              key: "TANK",
              title: "Tank",
              icon: Database,
              accent: "border-teal-500 bg-teal-50 hover:bg-teal-100",
            },
          ] as const).map((opt) => {`);
  write(p, s);
}

// ─────────────────────────────────────────────────────────────────
// 4. API CREATE ROUTE — whitelist, equipment guard, tank mappings
// ─────────────────────────────────────────────────────────────────
{
  const p = "src/app/api/pipeline-inspections/route.ts";
  let s = read(p);
  s = rep(s, "create whitelist",
    `        "VESSEL_WELD_SCAN",
        "VESSEL_UTM",
        "PIPELINE_VISUAL",`,
    `        "VESSEL_WELD_SCAN",
        "VESSEL_UTM",
        "TANK_DPT",
        "TANK_MPT",
        "TANK_WELD_SCAN",
        "TANK_UTM",
        "PIPELINE_VISUAL",`);
  s = rep(s, "create equipmentType guard",
    `      equipmentType: body.equipmentType === "PIPING" || body.equipmentType === "VESSEL"
        ? body.equipmentType
        : null,`,
    `      equipmentType:
        body.equipmentType === "PIPING" ||
        body.equipmentType === "VESSEL" ||
        body.equipmentType === "TANK"
          ? body.equipmentType
          : null,`);
  s = rep(s, "create tank field mappings",
    `      vutmNozzleRows: normalizeVutmRows(
        body.vutmNozzleRows,
        body.vesselOrientation === "VERTICAL" ? "VERTICAL" : "HORIZONTAL",
      ),
      isDemo: false,`,
    `      vutmNozzleRows: normalizeVutmRows(
        body.vutmNozzleRows,
        body.vesselOrientation === "VERTICAL" ? "VERTICAL" : "HORIZONTAL",
      ),
      // ─── TANK (STORAGE TANK) FIELDS (reportType = TANK_*) ───
      // Completely separate from the Vessel (vdpt*/vmpt*/vws*/vutm*) and
      // Piping field groups above — storage-tank reports never read or
      // write Vessel/Piping columns. The Tank UT course/plate readings
      // reuse the generic clock-row normalizer (HORIZONTAL shape).
      // ─── TANK DPT (reportType = TANK_DPT) ───
      tdptDateOfExamination: body.tdptDateOfExamination ? new Date(body.tdptDateOfExamination) : null,
      tdptTestingStandard: body.tdptTestingStandard?.trim() || null,
      tdptAcceptanceCriteria: body.tdptAcceptanceCriteria?.trim() || null,
      tdptSurfacePreparation: body.tdptSurfacePreparation?.trim() || null,
      tdptSurfaceTemperature: body.tdptSurfaceTemperature?.trim() || null,
      tdptPenetrantType: body.tdptPenetrantType?.trim() || null,
      tdptPenetrantProcess: body.tdptPenetrantProcess?.trim() || null,
      tdptMethodOfPreCleaning: body.tdptMethodOfPreCleaning?.trim() || null,
      tdptDryingTimeAfterPreCleaning: body.tdptDryingTimeAfterPreCleaning?.trim() || null,
      tdptMethodOfApplyingPenetrant: body.tdptMethodOfApplyingPenetrant?.trim() || null,
      tdptPenetratingTime: body.tdptPenetratingTime?.trim() || null,
      tdptMethodOfRemovingExcessPenetrant: body.tdptMethodOfRemovingExcessPenetrant?.trim() || null,
      tdptMethodOfApplyingDeveloper: body.tdptMethodOfApplyingDeveloper?.trim() || null,
      tdptDevelopmentTime: body.tdptDevelopmentTime?.trim() || null,
      tdptInterpretationTime: body.tdptInterpretationTime?.trim() || null,
      tdptLightingEquipment: body.tdptLightingEquipment?.trim() || null,
      tdptPostCleaning: body.tdptPostCleaning?.trim() || null,
      tdptSolventMake: body.tdptSolventMake?.trim() || null,
      tdptSolventProduct: body.tdptSolventProduct?.trim() || null,
      tdptSolventBatchNo: body.tdptSolventBatchNo?.trim() || null,
      tdptSolventExpiry: body.tdptSolventExpiry?.trim() || null,
      tdptPenetrantMake: body.tdptPenetrantMake?.trim() || null,
      tdptPenetrantProduct: body.tdptPenetrantProduct?.trim() || null,
      tdptPenetrantBatchNo: body.tdptPenetrantBatchNo?.trim() || null,
      tdptPenetrantExpiry: body.tdptPenetrantExpiry?.trim() || null,
      tdptDeveloperMake: body.tdptDeveloperMake?.trim() || null,
      tdptDeveloperProduct: body.tdptDeveloperProduct?.trim() || null,
      tdptDeveloperBatchNo: body.tdptDeveloperBatchNo?.trim() || null,
      tdptDeveloperExpiry: body.tdptDeveloperExpiry?.trim() || null,
      tdptObservationRows: typeof body.tdptObservationRows === "string" ? body.tdptObservationRows : null,
      // ─── TANK MPT (reportType = TANK_MPT) ───
      tmptDateOfExamination: body.tmptDateOfExamination ? new Date(body.tmptDateOfExamination) : null,
      tmptTestingStandard: body.tmptTestingStandard?.trim() || null,
      tmptAcceptanceCriteria: body.tmptAcceptanceCriteria?.trim() || null,
      tmptSurfacePreparation: body.tmptSurfacePreparation?.trim() || null,
      tmptSurfaceTemperature: body.tmptSurfaceTemperature?.trim() || null,
      tmptInstrumentSerialNo: body.tmptInstrumentSerialNo?.trim() || null,
      tmptMethod: body.tmptMethod?.trim() || null,
      tmptTypeOfCurrent: body.tmptTypeOfCurrent?.trim() || null,
      tmptAcYokeLiftingCapacity: body.tmptAcYokeLiftingCapacity?.trim() || null,
      tmptContrastMedium: body.tmptContrastMedium?.trim() || null,
      tmptMethodOfPreCleaning: body.tmptMethodOfPreCleaning?.trim() || null,
      tmptMethodOfApplyingWhiteContrast: body.tmptMethodOfApplyingWhiteContrast?.trim() || null,
      tmptAcYokePoleSpacing: body.tmptAcYokePoleSpacing?.trim() || null,
      tmptMagneticMedium: body.tmptMagneticMedium?.trim() || null,
      tmptMethodOfApplyingMagneticMedium: body.tmptMethodOfApplyingMagneticMedium?.trim() || null,
      tmptDevelopmentTime: body.tmptDevelopmentTime?.trim() || null,
      tmptInterpretationTime: body.tmptInterpretationTime?.trim() || null,
      tmptLightingEquipment: body.tmptLightingEquipment?.trim() || null,
      tmptPostCleaning: body.tmptPostCleaning?.trim() || null,
      tmptWhiteContrastMake: body.tmptWhiteContrastMake?.trim() || null,
      tmptWhiteContrastProduct: body.tmptWhiteContrastProduct?.trim() || null,
      tmptWhiteContrastLotNo: body.tmptWhiteContrastLotNo?.trim() || null,
      tmptWhiteContrastExpiry: body.tmptWhiteContrastExpiry?.trim() || null,
      tmptInkMake: body.tmptInkMake?.trim() || null,
      tmptInkProduct: body.tmptInkProduct?.trim() || null,
      tmptInkLotNo: body.tmptInkLotNo?.trim() || null,
      tmptInkExpiry: body.tmptInkExpiry?.trim() || null,
      tmptRows: typeof body.tmptRows === "string" ? body.tmptRows : null,
      // ─── TANK WELD SCAN (reportType = TANK_WELD_SCAN) ───
      twsDateOfExamination: body.twsDateOfExamination ? new Date(body.twsDateOfExamination) : null,
      twsTestingStandard: body.twsTestingStandard?.trim() || null,
      twsAcceptanceCriteria: body.twsAcceptanceCriteria?.trim() || null,
      twsUtProcedure: body.twsUtProcedure?.trim() || null,
      twsEquipmentMake: body.twsEquipmentMake?.trim() || null,
      twsEquipmentModel: body.twsEquipmentModel?.trim() || null,
      twsEquipmentSerialNo: body.twsEquipmentSerialNo?.trim() || null,
      twsCalibrationDueDate: body.twsCalibrationDueDate ? new Date(body.twsCalibrationDueDate) : null,
      twsCableLength: body.twsCableLength?.trim() || null,
      twsCableType: body.twsCableType?.trim() || null,
      twsProbeDetails: typeof body.twsProbeDetails === "string" ? body.twsProbeDetails : null,
      twsCalibrationBlock: body.twsCalibrationBlock?.trim() || null,
      twsCalibrationBlockMoc: body.twsCalibrationBlockMoc?.trim() || null,
      twsReferenceReflector: body.twsReferenceReflector?.trim() || null,
      twsReferenceLevel: body.twsReferenceLevel?.trim() || null,
      twsFlawSizingTechnique: body.twsFlawSizingTechnique?.trim() || null,
      twsSurfaceTemperature: body.twsSurfaceTemperature?.trim() || null,
      twsTestingMethod: body.twsTestingMethod?.trim() || null,
      twsCouplant: body.twsCouplant?.trim() || null,
      twsSurfacePreparation: body.twsSurfacePreparation?.trim() || null,
      twsSurfaceFinish: body.twsSurfaceFinish?.trim() || null,
      twsExtentOfScanning: body.twsExtentOfScanning?.trim() || null,
      twsDetailRows: typeof body.twsDetailRows === "string" ? body.twsDetailRows : null,
      // ─── TANK UT THICKNESS MEASUREMENT (reportType = TANK_UTM) ───
      tutmDateOfExamination: body.tutmDateOfExamination ? new Date(body.tutmDateOfExamination) : null,
      tutmTestingStandard: body.tutmTestingStandard?.trim() || null,
      tutmAcceptanceCriteria: body.tutmAcceptanceCriteria?.trim() || null,
      tutmUtProcedure: body.tutmUtProcedure?.trim() || null,
      tutmEquipmentMake: body.tutmEquipmentMake?.trim() || null,
      tutmEquipmentModel: body.tutmEquipmentModel?.trim() || null,
      tutmEquipmentSerialNo: body.tutmEquipmentSerialNo?.trim() || null,
      tutmCalibrationDueDate: body.tutmCalibrationDueDate ? new Date(body.tutmCalibrationDueDate) : null,
      tutmCableLengthAndType: body.tutmCableLengthAndType?.trim() || null,
      tutmLwProbeRows: typeof body.tutmLwProbeRows === "string" ? body.tutmLwProbeRows : null,
      tutmTypeOfCrystal: body.tutmTypeOfCrystal?.trim() || null,
      tutmCalibrationBlock: body.tutmCalibrationBlock?.trim() || null,
      tutmSurfaceTemperature: body.tutmSurfaceTemperature?.trim() || null,
      tutmMethod: body.tutmMethod?.trim() || null,
      tutmCouplant: body.tutmCouplant?.trim() || null,
      tutmSurfacePreparation: body.tutmSurfacePreparation?.trim() || null,
      tutmSurfaceFinish: body.tutmSurfaceFinish?.trim() || null,
      // Course/plate readings are clock-position rows (same generic
      // normalizer as the vessel clock rows — HORIZONTAL shape).
      tutmPlateRows: normalizeVutmRows(body.tutmPlateRows, "HORIZONTAL"),
      isDemo: false,`);
  write(p, s);
}

// ─────────────────────────────────────────────────────────────────
// 5. API UPDATE ROUTE — equipment guard + tank mappings
// ─────────────────────────────────────────────────────────────────
{
  const p = "src/app/api/pipeline-inspections/[id]/route.ts";
  let s = read(p);
  s = rep(s, "update equipmentType guard",
    `      equipmentType:
        body.equipmentType !== undefined
          ? (body.equipmentType === "PIPING" || body.equipmentType === "VESSEL" ? body.equipmentType : null)
          : existing.equipmentType,`,
    `      equipmentType:
        body.equipmentType !== undefined
          ? (body.equipmentType === "PIPING" ||
             body.equipmentType === "VESSEL" ||
             body.equipmentType === "TANK"
              ? body.equipmentType
              : null)
          : existing.equipmentType,`);

  const tankMap = (fields) => fields.map(([name, expr]) =>
    `      ${name}: body.${name} !== undefined ? ${expr} : existing.${name},`).join("\n");
  const trim = (name) => `(${name}?.trim() || null)`;
  const date = (name) => `(${name} ? new Date(${name}) : null)`;
  const json = (name) => `(typeof ${name} === "string" ? ${name} : null)`;

  const dptFields = [
    ["tdptDateOfExamination", date("body.tdptDateOfExamination")],
    ...["tdptTestingStandard","tdptAcceptanceCriteria","tdptSurfacePreparation","tdptSurfaceTemperature",
        "tdptPenetrantType","tdptPenetrantProcess","tdptMethodOfPreCleaning","tdptDryingTimeAfterPreCleaning",
        "tdptMethodOfApplyingPenetrant","tdptPenetratingTime","tdptMethodOfRemovingExcessPenetrant",
        "tdptMethodOfApplyingDeveloper","tdptDevelopmentTime","tdptInterpretationTime","tdptLightingEquipment",
        "tdptPostCleaning",
        "tdptSolventMake","tdptSolventProduct","tdptSolventBatchNo","tdptSolventExpiry",
        "tdptPenetrantMake","tdptPenetrantProduct","tdptPenetrantBatchNo","tdptPenetrantExpiry",
        "tdptDeveloperMake","tdptDeveloperProduct","tdptDeveloperBatchNo","tdptDeveloperExpiry",
       ].map((n) => [n, trim(`body.${n}`)]),
    ["tdptObservationRows", json("body.tdptObservationRows")],
  ];
  const mptFields = [
    ["tmptDateOfExamination", date("body.tmptDateOfExamination")],
    ...["tmptTestingStandard","tmptAcceptanceCriteria","tmptSurfacePreparation","tmptSurfaceTemperature",
        "tmptInstrumentSerialNo","tmptMethod","tmptTypeOfCurrent","tmptAcYokeLiftingCapacity",
        "tmptContrastMedium","tmptMethodOfPreCleaning","tmptMethodOfApplyingWhiteContrast",
        "tmptAcYokePoleSpacing","tmptMagneticMedium","tmptMethodOfApplyingMagneticMedium",
        "tmptDevelopmentTime","tmptInterpretationTime","tmptLightingEquipment","tmptPostCleaning",
        "tmptWhiteContrastMake","tmptWhiteContrastProduct","tmptWhiteContrastLotNo","tmptWhiteContrastExpiry",
        "tmptInkMake","tmptInkProduct","tmptInkLotNo","tmptInkExpiry",
       ].map((n) => [n, trim(`body.${n}`)]),
    ["tmptRows", json("body.tmptRows")],
  ];
  const wsFields = [
    ["twsDateOfExamination", date("body.twsDateOfExamination")],
    ...["twsTestingStandard","twsAcceptanceCriteria","twsUtProcedure","twsEquipmentMake",
        "twsEquipmentModel","twsEquipmentSerialNo","twsCableLength","twsCableType",
        "twsCalibrationBlock","twsCalibrationBlockMoc","twsReferenceReflector","twsReferenceLevel",
        "twsFlawSizingTechnique","twsSurfaceTemperature","twsTestingMethod","twsCouplant",
        "twsSurfacePreparation","twsSurfaceFinish","twsExtentOfScanning",
       ].map((n) => [n, trim(`body.${n}`)]),
    ["twsProbeDetails", json("body.twsProbeDetails")],
    ["twsDetailRows", json("body.twsDetailRows")],
  ];
  const utmFields = [
    ["tutmDateOfExamination", date("body.tutmDateOfExamination")],
    ...["tutmTestingStandard","tutmAcceptanceCriteria","tutmUtProcedure","tutmEquipmentMake",
        "tutmEquipmentModel","tutmEquipmentSerialNo","tutmCableLengthAndType","tutmTypeOfCrystal",
        "tutmCalibrationBlock","tutmSurfaceTemperature","tutmMethod","tutmCouplant",
        "tutmSurfacePreparation","tutmSurfaceFinish",
       ].map((n) => [n, trim(`body.${n}`)]),
    ["tutmLwProbeRows", json("body.tutmLwProbeRows")],
  ];

  const tankBlock = `      // ─── TANK (STORAGE TANK) FIELDS (reportType = TANK_*) ───
      // Completely separate from the Vessel (vdpt*/vmpt*/vws*/vutm*) and
      // Piping field groups above — storage-tank reports never read or
      // write Vessel/Piping columns. Tank UT course/plate readings reuse
      // the generic clock-row normalizer (HORIZONTAL shape).
${tankMap(dptFields)}
${tankMap(mptFields)}
${tankMap(wsFields)}
${tankMap(utmFields)}
      tutmPlateRows:
        body.tutmPlateRows !== undefined
          ? normalizeVutmRows(body.tutmPlateRows, "HORIZONTAL")
          : existing.tutmPlateRows,
      // ─── TANK WELD SCAN DATES: twsCalibrationDueDate handled with the
      // other date fields below ───
      twsCalibrationDueDate: body.twsCalibrationDueDate !== undefined ? (body.twsCalibrationDueDate ? new Date(body.twsCalibrationDueDate) : null) : existing.twsCalibrationDueDate,
      tutmCalibrationDueDate: body.tutmCalibrationDueDate !== undefined ? (body.tutmCalibrationDueDate ? new Date(body.tutmCalibrationDueDate) : null) : existing.tutmCalibrationDueDate,
    },`;

  s = rep(s, "update tank field mappings",
    `          : existing.vutmNozzleRows,
    },
  });`,
    `          : existing.vutmNozzleRows,
${tankBlock}
  });`);
  write(p, s);
}

console.log("PASS1 DONE");
