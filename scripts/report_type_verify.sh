#!/bin/bash
# report_type_verify.sh — verify Report Creation page changes (atomic):
#  4 cards only (no Ultrasonic Test Report), no long descriptions,
#  each remaining type opens its correct form. Screenshots -> /tmp (temp only).
set -u
OUT=/tmp/ws-rt-verify
LOG="$OUT/verify.log"
rm -rf "$OUT" && mkdir -p "$OUT"
cd /home/z/my-project
AB="agent-browser"
S="$AB --session fresh"

step() { echo "=== $1 ===" | tee -a "$LOG"; }
shot() { $S screenshot "$OUT/$1" >> "$LOG" 2>&1 && echo "shot: $1" | tee -a "$LOG"; }
ev()   { echo "EVAL> $1" | tee -a "$LOG"; $S eval "$1" 2>&1 | tee -a "$LOG"; }

step "1) RESTART SERVER (pick up code changes)"
pkill -f "next dev" 2>/dev/null; pkill -f "next-server" 2>/dev/null; sleep 3
for i in 1 2 3 4 5; do
  ss -tln 2>/dev/null | grep -q ':3000 ' || break
  pkill -9 -f "next-server" 2>/dev/null; sleep 2
done
rm -rf .next/dev dev.log
setsid nohup bash -c 'exec npm run dev > /dev/null 2>&1' < /dev/null > /dev/null 2>&1 &
CODE=000
for i in $(seq 1 55); do
  sleep 3
  CODE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/ --max-time 20)
  [ "$CODE" = "200" ] && break
done
echo "SERVER: HTTP $CODE" | tee -a "$LOG"
[ "$CODE" != "200" ] && exit 1

step "2) LOGIN"
$S set viewport 1440 900 >> "$LOG" 2>&1
$S open http://localhost:3000 >> "$LOG" 2>&1
sleep 10
$S find label "Email" fill "admin@inspections.demo" >> "$LOG" 2>&1
$S find label "Password" fill "admin123" >> "$LOG" 2>&1
$S find role button click --name "Sign in" >> "$LOG" 2>&1
sleep 15

step "3) OPEN REPORT CREATION PAGE (type selector)"
$S find role button click --name "Pipeline Reports" >> "$LOG" 2>&1
sleep 3
$S find role button click --name "New Pipeline Report" >> "$LOG" 2>&1
sleep 4
shot "01-report-creation-page.png"

step "4) HARD CHECKS: card count, titles, no UT, no long descriptions"
ev "(() => { const cards = Array.from(document.querySelectorAll('.cursor-pointer.border-2')); const titles = cards.map(c => c.querySelector('.font-semibold')?.textContent?.trim()); return 'CARDS=' + cards.length + ' TITLES=' + JSON.stringify(titles); })()"
ev "(() => { const t = document.body.innerText; return 'HAS_ULTRASONIC_TEST_REPORT=' + /Ultrasonic Test Report/i.test(t); })()"
ev "(() => { const t = document.body.innerText; const phrases = ['ferromagnetic', '12/3/6/9', 'UFD details', 'auto-serial numbers, custom columns']; return phrases.map(p => p + '=' + t.includes(p)).join(' | '); })()"

step "5) SELECT EACH TYPE -> VERIFY FORM HEADING"
$S find text "Penetrant Testing" click >> "$LOG" 2>&1
sleep 4
ev "(() => { const h = Array.from(document.querySelectorAll('h1,h2')).map(e => e.textContent.trim()).find(t => t.startsWith('New')); return 'DPT_FORM_HEADING=' + h; })()"
shot "02-form-penetrant-testing.png"
$S find role button click --name "Pipeline Reports" >> "$LOG" 2>&1
sleep 2
$S find role button click --name "New Pipeline Report" >> "$LOG" 2>&1
sleep 3
$S find text "Particle Testing" click >> "$LOG" 2>&1
sleep 4
ev "(() => { const h = Array.from(document.querySelectorAll('h1,h2')).map(e => e.textContent.trim()).find(t => t.startsWith('New')); return 'MPT_FORM_HEADING=' + h; })()"
shot "03-form-particle-testing.png"
$S find role button click --name "Pipeline Reports" >> "$LOG" 2>&1
sleep 2
$S find role button click --name "New Pipeline Report" >> "$LOG" 2>&1
sleep 3
$S find text "Weld Inspection" click >> "$LOG" 2>&1
sleep 4
ev "(() => { const h = Array.from(document.querySelectorAll('h1,h2')).map(e => e.textContent.trim()).find(t => t.startsWith('New')); return 'WELDSCAN_FORM_HEADING=' + h; })()"
shot "04-form-weld-scan.png"
$S find role button click --name "Pipeline Reports" >> "$LOG" 2>&1
sleep 2
$S find role button click --name "New Pipeline Report" >> "$LOG" 2>&1
sleep 3
$S find text "Thickness Measurement" click >> "$LOG" 2>&1
sleep 4
ev "(() => { const h = Array.from(document.querySelectorAll('h1,h2')).map(e => e.textContent.trim()).find(t => t.startsWith('New')); return 'THICKNESS_FORM_HEADING=' + h; })()"
shot "05-form-thickness.png"

step "6) DB HYGIENE CHECK (no reports created during this test)"
CK="$OUT/cookies.txt"
curl -s -c "$CK" -X POST http://localhost:3000/api/auth -H 'Content-Type: application/json' \
  -d '{"email":"admin@inspections.demo","password":"admin123"}' > /dev/null
curl -s -b "$CK" "http://localhost:3000/api/pipeline-inspections?pageSize=200" | \
  python3 -c "import json,sys; d=json.load(sys.stdin); from collections import Counter; print('DB counts by type:', dict(Counter(r['reportType'] for r in d.get('items',[]))))" | tee -a "$LOG"

$S close >> "$LOG" 2>&1
step "7) FILES (temp)"
ls -la "$OUT"/*.png 2>/dev/null | tee -a "$LOG"
echo "DONE" | tee -a "$LOG"
