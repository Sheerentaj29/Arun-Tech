#!/bin/bash
# ws_surface_verify.sh — Stage 8a verification (atomic single run):
# start server -> login -> create Weld Scan draft -> Step 2 -> Scanning Details
# -> capture Surface Condition dropdown proof screenshots -> verify EXACTLY 3
# options -> prove Flaw Sizing Technique independence -> delete test draft.
#
# SCREENSHOT HYGIENE: all screenshots/logs live in /tmp/ws-verify (OUTSIDE the
# project tree). Nothing is written to download/, storage/, db/ or the repo.
set -u
OUT=/tmp/ws-verify
LOG="$OUT/verify.log"
rm -rf "$OUT" && mkdir -p "$OUT"
cd /home/z/my-project
AB="agent-browser"
S="$AB --session fresh"

step() { echo "=== $1 ===" | tee -a "$LOG"; }
shot() { $S screenshot "$OUT/$1" >> "$LOG" 2>&1 && echo "shot: $1" | tee -a "$LOG"; }
ev()   { echo "EVAL> $1" | tee -a "$LOG"; $S eval "$1" 2>&1 | tee -a "$LOG"; }

step "1) KILL ZOMBIE SERVERS, FREE PORT 3000"
pkill -f "next dev" 2>/dev/null; pkill -f "next-server" 2>/dev/null; sleep 3
for i in 1 2 3 4 5; do
  ss -tln 2>/dev/null | grep -q ':3000 ' || break
  pkill -9 -f "next-server" 2>/dev/null; sleep 2
done
if ss -tln 2>/dev/null | grep -q ':3000 '; then echo "PORT STILL BUSY — ABORT" | tee -a "$LOG"; exit 1; fi
echo "PORT 3000 FREE" | tee -a "$LOG"

step "2) START FRESH DEV SERVER"
rm -rf .next/dev dev.log
setsid nohup bash -c 'exec npm run dev > /dev/null 2>&1' < /dev/null > /dev/null 2>&1 &
CODE=000
for i in $(seq 1 55); do
  sleep 3
  CODE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/ --max-time 20)
  [ "$CODE" = "200" ] && break
done
echo "SERVER: HTTP $CODE after ~$((i*3))s" | tee -a "$LOG"
[ "$CODE" != "200" ] && { echo "SERVER FAILED" | tee -a "$LOG"; exit 1; }

step "3) LOGIN"
$S set viewport 1440 900 >> "$LOG" 2>&1
$S open http://localhost:3000 >> "$LOG" 2>&1
sleep 10
$S find label "Email" fill "admin@inspections.demo" >> "$LOG" 2>&1
$S find label "Password" fill "admin123" >> "$LOG" 2>&1
$S find role button click --name "Sign in" >> "$LOG" 2>&1
sleep 15

step "4) NAVIGATE: Pipeline Reports -> New Pipeline Report -> Weld Scan"
$S find role button click --name "Pipeline Reports" >> "$LOG" 2>&1
sleep 3
$S find role button click --name "New Pipeline Report" >> "$LOG" 2>&1
sleep 3
$S find text "Weld Scan" click >> "$LOG" 2>&1
sleep 4
shot "03-weldscan-step1.png"

step "5) FILL STEP 1 (Report Number / Client / Plant)"
$S fill 'input[placeholder*="UT-COR-ENN"]' "WS-SC-TEST-01" >> "$LOG" 2>&1
$S find role combobox click --name "Select client" >> "$LOG" 2>&1
sleep 2
$S find role option click --name "AcidChem Industries Pvt Ltd (DEMO)" >> "$LOG" 2>&1
sleep 2
$S find role combobox click --name "Select plant" >> "$LOG" 2>&1
sleep 2
$S find role option click --name "Vapi Acid Plant" >> "$LOG" 2>&1
sleep 2
shot "03b-step1-filled.png"

step "6) PROCEED TO STEP 2 (Weld Scan form)"
$S find role button click --name "Proceed to Next" >> "$LOG" 2>&1
sleep 8

step "7) SCROLL TO SCANNING DETAILS, VERIFY PLACEHOLDER"
$S eval "(() => { const h = Array.from(document.querySelectorAll('h3,h4,div')).find(e => e.textContent.trim() === 'Scanning Details'); if (h) { h.scrollIntoView({block:'start'}); return 'SCROLLED'; } return 'NOT_FOUND'; })()" | tee -a "$LOG"
sleep 2
shot "04-scanning-details-closed.png"
ev "Array.from(document.querySelectorAll('[role=combobox]')).map(b => b.textContent.trim()).filter(t => t.toLowerCase().includes('surface')).join(' || ')"

step "8) OPEN SURFACE CONDITION DROPDOWN -> CAPTURE EXACT OPTIONS"
$S find role combobox click --name "Select Surface Condition" >> "$LOG" 2>&1
sleep 2
shot "05-surface-condition-options.png"
echo "--- HARD CHECK: rendered <option> list ---" | tee -a "$LOG"
ev "Array.from(document.querySelectorAll('[role=option]')).map(o => o.textContent.trim()).join(' | ')"
ev "document.querySelectorAll('[role=option]').length"

step "9) SELECT 'Clean & Smooth' -> CAPTURE SELECTED STATE"
$S find role option click --name "Clean & Smooth" >> "$LOG" 2>&1
sleep 2
shot "06-surface-selected-clean-smooth.png"

step "10) OPEN FLAW SIZING TECHNIQUE DROPDOWN (independence proof)"
$S eval "(() => { const tds = Array.from(document.querySelectorAll('td')); const td = tds.find(t => t.textContent.trim() === 'Flaw Sizing Technique'); if (!td) return 'LABEL_NOT_FOUND'; const cb = td.parentElement.querySelector('[role=combobox]'); if (!cb) return 'NO_COMBOBOX'; cb.scrollIntoView({block:'center'}); ['pointerdown','pointerup'].forEach(t => cb.dispatchEvent(new PointerEvent(t, {bubbles: true}))); return 'OPENED: ' + cb.textContent.trim(); })()" | tee -a "$LOG"
sleep 2
shot "07-flaw-sizing-options.png"
ev "Array.from(document.querySelectorAll('[role=option]')).map(o => o.textContent.trim()).join(' | ')"
$S press Escape >> "$LOG" 2>&1

step "11) CLEANUP: DELETE TEST DRAFT FROM DB (screenshot hygiene)"
CK="$OUT/cookies.txt"
curl -s -c "$CK" -X POST http://localhost:3000/api/auth -H 'Content-Type: application/json' \
  -d '{"email":"admin@inspections.demo","password":"admin123"}' > /dev/null
RID=$(curl -s -b "$CK" "http://localhost:3000/api/pipeline-inspections?pageSize=200" | \
  python3 -c "import json,sys; d=json.load(sys.stdin); m=[r for r in d.get('items',[]) if r.get('reportNumber')=='WS-SC-TEST-01']; print(m[0]['id'] if m else '')")
if [ -n "$RID" ]; then
  DEL=$(curl -s -b "$CK" -o /dev/null -w "%{http_code}" -X DELETE "http://localhost:3000/api/pipeline-inspections/$RID")
  echo "TEST DRAFT WS-SC-TEST-01 (id=$RID) DELETE -> HTTP $DEL" | tee -a "$LOG"
else
  echo "TEST DRAFT NOT FOUND IN DB (nothing to delete)" | tee -a "$LOG"
fi
LEFT=$(curl -s -b "$CK" "http://localhost:3000/api/pipeline-inspections?pageSize=200" | \
  python3 -c "import json,sys; d=json.load(sys.stdin); print(sum(1 for r in d.get('items',[]) if r.get('reportNumber')=='WS-SC-TEST-01'))")
echo "REMAINING WS-SC-TEST-01 records: $LEFT" | tee -a "$LOG"

$S close >> "$LOG" 2>&1
step "12) CAPTURED FILES (temp, in /tmp — deleted after user verification)"
ls -la "$OUT"/*.png 2>/dev/null | tee -a "$LOG"
echo "DONE" | tee -a "$LOG"
