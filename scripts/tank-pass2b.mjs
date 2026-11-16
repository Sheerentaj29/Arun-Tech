// TANK — Pass 2b: insert the 4 tank step-2 blocks into the form view,
// right after the VESSEL_UTM block (before the piping MPT block).
// Idempotent. Run: node scripts/tank-pass2b.mjs
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

const p = "src/components/views/pipeline-report-form-view.tsx";
let s = read(p);
s = rep(s, "tank step-2 blocks",
`      {/* ═══ STEP 2 (MPT): MAGNETIC PARTICLE TESTING PROCEDURE ═══ */}
      {step === 2 && header.reportType === "PIPELINE_MPT" && (`,
`${snippet("step2-tdpt.txt")}${snippet("step2-tmpt.txt")}${snippet("step2-tws.txt")}${snippet("step2-tutm.txt")}
      {/* ═══ STEP 2 (MPT): MAGNETIC PARTICLE TESTING PROCEDURE ═══ */}
      {step === 2 && header.reportType === "PIPELINE_MPT" && (`);
write(p, s);
console.log("PASS2B DONE");
