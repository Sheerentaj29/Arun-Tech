#!/bin/bash
# ws_surface_verify2.sh — debug/refined run: keyboard-driven Radix select opening.
# Reuses running server if healthy, else starts fresh. Screenshots -> /tmp/ws-verify2.
set -u
OUT=/tmp/ws-verify2
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

step "2) LOGIN + NAVIGATE TO WELD SCAN STEP 2"
$S set viewport 1440 900 >> "$LOG" 2>&1
$S open http://localhost:3000 >> "$LOG" 2>&1
sleep 10
$S find label "Email" fill "admin@inspections.demo" >> "$LOG" 2>&1
$S find label "Password" fill "admin123" >> "$LOG" 2>&1
$S find role button click --name "Sign in" >> "$LOG" 2>&1
sleep 15
$S find role button click --name "Pipeline Reports" >> "$LOG" 2>&1
sleep 3
$S find role button click --name "New Pipeline Report" >> "$LOG" 2>&1
sleep 3
$S find text "Weld Scan" click >> "$LOG" 2>&1
sleep 4
$S fill 'input[placeholder*="UT-COR-ENN"]' "WS-SC-TEST-02" >> "$LOG" 2>&1
$S find role combobox click --name "Select client" >> "$LOG" 2>&1
sleep 2
$S find role option click --name "AcidChem Industries Pvt Ltd (DEMO)" >> "$LOG" 2>&1
sleep 2
$S find role combobox click --name "Select plant" >> "$LOG" 2>&1
sleep 2
$S find role option click --name "Vapi Acid Plant" >> "$LOG" 2>&1
sleep 2
$S find role button click --name "Proceed to Next" >> "$LOG" 2>&1
sleep 8

step "3) SCROLL TO SCANNING DETAILS"
$S eval "(() => { const h = Array.from(document.querySelectorAll('h3,h4,div')).find(e => e.textContent.trim() === 'Scanning Details'); if (h) { h.scrollIntoView({block:'start'}); return 'SCROLLED'; } return 'NOT_FOUND'; })()" | tee -a "$LOG"
sleep 2
shot "01-scanning-details-closed.png"

step "4) SNAPSHOT AROUND SURFACE CONDITION (what agent-browser sees)"
$S snapshot >> "$LOG" 2>&1
echo "--- snapshot lines mentioning Surface Condition ---" | tee -a "$LOG"
rg -n -i "surface condition" "$LOG" | head -10 | tee -a "$LOG"

step "5) KEYBOARD METHOD: focus combobox -> press Enter"
ev "(() => { const all = Array.from(document.querySelectorAll('[role=combobox]')); const cb = all.find(b => b.textContent.trim() === 'Select Surface Condition'); if (!cb) return 'NOT_FOUND'; cb.scrollIntoView({block:'center'}); cb.focus(); return 'FOCUSED:' + document.activeElement.getAttribute('role') + ':' + document.activeElement.textContent.trim(); })()"
sleep 1
$S press Enter >> "$LOG" 2>&1
sleep 2
echo "--- options after Enter ---" | tee -a "$LOG"
ev "Array.from(document.querySelectorAll('[role=option]')).map(o => o.textContent.trim()).join(' | ')"
ev "document.querySelectorAll('[role=option]').length"
shot "02-surface-options-open.png"

step "6) SELECT Clean & Smooth (click option now that list exists)"
$S find role option click --name "Clean & Smooth" >> "$LOG" 2>&1
sleep 2
echo "--- combobox value after selection ---" | tee -a "$LOG"
ev "(() => { const cb = Array.from(document.querySelectorAll('[role=combobox]')).find(b => true); const all = Array.from(document.querySelectorAll('[role=combobox]')).map(b => b.textContent.trim()); return all.filter(t => t === 'Clean & Smooth' || t.toLowerCase().includes('surface')).join(' || '); })()"
shot "03-surface-selected-clean-smooth.png"

step "7) FLAW SIZING TECHNIQUE (keyboard method, independence proof)"
ev "(() => { const tds = Array.from(document.querySelectorAll('td')); const td = tds.find(t => t.textContent.trim() === 'Flaw Sizing Technique'); if (!td) return 'LABEL_NOT_FOUND'; const cb = td.parentElement.querySelector('[role=combobox]'); if (!cb) return 'NO_COMBOBOX'; cb.scrollIntoView({block:'center'}); cb.focus(); return 'FOCUSED:' + document.activeElement.textContent.trim(); })()"
sleep 1
$S press Enter >> "$LOG" 2>&1
sleep 2
shot "04-flaw-sizing-options.png"
echo "--- flaw sizing options ---" | tee -a "$LOG"
ev "Array.from(document.querySelectorAll('[role=option]')).map(o => o.textContent.trim()).join(' | ')"
$S press Escape >> "$LOG" 2>&1

step "8) CLEANUP: DELETE TEST DRAFT"
CK="$OUT/cookies.txt"
curl -s -c "$CK" -X POST http://localhost:3000/api/auth -H 'Content-Type: application/json' \
  -d '{"email":"admin@inspections.demo","password":"admin123"}' > /dev/null
for RN in WS-SC-TEST-01 WS-SC-TEST-02; do
  RID=$(curl -s -b "$CK" "http://localhost:3000/api/pipeline-inspections?pageSize=200" | \
    python3 -c "import json,sys; d=json.load(sys.stdin); m=[r for r in d.get('items',[]) if r.get('reportNumber')=='$RN']; print(m[0]['id'] if m else '')")
  if [ -n "$RID" ]; then
    DEL=$(curl -s -b "$CK" -o /dev/null -w "%{http_code}" -X DELETE "http://localhost:3000/api/pipeline-inspections/$RID")
    echo "DRAFT $RN (id=$RID) DELETE -> HTTP $DEL" | tee -a "$LOG"
  else
    echo "DRAFT $RN: not in DB" | tee -a "$LOG"
  fi
done
LEFT=$(curl -s -b "$CK" "http://localhost:3000/api/pipeline-inspections?pageSize=200" | \
  python3 -c "import json,sys; d=json.load(sys.stdin); print(sum(1 for r in d.get('items',[]) if (r.get('reportNumber') or '').startswith('WS-SC-TEST')))")
echo "REMAINING WS-SC-TEST* records: $LEFT" | tee -a "$LOG"

$S close >> "$LOG" 2>&1
step "9) FILES (temp)"
ls -la "$OUT"/*.png 2>/dev/null | tee -a "$LOG"
echo "DONE" | tee -a "$LOG"
