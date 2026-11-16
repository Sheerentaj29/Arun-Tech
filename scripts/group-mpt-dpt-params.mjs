// Group Vessel MPT / DPT testing-parameter fields under full-width subheadings,
// matching the Vessel Weld Scan (cyan) / Vessel UT Thickness (emerald) layout.
// - Form view:  bg-{theme}-800 dark subheading rows (same as VWS/VUTM form)
// - Detail view: bg-{theme}-100 subheading rows (same as VWS/VUTM detail)
// Every existing field row is preserved verbatim — only regrouped.
// MPT theme = orange, DPT theme = purple (each module's own color theme).
// Run: node scripts/group-mpt-dpt-params.mjs
import fs from "fs";

const FORM = "src/components/views/pipeline-report-form-view.tsx";
const DETAIL = "src/components/views/pipeline-report-detail-view.tsx";

function read(p) { return fs.readFileSync(p, "utf8"); }
function write(p, s) { fs.writeFileSync(p, s); }
function replaceOnce(src, label, find, repl) {
  const n = src.split(find).length - 1;
  if (n === 0 && src.includes(repl)) { console.log(`  • ${label}: already applied`); return src; }
  if (n !== 1) throw new Error(`${label}: expected 1 occurrence, found ${n}`);
  console.log(`  ✓ ${label}`);
  return parts_join(src, find, repl);
}
function parts_join(src, find, repl) { return src.split(find).join(repl); }

// Reusable row renderer (identical to the existing flat map body).
const formRowMap = `] as const).map(([label, fieldKey, placeholder]) => (
                  <tr key={fieldKey} className="border-b border-zinc-200">
                    <td className="bg-THEME-50 border-r border-zinc-200 px-3 py-2 font-medium text-zinc-700">
                      {label}
                    </td>
                    <td className="px-2 py-1.5">
                      <Input
                        className="h-8 text-sm"
                        value={header[fieldKey]}
                        onChange={(e) => updateHeader(fieldKey, e.target.value)}
                        placeholder={placeholder}
                      />
                    </td>
                  </tr>
                ))}`;

function formSubhead(theme, title) {
  return `                {/* ─── ${title.replace("&amp;", "&")} ─── */}
                <tr className="bg-${theme}-800 text-white">
                  <td colSpan={2} className="border border-${theme}-900 px-3 py-2 font-semibold text-xs tracking-wide">
                    ${title}
                  </td>
                </tr>`;
}
function formGroup(theme, title, rows) {
  return `${formSubhead(theme, title)}
                {([
${rows.map((r) => `                  ${r}`).join(",\n")},
                ${formRowMap.replace("] as const)", "] as const)").replace("THEME", theme)}`;
}

// ═══════════ FORM — VESSEL MPT (orange) ═══════════
const mptDateRow = `                {/* Date of Examination — editable date field */}
                <tr className="border-b border-zinc-200">
                  <td className="bg-orange-50 border-r border-zinc-200 px-3 py-2 font-medium text-zinc-700 w-1/3">
                    Date of Examination
                  </td>
                  <td className="px-2 py-1.5">
                    <Input
                      type="date"
                      className="h-8 text-sm"
                      value={header.mptDateOfExamination}
                      onChange={(e) => updateHeader("mptDateOfExamination", e.target.value)}
                    />
                  </td>
                </tr>`;

const mptOldFlat = `${mptDateRow}
                {/* Typeable text fields */}
                {([
                  ["Testing Standard", "mptTestingStandard", "e.g. ASME Section V 2023, Article 7"],
                  ["Acceptance Criteria", "mptAcceptanceCriteria", "e.g. ASME Section VIII Div. 1, Appx. 6"],
                  ["Surface Preparation", "mptSurfacePreparation", "e.g. Grinding and wire brush"],
                  ["Surface Temperature", "mptSurfaceTemperature", "e.g. 32 °C"],
                  ["Type of Instrument / Sl. No.", "mptInstrumentSerialNo", "e.g. AC Yoke / 201501012123"],
                  ["MPT Method", "mptMethod", "e.g. Wet Continuous"],
                  ["Type of Current", "mptTypeOfCurrent", "e.g. AC"],
                  ["AC Yoke Lifting Capacity", "mptAcYokeLiftingCapacity", "e.g. 5 kg / 50 N"],
                  ["Contrast Medium", "mptContrastMedium", "e.g. White contrast"],
                  ["Method of Pre-cleaning", "mptMethodOfPreCleaning", "e.g. Solvent cleaning"],
                  ["Method of Applying White Contrast", "mptMethodOfApplyingWhiteContrast", "e.g. Spray"],
                  ["AC Yoke Pole Spacing", "mptAcYokePoleSpacing", "e.g. 150 mm"],
                  ["Magnetic Medium", "mptMagneticMedium", "e.g. Wet particle iron ink"],
                  ["Method of Applying Magnetic Medium", "mptMethodOfApplyingMagneticMedium", "e.g. Spray"],
                  ["Development Time", "mptDevelopmentTime", "e.g. 5 minutes"],
                  ["Interpretation Time", "mptInterpretationTime", "e.g. 10 minutes"],
                  ["Lighting Equipment", "mptLightingEquipment", "e.g. LED torch ≥ 1000 lux"],
                  ["Post Cleaning", "mptPostCleaning", "e.g. Solvent wipe"],
                ] as const).map(([label, fieldKey, placeholder]) => (
                  <tr key={fieldKey} className="border-b border-zinc-200">
                    <td className="bg-orange-50 border-r border-zinc-200 px-3 py-2 font-medium text-zinc-700">
                      {label}
                    </td>
                    <td className="px-2 py-1.5">
                      <Input
                        className="h-8 text-sm"
                        value={header[fieldKey]}
                        onChange={(e) => updateHeader(fieldKey, e.target.value)}
                        placeholder={placeholder}
                      />
                    </td>
                  </tr>
                ))}`;

const mptNewGrouped = `${formSubhead("orange", "General Information")}
${mptDateRow}
                {([
                  ["Testing Standard", "mptTestingStandard", "e.g. ASME Section V 2023, Article 7"],
                  ["Acceptance Criteria", "mptAcceptanceCriteria", "e.g. ASME Section VIII Div. 1, Appx. 6"],
                ] as const).map(([label, fieldKey, placeholder]) => (
                  <tr key={fieldKey} className="border-b border-zinc-200">
                    <td className="bg-orange-50 border-r border-zinc-200 px-3 py-2 font-medium text-zinc-700">
                      {label}
                    </td>
                    <td className="px-2 py-1.5">
                      <Input
                        className="h-8 text-sm"
                        value={header[fieldKey]}
                        onChange={(e) => updateHeader(fieldKey, e.target.value)}
                        placeholder={placeholder}
                      />
                    </td>
                  </tr>
                ))}
${formGroup("orange", "Surface &amp; Preparation", [
  `["Surface Preparation", "mptSurfacePreparation", "e.g. Grinding and wire brush"]`,
  `["Surface Temperature", "mptSurfaceTemperature", "e.g. 32 °C"]`,
  `["Method of Pre-cleaning", "mptMethodOfPreCleaning", "e.g. Solvent cleaning"]`,
  `["Post Cleaning", "mptPostCleaning", "e.g. Solvent wipe"]`,
])}
${formGroup("orange", "Equipment Details", [
  `["Type of Instrument / Sl. No.", "mptInstrumentSerialNo", "e.g. AC Yoke / 201501012123"]`,
  `["AC Yoke Lifting Capacity", "mptAcYokeLiftingCapacity", "e.g. 5 kg / 50 N"]`,
  `["AC Yoke Pole Spacing", "mptAcYokePoleSpacing", "e.g. 150 mm"]`,
])}
${formGroup("orange", "Testing Method", [
  `["MPT Method", "mptMethod", "e.g. Wet Continuous"]`,
  `["Type of Current", "mptTypeOfCurrent", "e.g. AC"]`,
  `["Contrast Medium", "mptContrastMedium", "e.g. White contrast"]`,
  `["Method of Applying White Contrast", "mptMethodOfApplyingWhiteContrast", "e.g. Spray"]`,
  `["Magnetic Medium", "mptMagneticMedium", "e.g. Wet particle iron ink"]`,
  `["Method of Applying Magnetic Medium", "mptMethodOfApplyingMagneticMedium", "e.g. Spray"]`,
])}
${formGroup("orange", "Testing Timing &amp; Interpretation", [
  `["Development Time", "mptDevelopmentTime", "e.g. 5 minutes"]`,
  `["Interpretation Time", "mptInterpretationTime", "e.g. 10 minutes"]`,
  `["Lighting Equipment", "mptLightingEquipment", "e.g. LED torch ≥ 1000 lux"]`,
])}`;

// ═══════════ FORM — VESSEL DPT (purple) ═══════════
const dptDateRow = `                {/* Date of Examination — editable date field */}
                <tr className="border-b border-zinc-200">
                  <td className="bg-purple-50 border-r border-zinc-200 px-3 py-2 font-medium text-zinc-700 w-1/3">
                    Date of Examination
                  </td>
                  <td className="px-2 py-1.5">
                    <Input
                      type="date"
                      className="h-8 text-sm"
                      value={header.dptDateOfExamination}
                      onChange={(e) => updateHeader("dptDateOfExamination", e.target.value)}
                    />
                  </td>
                </tr>`;

const dptOldFlat = `${dptDateRow}
                {/* Typeable text fields */}
                {([
                  ["Testing Standard", "dptTestingStandard", "e.g. ASME Section V 2023, Article 6"],
                  ["Acceptance Criteria", "dptAcceptanceCriteria", "e.g. ASME Section VIII Div. 1, Appx. 8, Clause 8.4"],
                  ["Surface Preparation", "dptSurfacePreparation", "e.g. Grinding and wire brush"],
                  ["Surface Temperature", "dptSurfaceTemperature", "e.g. 32 °C"],
                  ["Penetrant Type", "dptPenetrantType", "e.g. Colour contrast (visible), solvent removable"],
                  ["Penetrant Process", "dptPenetrantProcess", "e.g. Solvent removable / Water washable"],
                  ["Method of Pre-cleaning", "dptMethodOfPreCleaning", "e.g. Solvent cleaning"],
                  ["Drying Time After Pre-cleaning", "dptDryingTimeAfterPreCleaning", "e.g. 5 minutes"],
                  ["Method of Applying Penetrant", "dptMethodOfApplyingPenetrant", "e.g. Spray"],
                  ["Penetrating Time", "dptPenetratingTime", "e.g. 10 minutes"],
                  ["Method of Removing Excess Penetrant", "dptMethodOfRemovingExcessPenetrant", "e.g. Solvent wipe"],
                  ["Method of Applying Developer", "dptMethodOfApplyingDeveloper", "e.g. Spray"],
                  ["Development Time", "dptDevelopmentTime", "e.g. 10 minutes"],
                  ["Interpretation Time", "dptInterpretationTime", "e.g. 10 minutes"],
                  ["Lighting Equipment", "dptLightingEquipment", "e.g. LED torch ≥ 1000 lux"],
                  ["Post Cleaning", "dptPostCleaning", "e.g. Solvent wipe / Water wash"],
                ] as const).map(([label, fieldKey, placeholder]) => (
                  <tr key={fieldKey} className="border-b border-zinc-200">
                    <td className="bg-purple-50 border-r border-zinc-200 px-3 py-2 font-medium text-zinc-700">
                      {label}
                    </td>
                    <td className="px-2 py-1.5">
                      <Input
                        className="h-8 text-sm"
                        value={header[fieldKey]}
                        onChange={(e) => updateHeader(fieldKey, e.target.value)}
                        placeholder={placeholder}
                      />
                    </td>
                  </tr>
                ))}`;

const dptNewGrouped = `${formSubhead("purple", "General Information")}
${dptDateRow}
                {([
                  ["Testing Standard", "dptTestingStandard", "e.g. ASME Section V 2023, Article 6"],
                  ["Acceptance Criteria", "dptAcceptanceCriteria", "e.g. ASME Section VIII Div. 1, Appx. 8, Clause 8.4"],
                ] as const).map(([label, fieldKey, placeholder]) => (
                  <tr key={fieldKey} className="border-b border-zinc-200">
                    <td className="bg-purple-50 border-r border-zinc-200 px-3 py-2 font-medium text-zinc-700">
                      {label}
                    </td>
                    <td className="px-2 py-1.5">
                      <Input
                        className="h-8 text-sm"
                        value={header[fieldKey]}
                        onChange={(e) => updateHeader(fieldKey, e.target.value)}
                        placeholder={placeholder}
                      />
                    </td>
                  </tr>
                ))}
${formGroup("purple", "Surface &amp; Preparation", [
  `["Surface Preparation", "dptSurfacePreparation", "e.g. Grinding and wire brush"]`,
  `["Surface Temperature", "dptSurfaceTemperature", "e.g. 32 °C"]`,
  `["Method of Pre-cleaning", "dptMethodOfPreCleaning", "e.g. Solvent cleaning"]`,
  `["Drying Time After Pre-cleaning", "dptDryingTimeAfterPreCleaning", "e.g. 5 minutes"]`,
  `["Post Cleaning", "dptPostCleaning", "e.g. Solvent wipe / Water wash"]`,
])}
${formGroup("purple", "Testing Materials / Consumables", [
  `["Penetrant Type", "dptPenetrantType", "e.g. Colour contrast (visible), solvent removable"]`,
  `["Penetrant Process", "dptPenetrantProcess", "e.g. Solvent removable / Water washable"]`,
  `["Method of Applying Penetrant", "dptMethodOfApplyingPenetrant", "e.g. Spray"]`,
  `["Method of Removing Excess Penetrant", "dptMethodOfRemovingExcessPenetrant", "e.g. Solvent wipe"]`,
  `["Method of Applying Developer", "dptMethodOfApplyingDeveloper", "e.g. Spray"]`,
])}
${formGroup("purple", "Testing Timing &amp; Interpretation", [
  `["Penetrating Time", "dptPenetratingTime", "e.g. 10 minutes"]`,
  `["Development Time", "dptDevelopmentTime", "e.g. 10 minutes"]`,
  `["Interpretation Time", "dptInterpretationTime", "e.g. 10 minutes"]`,
  `["Lighting Equipment", "dptLightingEquipment", "e.g. LED torch ≥ 1000 lux"]`,
])}`;

let f = read(FORM);
f = replaceOnce(f, "form Vessel MPT parameters grouped", mptOldFlat, mptNewGrouped);
f = replaceOnce(f, "form Vessel DPT parameters grouped", dptOldFlat, dptNewGrouped);
write(FORM, f);

// ═══════════ DETAIL — VESSEL MPT (orange) ═══════════
const mptDetailOld = `                  {([
                    ["Date of Examination", report.mptDateOfExamination ? new Date(report.mptDateOfExamination).toISOString().slice(0, 10) : null],
                    ["Testing Standard", report.mptTestingStandard],
                    ["Acceptance Criteria", report.mptAcceptanceCriteria],
                    ["Surface Preparation", report.mptSurfacePreparation],
                    ["Surface Temperature", report.mptSurfaceTemperature],
                    ["Type of Instrument / Sl. No.", report.mptInstrumentSerialNo],
                    ["MPT Method", report.mptMethod],
                    ["Type of Current", report.mptTypeOfCurrent],
                    ["AC Yoke Lifting Capacity", report.mptAcYokeLiftingCapacity],
                    ["Contrast Medium", report.mptContrastMedium],
                    ["Method of Pre-cleaning", report.mptMethodOfPreCleaning],
                    ["Method of Applying White Contrast", report.mptMethodOfApplyingWhiteContrast],
                    ["AC Yoke Pole Spacing", report.mptAcYokePoleSpacing],
                    ["Magnetic Medium", report.mptMagneticMedium],
                    ["Method of Applying Magnetic Medium", report.mptMethodOfApplyingMagneticMedium],
                    ["Development Time", report.mptDevelopmentTime],
                    ["Interpretation Time", report.mptInterpretationTime],
                    ["Lighting Equipment", report.mptLightingEquipment],
                    ["Post Cleaning", report.mptPostCleaning],
                  ] as Array<[string, string | null | undefined]>).map(([label, value], idx) => (
                    <tr key={idx} className="border-b border-zinc-200">
                      <td className="bg-orange-50 border-r border-zinc-200 px-3 py-1.5 font-medium text-zinc-700 w-1/3">
                        {label}
                      </td>
                      <td className="px-3 py-1.5">
                        {value && String(value).trim() ? value : <span className="text-muted-foreground">—</span>}
                      </td>
                    </tr>
                  ))}`;

const mptDetailNew = `                  {([
                    ["General Information", [
                      ["Date of Examination", report.mptDateOfExamination ? new Date(report.mptDateOfExamination).toISOString().slice(0, 10) : null],
                      ["Testing Standard", report.mptTestingStandard],
                      ["Acceptance Criteria", report.mptAcceptanceCriteria],
                    ]],
                    ["Surface & Preparation", [
                      ["Surface Preparation", report.mptSurfacePreparation],
                      ["Surface Temperature", report.mptSurfaceTemperature],
                      ["Method of Pre-cleaning", report.mptMethodOfPreCleaning],
                      ["Post Cleaning", report.mptPostCleaning],
                    ]],
                    ["Equipment Details", [
                      ["Type of Instrument / Sl. No.", report.mptInstrumentSerialNo],
                      ["AC Yoke Lifting Capacity", report.mptAcYokeLiftingCapacity],
                      ["AC Yoke Pole Spacing", report.mptAcYokePoleSpacing],
                    ]],
                    ["Testing Method", [
                      ["MPT Method", report.mptMethod],
                      ["Type of Current", report.mptTypeOfCurrent],
                      ["Contrast Medium", report.mptContrastMedium],
                      ["Method of Applying White Contrast", report.mptMethodOfApplyingWhiteContrast],
                      ["Magnetic Medium", report.mptMagneticMedium],
                      ["Method of Applying Magnetic Medium", report.mptMethodOfApplyingMagneticMedium],
                    ]],
                    ["Testing Timing & Interpretation", [
                      ["Development Time", report.mptDevelopmentTime],
                      ["Interpretation Time", report.mptInterpretationTime],
                      ["Lighting Equipment", report.mptLightingEquipment],
                    ]],
                  ] as Array<[string, Array<[string, string | null | undefined]>]>).map(([groupTitle, rows]) => (
                    <Fragment key={groupTitle}>
                      <tr className="bg-orange-100">
                        <td colSpan={2} className="border border-zinc-300 px-3 py-1.5 font-semibold text-orange-800">
                          {groupTitle}
                        </td>
                      </tr>
                      {rows.map(([label, value], idx) => (
                        <tr key={\`\${groupTitle}-\${idx}\`} className="border-b border-zinc-200">
                          <td className="bg-orange-50 border-r border-zinc-200 px-3 py-1.5 font-medium text-zinc-700 w-1/3">
                            {label}
                          </td>
                          <td className="px-3 py-1.5">
                            {value && String(value).trim() ? value : <span className="text-muted-foreground">—</span>}
                          </td>
                        </tr>
                      ))}
                    </Fragment>
                  ))}`;

// ═══════════ DETAIL — VESSEL DPT (purple) ═══════════
// NOTE: prefixed with the VESSEL_DPT h3 heading — the PIPELINE_DPT block
// reuses the same dpt* fields and must stay flat (Piping not touched).
const dptDetailOld = `              <h3 className="mb-2 text-xs font-bold uppercase text-purple-700 border-b border-purple-300 pb-1">
                3. Dye Penetrant Testing Parameters
              </h3>
              <table className="w-full border-collapse text-xs">
                <tbody>
                  {([
                    ["Date of Examination", report.dptDateOfExamination ? new Date(report.dptDateOfExamination).toISOString().slice(0, 10) : null],
                    ["Testing Standard", report.dptTestingStandard],
                    ["Acceptance Criteria", report.dptAcceptanceCriteria],
                    ["Surface Preparation", report.dptSurfacePreparation],
                    ["Surface Temperature", report.dptSurfaceTemperature],
                    ["Penetrant Type", report.dptPenetrantType],
                    ["Penetrant Process", report.dptPenetrantProcess],
                    ["Method of Pre-cleaning", report.dptMethodOfPreCleaning],
                    ["Drying Time After Pre-cleaning", report.dptDryingTimeAfterPreCleaning],
                    ["Method of Applying Penetrant", report.dptMethodOfApplyingPenetrant],
                    ["Penetrating Time", report.dptPenetratingTime],
                    ["Method of Removing Excess Penetrant", report.dptMethodOfRemovingExcessPenetrant],
                    ["Method of Applying Developer", report.dptMethodOfApplyingDeveloper],
                    ["Development Time", report.dptDevelopmentTime],
                    ["Interpretation Time", report.dptInterpretationTime],
                    ["Lighting Equipment", report.dptLightingEquipment],
                    ["Post Cleaning", report.dptPostCleaning],
                  ] as Array<[string, string | null | undefined]>).map(([label, value], idx) => (
                    <tr key={idx} className="border-b border-zinc-200">
                      <td className="bg-purple-50 border-r border-zinc-200 px-3 py-1.5 font-medium text-zinc-700 w-1/3">
                        {label}
                      </td>
                      <td className="px-3 py-1.5">
                        {value && value.trim() ? value : <span className="text-muted-foreground">—</span>}
                      </td>
                    </tr>
                  ))}`;

const dptDetailNew = `              <h3 className="mb-2 text-xs font-bold uppercase text-purple-700 border-b border-purple-300 pb-1">
                3. Dye Penetrant Testing Parameters
              </h3>
              <table className="w-full border-collapse text-xs">
                <tbody>
                  {([
                    ["General Information", [
                      ["Date of Examination", report.dptDateOfExamination ? new Date(report.dptDateOfExamination).toISOString().slice(0, 10) : null],
                      ["Testing Standard", report.dptTestingStandard],
                      ["Acceptance Criteria", report.dptAcceptanceCriteria],
                    ]],
                    ["Surface & Preparation", [
                      ["Surface Preparation", report.dptSurfacePreparation],
                      ["Surface Temperature", report.dptSurfaceTemperature],
                      ["Method of Pre-cleaning", report.dptMethodOfPreCleaning],
                      ["Drying Time After Pre-cleaning", report.dptDryingTimeAfterPreCleaning],
                      ["Post Cleaning", report.dptPostCleaning],
                    ]],
                    ["Testing Materials / Consumables", [
                      ["Penetrant Type", report.dptPenetrantType],
                      ["Penetrant Process", report.dptPenetrantProcess],
                      ["Method of Applying Penetrant", report.dptMethodOfApplyingPenetrant],
                      ["Method of Removing Excess Penetrant", report.dptMethodOfRemovingExcessPenetrant],
                      ["Method of Applying Developer", report.dptMethodOfApplyingDeveloper],
                    ]],
                    ["Testing Timing & Interpretation", [
                      ["Penetrating Time", report.dptPenetratingTime],
                      ["Development Time", report.dptDevelopmentTime],
                      ["Interpretation Time", report.dptInterpretationTime],
                      ["Lighting Equipment", report.dptLightingEquipment],
                    ]],
                  ] as Array<[string, Array<[string, string | null | undefined]>]>).map(([groupTitle, rows]) => (
                    <Fragment key={groupTitle}>
                      <tr className="bg-purple-100">
                        <td colSpan={2} className="border border-zinc-300 px-3 py-1.5 font-semibold text-purple-800">
                          {groupTitle}
                        </td>
                      </tr>
                      {rows.map(([label, value], idx) => (
                        <tr key={\`\${groupTitle}-\${idx}\`} className="border-b border-zinc-200">
                          <td className="bg-purple-50 border-r border-zinc-200 px-3 py-1.5 font-medium text-zinc-700 w-1/3">
                            {label}
                          </td>
                          <td className="px-3 py-1.5">
                            {value && value.trim() ? value : <span className="text-muted-foreground">—</span>}
                          </td>
                        </tr>
                      ))}
                    </Fragment>
                  ))}`;

let d = read(DETAIL);
d = replaceOnce(d, "detail Vessel MPT parameters grouped", mptDetailOld, mptDetailNew);
d = replaceOnce(d, "detail Vessel DPT parameters grouped", dptDetailOld, dptDetailNew);
write(DETAIL, d);

console.log("DONE");
