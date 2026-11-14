#!/bin/bash
# em_remove_verify.sh — Equipment Master removal verification (atomic single run):
# start server -> login admin -> prove sidebar has NO Equipment Master / CSV Import
# -> API health -> report creation flow (Weld Scan draft) -> auto-appears in
# Report History -> View opens report -> PDF generates -> employee sidebar check
# -> cleanup test draft.
#
# SCREENSHOT HYGIENE: all screenshots/logs live in /tmp/em-verify (OUTSIDE the
# project tree). Deleted after user verification.
set -u
OUT=/tmp/em-verify
LOG="$OUT/verify.log"
rm -rf "$OUT" && mkdir -p "$OUT"
cd /home/z/my-project
AB="agent-browser"
S="$AB --session fresh"

step() { echo "=== $1 ===" | tee -a "$LOG"; }
shot() { $S screenshot "$OUT/$1" >> "$LOG" 2>&1 && echo "shot: $1" | tee -a "$LOG"; }
ev()   { echo "EVAL> $1" | tee -a "$LOG"; $S eval "$1" 2>&1 | tee -a "$LOG"; }

step "1) KILL ZOMBIE SERVERS, FREE PORT 3000"
pkill -f "next dev" 2>/dev/null; pkill -f "next-server" 2>/dev/null; pkill -f "standalone/server.js" 2>/dev/null; sleep 3
for i in 1 2 3 4 5; do
  ss -tln 2>/dev/null | grep -q ':3000 ' || break
  pkill -9 -f "next-server" 2>/dev/null; pkill -9 -f "standalone/server.js" 2>/dev/null; sleep 2
done
if ss -tln 2>/dev/null | grep -q ':3000 '; then echo "PORT STILL BUSY — ABORT" | tee -a "$LOG"; exit 1; fi
echo "PORT 3000 FREE" | tee -a "$LOG"

step "2) START PRODUCTION STANDALONE SERVER (fallback: dev)"
set -a; source .env 2>/dev/null; set +a
setsid nohup bash -c 'NODE_ENV=production PORT=3000 exec bun /home/z/my-project/.next/standalone/server.js > /tmp/em-verify/server.log 2>&1' < /dev/null > /dev/null 2>&1 &
MODE=production
CODE=000
for i in $(seq 1 20); do
  sleep 2
  CODE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/ --max-time 15)
  [ "$CODE" = "200" ] && break
done
if [ "$CODE" != "200" ]; then
  echo "STANDALONE FAILED (code=$CODE) — falling back to DEV SERVER" | tee -a "$LOG"
  pkill -f "standalone/server.js" 2>/dev/null; sleep 2
  MODE=dev
  setsid nohup bash -c 'cd /home/z/my-project && exec npm run dev > /tmp/em-verify/dev.log 2>&1' < /dev/null > /dev/null 2>&1 &
  for i in $(seq 1 55); do
    sleep 3
    CODE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/ --max-time 20)
    [ "$CODE" = "200" ] && break
  done
fi
echo "SERVER MODE=$MODE HTTP=$CODE" | tee -a "$LOG"
[ "$CODE" != "200" ] && { echo "SERVER FAILED" | tee -a "$LOG"; exit 1; }

step "3) LOGIN AS ADMIN"
$S set viewport 1440 900 >> "$LOG" 2>&1
$S open http://localhost:3000 >> "$LOG" 2>&1
sleep 12
$S find label "Email" fill "admin@inspections.demo" >> "$LOG" 2>&1
$S find label "Password" fill "admin123" >> "$LOG" 2>&1
$S find role button click --name "Sign in" >> "$LOG" 2>&1
sleep 15

step "4) SIDEBAR PROOF (admin): no Equipment Master, no CSV Import / Export"
shot "01-admin-sidebar.png"
echo "--- NAV ITEMS RENDERED ---" | tee -a "$LOG"
ev "JSON.stringify(Array.from(document.querySelectorAll('nav button span')).map(s => s.textContent.trim()))"
echo "--- HARD CHECKS ---" | tee -a "$LOG"
ev "(() => { const t = Array.from(document.querySelectorAll('nav button span')).map(s => s.textContent.trim()); return JSON.stringify({ hasEquipmentMaster: t.some(x => x === 'Equipment Master'), hasCsvImport: t.some(x => x.includes('CSV Import')), navCount: t.length }); })()"

step "5) API HEALTH: /api/clients (equipment count removed) + /api/admin-summary"
CK="$OUT/cookies.txt"
curl -s -c "$CK" -X POST http://localhost:3000/api/auth -H 'Content-Type: application/json' \
  -d '{"email":"admin@inspections.demo","password":"admin123"}' > /dev/null
curl -s -b "$CK" http://localhost:3000/api/clients --max-time 20 | python3 -c "
import json,sys
d = json.load(sys.stdin)
items = d.get('items', [])
print('CLIENTS OK:', len(items), 'clients; first client keys:', sorted(items[0].keys()) if items else 'none')
print('has _count:', '_count' in (items[0] if items else {}))
" 2>&1 | tee -a "$LOG"
curl -s -b "$CK" -o /dev/null -w "ADMIN-SUMMARY HTTP %{http_code}\n" http://localhost:3000/api/admin-summary --max-time 20 | tee -a "$LOG"
curl -s -b "$CK" -o /dev/null -w "GONE /api/equipment -> HTTP %{http_code} (expect 404)\n" http://localhost:3000/api/equipment --max-time 20 | tee -a "$LOG"
curl -s -b "$CK" -o /dev/null -w "GONE /api/import-export/export -> HTTP %{http_code} (expect 404)\n" http://localhost:3000/api/import-export/export --max-time 20 | tee -a "$LOG"
curl -s -b "$CK" -o /dev/null -w "GONE /api/dashboard -> HTTP %{http_code} (expect 404)\n" http://localhost:3000/api/dashboard --max-time 20 | tee -a "$LOG"

step "6) REPORT CREATION FLOW: type selector -> 4 cards"
$S find role button click --name "Pipeline Reports" >> "$LOG" 2>&1
sleep 4
$S find role button click --name "New Pipeline Report" >> "$LOG" 2>&1
sleep 4
shot "02-type-selector.png"
ev "JSON.stringify(Array.from(document.querySelectorAll('h3, [data-slot=card-title], .text-lg.font-semibold')).map(e => e.textContent.trim()).filter(Boolean).slice(0, 12))"

step "7) OPEN WELD SCAN FORM (Step 1) + FILL"
$S find text "Weld Scan" click >> "$LOG" 2>&1
sleep 5
shot "03-weldscan-step1.png"
$S fill 'input[placeholder*="UT-COR-ENN"]' "WS-EM-TEST-01" >> "$LOG" 2>&1
$S find role combobox click --name "Select client" >> "$LOG" 2>&1
sleep 2
$S find role option click --name "AcidChem Industries Pvt Ltd (DEMO)" >> "$LOG" 2>&1
sleep 2
$S find role combobox click --name "Select plant" >> "$LOG" 2>&1
sleep 2
$S find role option click --name "Vapi Acid Plant" >> "$LOG" 2>&1
sleep 2
shot "03b-step1-filled.png"

step "8) PROCEED TO STEP 2 (form internals render)"
$S find role button click --name "Proceed to Next" >> "$LOG" 2>&1
sleep 8
shot "04-weldscan-step2-renders.png"
ev "(() => { const b = document.body.innerText; return JSON.stringify({ hasScanningDetails: b.includes('Scanning Details'), hasSurfaceCondition: b.toLowerCase().includes('surface condition'), formAlive: b.length > 500 }); })()"

step "9) REPORT HISTORY: draft auto-appears"
$S find role button click --name "Report History" >> "$LOG" 2>&1
sleep 5
shot "05-report-history.png"
ev "(() => { const t = document.body.innerText; return JSON.stringify({ pageIsReportHistory: t.includes('Report History'), testDraftVisible: t.includes('WS-EM-TEST-01'), prototypeNote: t.includes('Prototype') || t.includes('prototype') }); })()"

step "10) VIEW OPENS REPORT DETAIL"
$S find role cell click --name "WS-EM-TEST-01" >> "$LOG" 2>&1
sleep 2
$S keys Escape >> "$LOG" 2>&1
RID=$(curl -s -b "$CK" "http://localhost:3000/api/pipeline-inspections?pageSize=200" | \
  python3 -c "import json,sys; d=json.load(sys.stdin); m=[r for r in d.get('items',[]) if r.get('reportNumber')=='WS-EM-TEST-01']; print(m[0]['id'] if m else '')")
echo "TEST DRAFT RID=$RID" | tee -a "$LOG"
# Click the row's View button directly (row opens detail via View button)
ev "(() => { const rows = Array.from(document.querySelectorAll('tr')); const row = rows.find(r => r.textContent.includes('WS-EM-TEST-01')); if (!row) return 'ROW_NOT_FOUND'; const btn = Array.from(row.querySelectorAll('button')).find(b => b.textContent.trim().toLowerCase().includes('view')); if (!btn) return 'VIEW_BTN_NOT_FOUND'; btn.click(); return 'VIEW_CLICKED'; })()" | tee -a "$LOG"
sleep 5
shot "06-report-detail-opens.png"
ev "(() => { const t = document.body.innerText; return JSON.stringify({ detailOpen: t.includes('WS-EM-TEST-01'), hasStatus: t.includes('Draft') || t.includes('Status') }); })()"

step "11) PDF GENERATION on the new draft (+ fallback: an existing approved report)"
PDFHDR=$(curl -s -b "$CK" -o "$OUT/test-draft.pdf" -w "%{http_code}" "http://localhost:3000/api/pipeline-inspections/$RID/pdf" --max-time 60)
echo "DRAFT PDF HTTP=$PDFHDR" | tee -a "$LOG"
head -c 5 "$OUT/test-draft.pdf" 2>/dev/null | tee -a "$LOG"; echo " <- magic (want %PDF-)" | tee -a "$LOG"
ls -la "$OUT/test-draft.pdf" 2>/dev/null | awk '{print "PDF size:", $5}' | tee -a "$LOG"
if ! head -c 5 "$OUT/test-draft.pdf" 2>/dev/null | grep -q "%PDF-"; then
  echo "Draft PDF failed — trying an existing Approved report" | tee -a "$LOG"
  RID2=$(curl -s -b "$CK" "http://localhost:3000/api/pipeline-inspections?pageSize=200" | \
    python3 -c "import json,sys; d=json.load(sys.stdin); m=[r for r in d.get('items',[]) if r.get('status')=='Approved']; print(m[0]['id'] if m else '')")
  echo "APPROVED RID=$RID2" | tee -a "$LOG"
  curl -s -b "$CK" -o "$OUT/approved.pdf" -w "APPROVED PDF HTTP %{http_code}\n" "http://localhost:3000/api/pipeline-inspections/$RID2/pdf" --max-time 60 | tee -a "$LOG"
  head -c 5 "$OUT/approved.pdf" 2>/dev/null | tee -a "$LOG"; echo " <- magic" | tee -a "$LOG"
fi

step "12) EMPLOYEE SIDEBAR CHECK (sign out -> login inspector)"
$S find role button click --name "Sign out" >> "$LOG" 2>&1
sleep 5
$S find label "Email" fill "inspector@inspections.demo" >> "$LOG" 2>&1
$S find label "Password" fill "inspector123" >> "$LOG" 2>&1
$S find role button click --name "Sign in" >> "$LOG" 2>&1
sleep 12
shot "07-employee-sidebar.png"
ev "(() => { const t = Array.from(document.querySelectorAll('nav button span')).map(s => s.textContent.trim()); return JSON.stringify({ nav: t, hasEquipmentMaster: t.some(x => x === 'Equipment Master'), hasCsvImport: t.some(x => x.includes('CSV Import')) }); })()" | tee -a "$LOG"

step "13) CLEANUP: DELETE TEST DRAFT"
if [ -n "$RID" ]; then
  DEL=$(curl -s -b "$CK" -o /dev/null -w "%{http_code}" -X DELETE "http://localhost:3000/api/pipeline-inspections/$RID")
  echo "TEST DRAFT WS-EM-TEST-01 (id=$RID) DELETE -> HTTP $DEL" | tee -a "$LOG"
else
  echo "TEST DRAFT NOT FOUND (nothing to delete)" | tee -a "$LOG"
fi
LEFT=$(curl -s -b "$CK" "http://localhost:3000/api/pipeline-inspections?pageSize=200" | \
  python3 -c "import json,sys; d=json.load(sys.stdin); print(sum(1 for r in d.get('items',[]) if r.get('reportNumber')=='WS-EM-TEST-01'))")
echo "REMAINING WS-EM-TEST-01 records: $LEFT" | tee -a "$LOG"

$S close >> "$LOG" 2>&1
step "14) CAPTURED FILES (temp, /tmp — deleted after user verification)"
ls -la "$OUT"/*.png 2>/dev/null | tee -a "$LOG"
echo "DONE" | tee -a "$LOG"
