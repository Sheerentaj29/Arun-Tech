#!/bin/bash
# report_history_verify.sh — Phase 10 verification:
# Report History module (real data), sidebar rename, prototype removal,
# role-based actions, 4-type selector, no demo records.
# Screenshots -> /tmp/rh-verify (TEMPORARY — deleted after user verification).
set -u
OUT=/tmp/rh-verify
LOG="$OUT/verify.log"
rm -rf "$OUT" && mkdir -p "$OUT"
cd /home/z/my-project
AB="agent-browser"
S="$AB --session fresh"

step() { echo "=== $1 ===" | tee -a "$LOG"; }
shot() { $S screenshot "$OUT/$1" >> "$LOG" 2>&1 && echo "shot: $1" | tee -a "$LOG"; }
ev()   { echo "EVAL> $1" | tee -a "$LOG"; $S eval "$1" 2>&1 | tee -a "$LOG"; }

step "1) ENSURE SERVER UP"
CODE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/ --max-time 10)
if [ "$CODE" != "200" ]; then
  pkill -f "next dev" 2>/dev/null; pkill -f "next-server" 2>/dev/null; sleep 3
  rm -rf .next/dev dev.log
  setsid nohup bash -c 'exec npm run dev > /dev/null 2>&1' < /dev/null > /dev/null 2>&1 &
  for i in $(seq 1 55); do
    sleep 3
    CODE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/ --max-time 20)
    [ "$CODE" = "200" ] && break
  done
fi
echo "SERVER: HTTP $CODE" | tee -a "$LOG"
[ "$CODE" != "200" ] && exit 1

step "2) API LOGIN (admin) + CREATE A REAL REPORT (Atul Ltd / Valsad Plant)"
CK="$OUT/cookies.txt"
LOGIN=$(curl -s -c "$CK" -X POST http://localhost:3000/api/auth -H 'Content-Type: application/json' \
  -d '{"email":"admin@inspections.demo","password":"admin123"}')
echo "$LOGIN" | head -c 200 | tee -a "$LOG"; echo | tee -a "$LOG"
TODAY=$(date +%F)
CREATE=$(curl -s -b "$CK" -X POST http://localhost:3000/api/pipeline-inspections -H 'Content-Type: application/json' -d "{
  \"reportNumber\": \"RH-VERIFY-001\",
  \"reportType\": \"PIPELINE_WELD_SCAN\",
  \"clientId\": \"cmvw1lel70000q29l6wgpjrqd\",
  \"plantId\": \"cmvw1lel80002q29l7x9ty2ne\",
  \"inspectionArea\": \"Transfer Line TL-101\",
  \"pipelineDescription\": \"Acid transfer line weld joints\",
  \"pipelineIdentificationNumber\": \"TL-101-A\",
  \"isometricDrawingNumber\": \"ISO-101-7\",
  \"materialOfConstruction\": \"SS316\",
  \"fromDate\": \"$TODAY\",
  \"toDate\": \"$TODAY\"
}")
echo "$CREATE" | head -c 300 | tee -a "$LOG"; echo | tee -a "$LOG"
RID=$(echo "$CREATE" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('id') or d.get('error',''))")
echo "NEW REPORT ID: $RID" | tee -a "$LOG"
echo "$RID" > "$OUT/rid.txt"

step "3) BROWSER LOGIN (admin)"
$S set viewport 1440 900 >> "$LOG" 2>&1
$S open http://localhost:3000 >> "$LOG" 2>&1
sleep 10
$S find label "Email" fill "admin@inspections.demo" >> "$LOG" 2>&1
$S find label "Password" fill "admin123" >> "$LOG" 2>&1
$S find role button click --name "Sign in" >> "$LOG" 2>&1
sleep 12

step "4) SIDEBAR SHOWS Report History (no Inspections)"
ev "(() => { const btns = Array.from(document.querySelectorAll('nav button')).map(b => b.textContent.trim()); return JSON.stringify(btns); })()"
shot "01-admin-dashboard-sidebar.png"

step "5) OPEN REPORT HISTORY"
$S find role button click --name "Report History" >> "$LOG" 2>&1
sleep 5
ev "(() => { const t = document.body.innerText; return JSON.stringify({ hasTitle: t.includes('Report History'), hasPrototypeNote: t.toLowerCase().includes('prototype note'), hasReport: t.includes('RH-VERIFY-001'), headers: ['Report No.','Client','Equipment / Component','Report Type','From Date','To Date','Status','Actions'].map(h => t.includes(h)), typeShown: t.includes('Weld Scan') }); })()"
shot "02-report-history-admin.png"

step "6) ACTIONS ON RH-VERIFY-001 ROW (admin, Draft -> View/Edit/PDF, NO Review)"
ev "(() => { const rows = Array.from(document.querySelectorAll('tbody tr')); const row = rows.find(r => r.textContent.includes('RH-VERIFY-001')); if (!row) return 'ROW_NOT_FOUND'; const btns = Array.from(row.querySelectorAll('button')).map(b => b.textContent.trim()); return JSON.stringify(btns); })()"

step "7) SUBMIT FOR REVIEW VIA API -> ROW GAINS Review BUTTON"
RID=$(cat "$OUT/rid.txt")
SUB=$(curl -s -b "$CK" -o /dev/null -w "%{http_code}" -X POST "http://localhost:3000/api/pipeline-inspections/$RID/submit" -H 'Content-Type: application/json' -d '{}')
echo "SUBMIT -> HTTP $SUB" | tee -a "$LOG"
$S open http://localhost:3000 >> "$LOG" 2>&1
sleep 6
$S find role button click --name "Report History" >> "$LOG" 2>&1
sleep 5
ev "(() => { const rows = Array.from(document.querySelectorAll('tbody tr')); const row = rows.find(r => r.textContent.includes('RH-VERIFY-001')); if (!row) return 'ROW_NOT_FOUND'; return JSON.stringify({ status: (row.textContent.match(/Submitted for Review|Draft|Approved/) || [''])[0], btns: Array.from(row.querySelectorAll('button')).map(b => b.textContent.trim()) }); })()"
shot "03-report-history-submitted-review.png"

step "8) VIEW OPENS THE CORRECT REPORT"
ev "(() => { const rows = Array.from(document.querySelectorAll('tbody tr')); const row = rows.find(r => r.textContent.includes('RH-VERIFY-001')); const btn = row && Array.from(row.querySelectorAll('button')).find(b => b.textContent.trim().startsWith('View')); if (!btn) return 'BTN_NOT_FOUND'; btn.click(); return 'CLICKED'; })()"
sleep 6
ev "(() => { const t = document.body.innerText; return JSON.stringify({ hasReportNo: t.includes('RH-VERIFY-001'), hasWeldScanTitle: t.toUpperCase().includes('WELD SCAN'), hasApprove: t.includes('Approve'), hasReturn: t.includes('Return for Revision') }); })()"
shot "04-report-detail-view.png"

step "9) BACK TO HISTORY + TYPE FILTER Weld Scan"
$S find role button click --name "Back to list" >> "$LOG" 2>&1
sleep 4
ev "(() => { const btns = Array.from(document.querySelectorAll('nav button')); const b = btns.find(x => x.textContent.trim() === 'Report History'); if (!b) return 'NAV_NOT_FOUND'; b.click(); return 'NAV'; })()"
sleep 4
ev "(() => { const trigs = Array.from(document.querySelectorAll('[role=combobox]')); const t = trigs.find(x => x.textContent.includes('All types')); if (!t) return 'TRIGGER_NOT_FOUND'; t.focus(); return 'FOCUSED'; })()"
$S press Enter >> "$LOG" 2>&1
sleep 2
ev "Array.from(document.querySelectorAll('[role=option]')).map(o => o.textContent.trim()).join(' | ')"
shot "05-type-filter-options.png"
$S find role option click --name "Weld Scan" >> "$LOG" 2>&1
sleep 4
ev "(() => { const rows = Array.from(document.querySelectorAll('tbody tr')); return JSON.stringify({ rowCount: rows.length, allWeldScan: rows.every(r => r.textContent.includes('Weld Scan')), firstNo: rows[0]?.textContent.slice(0, 60) }); })()"
shot "06-report-history-filtered-weld-scan.png"

step "10) RESET FILTER -> Employee login -> OWN REPORTS ONLY"
$S press Escape >> "$LOG" 2>&1
ev "(() => { const trigs = Array.from(document.querySelectorAll('[role=combobox]')); const t = trigs.find(x => x.textContent.includes('Weld Scan')); if (!t) return 'NO_TYPE_FILTER'; t.focus(); return 'FOCUSED'; })()"
$S press Enter >> "$LOG" 2>&1
sleep 2
$S find role option click --name "All types" >> "$LOG" 2>&1
sleep 3
$S find role button click --name "Sign out" >> "$LOG" 2>&1
sleep 5
$S find label "Email" fill "employee@inspections.demo" >> "$LOG" 2>&1
$S find label "Password" fill "employee123" >> "$LOG" 2>&1
$S find role button click --name "Sign in" >> "$LOG" 2>&1
sleep 12
$S find role button click --name "Report History" >> "$LOG" 2>&1
sleep 5
ev "(() => { const t = document.body.innerText; const rows = Array.from(document.querySelectorAll('tbody tr')); return JSON.stringify({ rowCount: rows.length, hasAdminReport: t.includes('RH-VERIFY-001'), anyReviewBtn: rows.some(r => Array.from(r.querySelectorAll('button')).some(b => b.textContent.includes('Review'))) }); })()"
shot "07-report-history-employee.png"

step "11) DASHBOARD (Reports card) + EQUIPMENT DETAIL (no Inspection History)"
$S find role button click --name "Sign out" >> "$LOG" 2>&1
sleep 4
$S find label "Email" fill "admin@inspections.demo" >> "$LOG" 2>&1
$S find label "Password" fill "admin123" >> "$LOG" 2>&1
$S find role button click --name "Sign in" >> "$LOG" 2>&1
sleep 12
ev "(() => { const t = document.body.innerText; return JSON.stringify({ reportsCard: t.includes('Reports'), demoInspectionsText: t.toLowerCase().includes('inspections') }); })()"
shot "08-admin-dashboard.png"
$S find role button click --name "Equipment Master" >> "$LOG" 2>&1
sleep 5
ev "(() => { const rows = Array.from(document.querySelectorAll('tbody tr')); const r = rows[0]; if (!r) return 'NO_ROWS'; return JSON.stringify({ headers: Array.from(document.querySelectorAll('thead th')).map(h => h.textContent.trim()), firstRowId: r.textContent.slice(0, 50), hasInspectionsCol: Array.from(document.querySelectorAll('thead th')).some(h => h.textContent.trim() === 'Inspections') }); })()"
ev "(() => { const r = Array.from(document.querySelectorAll('tbody tr'))[0]; if (r) { r.click(); return 'OPENED'; } return 'NO_ROW'; })()"
sleep 6
ev "(() => { const t = document.body.innerText; return JSON.stringify({ hasInspectionHistorySection: t.includes('Inspection History'), hasNewInspectionBtn: t.includes('New Inspection'), hasPrototypeNote: t.toLowerCase().includes('prototype note') }); })()"
shot "09-equipment-detail-clean.png"

step "12) TYPE SELECTOR: 4 clean cards (Phase 9 final state)"
$S find role button click --name "Pipeline Reports" >> "$LOG" 2>&1
sleep 4
$S find role button click --name "New Pipeline Report" >> "$LOG" 2>&1
sleep 4
ev "(() => { const t = document.body.innerText; return JSON.stringify({ types: ['Penetrant Testing','Particle Testing','Weld Scan','Thickness Measurement'].map(x => t.includes(x)), noUltrasonic: !/ultrasonic test report/i.test(t), noUltrasonicWord: !/ultrasonic/i.test(t) }); })()"
shot "10-type-selector-4-cards.png"

step "13) NO DEMO RECORDS ANYWHERE (API + DB)"
APIDEMO=$(curl -s -b "$CK" "http://localhost:3000/api/pipeline-inspections?pageSize=100" | python3 -c "import json,sys; d=json.load(sys.stdin); print(sum(1 for r in d.get('items',[]) if r.get('isDemo')))")
echo "isDemo pipeline reports via API: $APIDEMO" | tee -a "$LOG"
python3 - <<'PYEOF' 2>&1 | tee -a "$LOG"
import sqlite3
con = sqlite3.connect("/home/z/my-project/db/custom.db")
cur = con.cursor()
tables = [r[0] for r in cur.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()]
print("Inspection table exists:", "Inspection" in tables)
print("isDemo pipeline reports in DB:", cur.execute("SELECT COUNT(*) FROM PipelineInspection WHERE isDemo=1").fetchone()[0])
print("total pipeline reports in DB:", cur.execute("SELECT COUNT(*) FROM PipelineInspection").fetchone()[0])
con.close()
PYEOF

$S close >> "$LOG" 2>&1
step "14) FILES (temp)"
ls -la "$OUT"/*.png 2>/dev/null | tee -a "$LOG"
echo "DONE" | tee -a "$LOG"
