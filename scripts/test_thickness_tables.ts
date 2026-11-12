// Thickness multi-table — TS-level smoke test.
// Verifies the pure helpers in @/lib/thickness-tables behave correctly
// for the multi-table Thickness Pipeline feature.
//
// Run with:  npx tsx scripts/test_thickness_tables.ts
import {
  parseThicknessTablesConfig,
  serializeThicknessTablesConfig,
  generateThicknessTableId,
  defaultThicknessTableLabel,
  DEFAULT_TABLE_ID,
  DEFAULT_TABLE_LABEL,
} from "../src/lib/thickness-tables";

let pass = 0, fail = 0;
function check(label: string, ok: boolean, detail?: string) {
  if (ok) {
    pass++;
    console.log(`OK   ${label}${detail ? "  — " + detail : ""}`);
  } else {
    fail++;
    console.log(`!!   ${label}${detail ? "  — " + detail : ""}`);
  }
}

console.log("=".repeat(78));
console.log("Thickness-tables helper smoke test");
console.log("=".repeat(78));

// 1. Empty / missing config → single default table.
check("null config → single default",
  parseThicknessTablesConfig(null).length === 1,
  JSON.stringify(parseThicknessTablesConfig(null)));
check("empty string → single default",
  parseThicknessTablesConfig("").length === 1);
check("invalid JSON → single default",
  parseThicknessTablesConfig("not json").length === 1);
check("empty array → single default",
  parseThicknessTablesConfig("[]").length === 1);
check("default table has correct id+label",
  (() => {
    const t = parseThicknessTablesConfig(null)[0];
    return t.id === DEFAULT_TABLE_ID && t.label === DEFAULT_TABLE_LABEL;
  })());

// 2. Round-trip serialize/parse preserves entries.
const sample = [
  { id: DEFAULT_TABLE_ID, label: "Thickness Pipeline Table 1", sortOrder: 0 },
  { id: "t_abc", label: "Thickness Pipeline Table 2", sortOrder: 1 },
  { id: "t_xyz", label: "Spool Piece Measurements", sortOrder: 2 },
];
const serialized = serializeThicknessTablesConfig(sample);
const roundTripped = parseThicknessTablesConfig(serialized);
check("round-trip preserves count",
  roundTripped.length === sample.length,
  `expected ${sample.length}, got ${roundTripped.length}`);
check("round-trip preserves ids",
  roundTripped.every((t, i) => t.id === sample[i].id));
check("round-trip preserves labels",
  roundTripped.every((t, i) => t.label === sample[i].label));
check("round-trip re-numbers sortOrder 0..n-1",
  roundTripped.every((t, i) => t.sortOrder === i));

// 3. If a parsed config doesn't include the "default" entry, one is
//    prepended (so existing rows with tableGroup="default" always have
//    a table to render in).
const noDefault = [{ id: "t_extra", label: "Extra", sortOrder: 0 }];
const withDefault = parseThicknessTablesConfig(JSON.stringify(noDefault));
check("missing default entry is prepended",
  withDefault.some((t) => t.id === DEFAULT_TABLE_ID));
check("missing default entry is first",
  withDefault[0].id === DEFAULT_TABLE_ID);
check("prepended default has correct label",
  withDefault[0].label === DEFAULT_TABLE_LABEL);

// 4. Malformed entries are dropped silently.
//   Of the 6 entries below, only #1 (ok1) is fully valid:
//     - #2 has id=123 (number, not string)   → dropped
//     - #3 has no id                          → dropped
//     - #4 has label=42 (number, not string) → dropped
//     - #5 is a string, not an object        → dropped
//     - #6 is null                           → dropped
//   Since none of the valid entries has id="default", the parser
//   prepends a default table → 2 entries total (1 valid + 1 default).
const malformed = [
  { id: "ok1", label: "OK 1", sortOrder: 0 },
  { id: 123, label: "wrong type id" },            // id wrong type
  { label: "missing id" },                         // missing id
  { id: "ok2", label: 42 },                        // label wrong type
  "string entry",                                  // not an object
  null,
];
const cleaned = parseThicknessTablesConfig(JSON.stringify(malformed));
check("malformed entries are dropped",
  cleaned.length === 2, // 1 valid (ok1) + 1 prepended default
  `got ${cleaned.length}`);

// 5. generateThicknessTableId produces unique-ish ids.
const ids = new Set<string>();
for (let i = 0; i < 100; i++) ids.add(generateThicknessTableId());
check("generateThicknessTableId produces 100 unique ids",
  ids.size === 100);

// 6. defaultThicknessTableLabel is 1-indexed.
check("defaultThicknessTableLabel(1) === 'Thickness Pipeline Table 1'",
  defaultThicknessTableLabel(1) === "Thickness Pipeline Table 1");
check("defaultThicknessTableLabel(5) === 'Thickness Pipeline Table 5'",
  defaultThicknessTableLabel(5) === "Thickness Pipeline Table 5");

console.log();
console.log(`Smoke test: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
