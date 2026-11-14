// UI cleanup pass 2: zinc-50 info Cards, thickness-table status line,
// instructional empty states. Text-only removals; no functional JSX touched.
// Run: node scripts/cleanup-ui-descriptions-2.mjs
import fs from "fs";

const FORM = "src/components/views/pipeline-report-form-view.tsx";
function read(p) { return fs.readFileSync(p, "utf8"); }
function write(p, s) { fs.writeFileSync(p, s); }

let f = read(FORM);

// 1. All zinc-50 information/help Cards (no nested <Card> inside).
const cardRe = /[ \t]*<Card className="bg-zinc-50">\n[\s\S]*?<\/Card>\n/g;
const n = (f.match(cardRe) || []).length;
f = f.replace(cardRe, "");
console.log(`  ✓ removed: ${n} zinc-50 info Cards`);

// 2. Thickness-table status line (keeps the Add Table buttons beside it).
const statusLine = `          <div className="text-xs text-muted-foreground">
            <strong>{thicknessTables.length}</strong> thickness table{thicknessTables.length === 1 ? "" : "s"} configured.
            {" "}Custom columns are shared across all tables.
          </div>
`;
const parts = f.split(statusLine);
if (parts.length !== 2) throw new Error(`thickness status line: found ${parts.length - 1}`);
f = parts.join("");
console.log("  ✓ removed: thickness tables status line");

// 3. Compact instructional empty states (keep a plain "No rows yet." hint).
const emptyStates = [
  ["measurement rows empty state", "No measurement rows in this table yet. Click <strong>Add Row</strong> to begin."],
  ["visual observations empty state", "No observations yet. Click <strong>Add Observation</strong> to begin."],
  ["DPT observations empty state", "No DPT observations yet. Click <strong>Add Row</strong> to begin."],
  ["VUTM component empty state", "No rows yet. Click <strong>Add Component Row</strong> to begin — e.g. one row per direction for Shell-1 (East, West, North, South)."],
  ["VUTM H component empty state", "No rows yet. Click <strong>Add Component Row</strong> to begin."],
  ["MPT observations empty state", "No MPT observations yet. Click <strong>Add Row</strong> to begin."],
];
for (const [label, find] of emptyStates) {
  const c = f.split(find).length - 1;
  if (c < 1) throw new Error(`${label}: not found`);
  f = f.split(find).join("No rows yet.");
  console.log(`  ✓ compacted: ${label} (x${c})`);
}

write(FORM, f);
console.log("DONE");
