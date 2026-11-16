// TANK — Pass 3: detail view. Report-type union, Report interface tank
// fields, and the 4 tank sections (inserted after the VESSEL_UTM section,
// before Engineering Drawings). Idempotent. Run: node scripts/tank-pass3.mjs
import fs from "fs";

function read(p) { return fs.readFileSync(p, "utf8"); }
function write(p, s) { fs.writeFileSync(p, s); }
function snippet(name) { return read(`scripts/tank-snippets/${name}`).replace(/\n$/, ""); }
function rep(src, label, find, repl) {
  if (src.includes(repl)) { console.log(`  • ${label}: already applied`); return src; }
  const n = src.split(find).length - 1;
  if (n !== 1) throw new Error(`${label}: expected 1 occurrence, found ${n}`);
  console.log(`  ✓ ${label}`);
  return src.replace(find, repl);
}

const p = "src/components/views/pipeline-report-detail-view.tsx";
let s = read(p);

// 1. reportType union — add tank types.
s = rep(s, "detail reportType union",
`    | "VESSEL_WELD_SCAN"
    | "VESSEL_UTM";
  // Equipment type ("PIPING" | "VESSEL") from the report-creation flow.`,
`    | "VESSEL_WELD_SCAN"
    | "VESSEL_UTM"
    | "TANK_DPT"
    | "TANK_MPT"
    | "TANK_WELD_SCAN"
    | "TANK_UTM";
  // Equipment type ("PIPING" | "VESSEL" | "TANK") from the report-creation
  // flow.`);

// 2. Report interface — tank fields after the vutm block.
s = rep(s, "detail interface tank fields",
`  vutmShellRows?: string | null;
  vutmDishRows?: string | null;
  vutmNozzleRows?: string | null;
  // ─── UT (ULTRASONIC TEST) FIELDS ───`,
`  vutmShellRows?: string | null;
  vutmDishRows?: string | null;
  vutmNozzleRows?: string | null;
  // ─── TANK (STORAGE TANK) FIELDS ───
  // Populated when reportType = TANK_DPT / TANK_MPT / TANK_WELD_SCAN /
  // TANK_UTM. Completely separate from the Vessel vws*/vutm* and Piping
  // dpt*/mpt*/ws* fields — tank reports never read or write Vessel/
  // Piping columns.
  tdptDateOfExamination?: string | null;
  tdptTestingStandard?: string | null;
  tdptAcceptanceCriteria?: string | null;
  tdptSurfacePreparation?: string | null;
  tdptSurfaceTemperature?: string | null;
  tdptPenetrantType?: string | null;
  tdptPenetrantProcess?: string | null;
  tdptMethodOfPreCleaning?: string | null;
  tdptDryingTimeAfterPreCleaning?: string | null;
  tdptMethodOfApplyingPenetrant?: string | null;
  tdptPenetratingTime?: string | null;
  tdptMethodOfRemovingExcessPenetrant?: string | null;
  tdptMethodOfApplyingDeveloper?: string | null;
  tdptDevelopmentTime?: string | null;
  tdptInterpretationTime?: string | null;
  tdptLightingEquipment?: string | null;
  tdptPostCleaning?: string | null;
  tdptSolventMake?: string | null;
  tdptSolventProduct?: string | null;
  tdptSolventBatchNo?: string | null;
  tdptSolventExpiry?: string | null;
  tdptPenetrantMake?: string | null;
  tdptPenetrantProduct?: string | null;
  tdptPenetrantBatchNo?: string | null;
  tdptPenetrantExpiry?: string | null;
  tdptDeveloperMake?: string | null;
  tdptDeveloperProduct?: string | null;
  tdptDeveloperBatchNo?: string | null;
  tdptDeveloperExpiry?: string | null;
  tdptObservationRows?: string | null;
  tmptDateOfExamination?: string | null;
  tmptTestingStandard?: string | null;
  tmptAcceptanceCriteria?: string | null;
  tmptSurfacePreparation?: string | null;
  tmptSurfaceTemperature?: string | null;
  tmptInstrumentSerialNo?: string | null;
  tmptMethod?: string | null;
  tmptTypeOfCurrent?: string | null;
  tmptAcYokeLiftingCapacity?: string | null;
  tmptContrastMedium?: string | null;
  tmptMethodOfPreCleaning?: string | null;
  tmptMethodOfApplyingWhiteContrast?: string | null;
  tmptAcYokePoleSpacing?: string | null;
  tmptMagneticMedium?: string | null;
  tmptMethodOfApplyingMagneticMedium?: string | null;
  tmptDevelopmentTime?: string | null;
  tmptInterpretationTime?: string | null;
  tmptLightingEquipment?: string | null;
  tmptPostCleaning?: string | null;
  tmptWhiteContrastMake?: string | null;
  tmptWhiteContrastProduct?: string | null;
  tmptWhiteContrastLotNo?: string | null;
  tmptWhiteContrastExpiry?: string | null;
  tmptInkMake?: string | null;
  tmptInkProduct?: string | null;
  tmptInkLotNo?: string | null;
  tmptInkExpiry?: string | null;
  tmptRows?: string | null;
  twsDateOfExamination?: string | null;
  twsTestingStandard?: string | null;
  twsAcceptanceCriteria?: string | null;
  twsUtProcedure?: string | null;
  twsEquipmentMake?: string | null;
  twsEquipmentModel?: string | null;
  twsEquipmentSerialNo?: string | null;
  twsCalibrationDueDate?: string | null;
  twsCableLength?: string | null;
  twsCableType?: string | null;
  twsProbeDetails?: string | null;
  twsCalibrationBlock?: string | null;
  twsCalibrationBlockMoc?: string | null;
  twsReferenceReflector?: string | null;
  twsReferenceLevel?: string | null;
  twsFlawSizingTechnique?: string | null;
  twsSurfaceTemperature?: string | null;
  twsTestingMethod?: string | null;
  twsCouplant?: string | null;
  twsSurfacePreparation?: string | null;
  twsSurfaceFinish?: string | null;
  twsExtentOfScanning?: string | null;
  twsDetailRows?: string | null;
  tutmDateOfExamination?: string | null;
  tutmTestingStandard?: string | null;
  tutmAcceptanceCriteria?: string | null;
  tutmUtProcedure?: string | null;
  tutmEquipmentMake?: string | null;
  tutmEquipmentModel?: string | null;
  tutmEquipmentSerialNo?: string | null;
  tutmCalibrationDueDate?: string | null;
  tutmCableLengthAndType?: string | null;
  tutmLwProbeRows?: string | null;
  tutmTypeOfCrystal?: string | null;
  tutmCalibrationBlock?: string | null;
  tutmSurfaceTemperature?: string | null;
  tutmMethod?: string | null;
  tutmCouplant?: string | null;
  tutmSurfacePreparation?: string | null;
  tutmSurfaceFinish?: string | null;
  tutmPlateRows?: string | null;
  // ─── UT (ULTRASONIC TEST) FIELDS ───`);

// 3. Insert the 4 tank detail sections after the VESSEL_UTM section.
s = rep(s, "detail tank sections",
`        {/* ─── 4. ENGINEERING DRAWINGS ───`,
`${snippet("detail-tdpt.txt")}${snippet("detail-tmpt.txt")}${snippet("detail-tws.txt")}${snippet("detail-tutm.txt")}
        {/* ─── 4. ENGINEERING DRAWINGS ───`);

write(p, s);
console.log("PASS3 DONE");
