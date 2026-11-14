// One-off: inspect the saved PIPELINE_WELD_SCAN report WS-UI-SHOT.
const BASE = "http://localhost:3000";

const loginRes = await fetch(`${BASE}/api/auth`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email: "admin@inspections.demo", password: "admin123" }),
});
const setCookie = loginRes.headers.getSetCookie?.() ?? [];
const token = setCookie.map((c) => c.split(";")[0]).find((c) => c.startsWith("ira_session")) ?? "";
if (!token) { console.error("FATAL: no session token"); process.exit(1); }
const H = { "Content-Type": "application/json", Authorization: `Bearer ${token}`, Cookie: token };

// Collect ALL pages, then report every WS-UI-SHOT match.
let items = [];
let page = 1;
for (;;) {
  const res = await fetch(`${BASE}/api/pipeline-inspections?page=${page}&pageSize=100`, { headers: H });
  const body = await res.json().catch(() => ({}));
  const batch = body.items ?? [];
  items = items.concat(batch);
  if (page >= (body.totalPages ?? 1) || batch.length === 0) break;
  page++;
}
const matches = items.filter((r) => r.reportNumber === "WS-UI-SHOT");
console.log("matches:", matches.length, "total scanned:", items.length);
for (const report of matches) {
  console.log(JSON.stringify({
    id: report.id,
    updatedAt: report.updatedAt,
    surfaceCondition: report.wsScanningSurfaceCondition,
    probeRow1: (JSON.parse(report.wsProbeRows ?? "[]")[0]) ?? null,
  }, null, 2));
}
process.exit(0);
