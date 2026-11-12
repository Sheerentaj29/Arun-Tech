// Quick runtime smoke test for the shared client-logo resolver.
// Verifies the TS module behaves identically to the Python verification.
//
// Run with:  npx tsx scripts/test_client_logo_resolver.ts
import {
  resolveClientLogo,
  normalizeClientName,
  CLIENT_LOGO_MAP_READONLY,
} from "../src/lib/client-logo-mapping";

const DB_CLIENTS = [
  "Aarti Industries Ltd",
  "Abdallah I.Al Tamimi Industrial Services Co.",
  "AcidChem Industries Pvt Ltd (DEMO)",
  "Advanced Inspection Services",
  "Atul Ltd",
  "Bharat Petroleum Corporation Ltd",
  "Blue Star Limited",
  "COROMANDEL INTERNATIONAL LIMITED",
  "Chemplast Sanmar Limited",
  "Chennai Petroleum Corporation Limited",
  "Chidambaram Shipcare Private Limited",
  "Citadel Engineering Company",
  "Dow Chemicals International Limited",
  "Global Analytical Services",
  "Grasim Industries Limited",
  "Green Flame Pvt Ltd",
  "Greenfield Water Solutions (DEMO)",
  "Hindustan Oil Exploration Company Limited",
  "Hindustan Zinc Ltd",
  "IEQS Technologies Private Limited",
  "ITD Cementation India Limited",
  "Indczech Engineering Pvt. Ltd",
  "Indian Additives Limited",
  "Indian Oil Corporation Limited",
  "JK Tyre & Industries Ltd",
  "Jordan India Fertilizer Company L.L.C",
  "K.C. Surendran",
  "Kamachi Industries Limited",
  "Kiran Global Chems Limited",
  "Kothari Petrochemicals Limited",
  "L&T GeoStructure Private Limited",
  "Larsen & Toubro Limited, Construction",
  "Laxmi Organic Industries Ltd",
  "Madras Fertilizers Limited",
  "Malladi Drugs & Pharmaceuticals Ltd",
  "Mogli Labs India Pvt Ltd",
  "PCBL Limited",
  "Pidilite Industries Limited",
  "Pro India Engineering Pvt Ltd",
  "Raftaar Terminals Pvt Ltd",
  "Raj Petro Specialities Private Limited",
  "Sunfix Chemicals",
  "Supreme Petrochem Ltd",
  "TQ Cert Services Private Limited",
  "TUV India Pvt Ltd",
  "Tamilnadu Petroproducts Limited",
  "Tata Chemicals Limited",
  "Tata Projects Limited",
  "Thirumalai Chemicals Ltd",
  "URC Construction Pvt Ltd",
  "Ultramarine & Pigments Ltd",
  "Ultramarine Specialty Chemicals Limited",
  "V-Gazolution",
  "Vaaman Engineers India Limited",
  "Valspar (India) Coatings Corporation Private Limited",
  "Vedanta Aluminium Metal Limited",
  "Western Petrochem Ltd (DEMO)",
];

let pass = 0;
let fail = 0;
let placeholder = 0;
const failures: string[] = [];

for (const name of DB_CLIENTS) {
  const logo = resolveClientLogo(name);
  if (logo) {
    pass++;
    console.log(`OK   ${name.padEnd(55)} -> ${logo}`);
  } else {
    placeholder++;
    console.log(`--   ${name.padEnd(55)} -> <placeholder>`);
  }
}

console.log();
console.log(`Resolver smoke test: ${pass} mapped, ${placeholder} placeholder, ${fail} failures`);
console.log(`Total map entries: ${Object.keys(CLIENT_LOGO_MAP_READONLY).length}`);

// Spot-check normalization robustness — same client typed slightly
// differently must still resolve (extra spaces, mixed case, punctuation).
console.log();
console.log("Normalization robustness:");
const robust = [
  ["  kothari   petrochemicals  limited  ", "kothari_petrochemicals.png"],
  ["PCBL    LIMITED", "pcbl_chemical.png"],
  ["TUV India Pvt Ltd", "tuv_india.png"],
  ["L&T GeoStructure Private Limited", "lt.png"],
  ["Larsen & Toubro Limited, Construction", "lt.png"],
  ["Valspar (India) Coatings Corporation Private Limited", "valspar.png"],
] as const;

for (const [input, expected] of robust) {
  const got = resolveClientLogo(input);
  const norm = normalizeClientName(input);
  const ok = got === expected;
  console.log(`  ${ok ? "OK " : "!! "} ${JSON.stringify(input).padEnd(60)} norm=${JSON.stringify(norm).padEnd(50)} -> ${got}`);
  if (!ok) fail++;
}

if (fail > 0) {
  process.exit(1);
}
