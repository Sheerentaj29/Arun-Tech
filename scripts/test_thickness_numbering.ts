// Smoke test for the automatic index numbering helpers.
import {
  THICKNESS_SECTION_NUMBER,
  THICKNESS_SECTION_TITLE,
  thicknessSectionHeading,
  thicknessTableHeading,
  thicknessTableIndexEntry,
  parseThicknessTablesConfig,
  serializeThicknessTablesConfig,
} from "../src/lib/thickness-tables";

let pass = 0, fail = 0;
function check(label: string, ok: boolean, detail?: string) {
  if (ok) { pass++; console.log(`OK   ${label}${detail ? "  — " + detail : ""}`); }
  else { fail++; console.log(`!!   ${label}${detail ? "  — " + detail : ""}`); }
}

console.log("=".repeat(70));
console.log("Index Numbering Smoke Test");
console.log("=".repeat(70));

// 1. Constants
check("section number is '7'", THICKNESS_SECTION_NUMBER === "7");
check("section title is 'Thickness Measurement'", THICKNESS_SECTION_TITLE === "Thickness Measurement");

// 2. Parent heading
check("thicknessSectionHeading() === '7. Thickness Measurement'",
  thicknessSectionHeading() === "7. Thickness Measurement");

// 3. Table headings with dynamic numbering
check("table 1 heading", thicknessTableHeading(1, "Tank A") === "7.1 – Tank A");
check("table 2 heading", thicknessTableHeading(2, "Tank B") === "7.2 – Tank B");
check("table 3 heading", thicknessTableHeading(3, "Tank C") === "7.3 – Tank C");
check("table 10 heading (double digit)", thicknessTableHeading(10, "Spool J") === "7.10 – Spool J");

// 4. Index entries mirror table headings
check("index entry 1 === table heading 1",
  thicknessTableIndexEntry(1, "Tank A") === thicknessTableHeading(1, "Tank A"));
check("index entry 3 === table heading 3",
  thicknessTableIndexEntry(3, "Tank C") === thicknessTableHeading(3, "Tank C"));

// 5. Dynamic renumbering after delete
//    Start with 3 tables: Tank A, Tank B, Tank C
//    Delete table 2 (Tank B) → remaining: Tank A (7.1), Tank C (7.2)
const original = [
  { id: "default", label: "Tank A", sortOrder: 0 },
  { id: "t_1",     label: "Tank B", sortOrder: 1 },
  { id: "t_2",     label: "Tank C", sortOrder: 2 },
];
const serialized = serializeThicknessTablesConfig(original);
const parsed = parseThicknessTablesConfig(serialized);
check("3 tables parsed", parsed.length === 3);

// Simulate deleting the middle table
const afterDelete = parsed.filter((t) => t.id !== "t_1");
check("after delete: 2 tables remain", afterDelete.length === 2);
check("after delete: table 1 is '7.1 – Tank A'",
  thicknessTableHeading(1, afterDelete[0].label) === "7.1 – Tank A");
check("after delete: table 2 is '7.2 – Tank C' (renumbered!)",
  thicknessTableHeading(2, afterDelete[1].label) === "7.2 – Tank C");

// 6. Dynamic numbering after add
//    Add a 4th table
const afterAdd = [...original, { id: "t_3", label: "Tank D", sortOrder: 3 }];
const parsedAdd = parseThicknessTablesConfig(serializeThicknessTablesConfig(afterAdd));
check("after add: 4 tables", parsedAdd.length === 4);
check("after add: table 4 is '7.4 – Tank D'",
  thicknessTableHeading(4, parsedAdd[3].label) === "7.4 – Tank D");

// 7. Dynamic numbering after rename
check("after rename: table 1 heading uses new label",
  thicknessTableHeading(1, "Renamed Tank") === "7.1 – Renamed Tank");

// 8. Dynamic numbering after reorder
//    Reverse the order: Tank C, Tank B, Tank A
const reordered = [...original].reverse();
const parsedReorder = parseThicknessTablesConfig(serializeThicknessTablesConfig(reordered));
check("after reorder: table 1 is Tank C",
  thicknessTableHeading(1, parsedReorder[0].label) === "7.1 – Tank C");
check("after reorder: table 2 is Tank B",
  thicknessTableHeading(2, parsedReorder[1].label) === "7.2 – Tank B");
check("after reorder: table 3 is Tank A",
  thicknessTableHeading(3, parsedReorder[2].label) === "7.3 – Tank A");

// 9. Single-table report still gets "7.1" numbering
const single = parseThicknessTablesConfig(null);
check("single table: heading is '7.1 – Thickness Pipeline Table 1'",
  thicknessTableHeading(1, single[0].label) === "7.1 – Thickness Pipeline Table 1");

console.log();
console.log(`Smoke test: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
