#!/bin/bash
# verify_ut_removal.sh — atomic: restart server, capture type selector (4 options),
# weld scan detail intact, weld scan PDF heading check.
set -u
cd /home/z/my-project
OUT=/home/z/my-project/download/preview
AB="agent-browser"
LOG="$OUT/ut-removal-verify.log"
: > "$LOG"

step() { echo "=== $1 ===" | tee -a "$LOG"; }

step "1) RESTART SERVER CLEAN"
pkill -f "next dev" 2>/dev/null; pkill -f "next-server" 2>/dev/null; sleep 3
for i in 1 2 3 4 5; do ss -tln 2>/dev/null | grep -q ':3000 ' || break; pkill -9 -f "next-server" 2>/dev/null; sleep 2; done
rm -rf .next/dev dev.log
setsid nohup bash -c 'exec npm run dev > /dev/null 2>&1' < /dev/null > /dev/null 2>&1 &
CODE=000
for i in $(seq 1 50); do
  sleep 3
  CODE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/ --max-time 20)
  [ "$CODE" = "200" ] && break
done
echo "SERVER: HTTP $CODE after ~$((i*3))s" | tee -a "$LOG"
[ "$CODE" != "200" ] && { tail -40 dev.log >> "$LOG"; exit 1; }

step "2) LOGIN + OPEN TYPE SELECTOR"
$AB --session utv set viewport 1440 900 >> "$LOG" 2>&1
$AB --session utv open http://localhost:3000 >> "$LOG" 2>&1
sleep 8
$AB --session utv find label "Email" fill "admin@inspections.demo" >> "$LOG" 2>&1
$AB --session utv find label "Password" fill "admin123" >> "$LOG" 2>&1
$AB --session utv find role button click --name "Sign in" >> "$LOG" 2>&1
sleep 12
$AB --session utv find text "Pipeline Reports" click >> "$LOG" 2>&1
sleep 6
$AB --session utv find role button click --name "New Pipeline Report" >> "$LOG" 2>&1
sleep 6
$AB --session utv screenshot "$OUT/10-type-selector-4-options.png" >> "$LOG" 2>&1
# count visible cards
$AB --session utv get count "h3" >> "$LOG" 2>&1 || true
$AB --session utv snapshot -c >> "$LOG" 2>&1 | grep -iE "DPT|MPT|Weld Scan|Thickness|Ultrasonic|UT" | head -12 >> "$LOG"

step "3) OPEN WELD SCAN REPORT #78 (intact check)"
$AB --session utv find text "Pipeline Reports" click >> "$LOG" 2>&1
sleep 5
$AB --session utv find text "JK Tyre & Industries Ltd" click >> "$LOG" 2>&1
sleep 8
$AB --session utv screenshot "$OUT/11-weldscan-detail-intact.png" >> "$LOG" 2>&1
$AB --session utv close >> "$LOG" 2>&1

step "4) WELD SCAN PDF HEADING CHECK"
curl -s -c /tmp/cjut -X POST http://localhost:3000/api/auth -H 'Content-Type: application/json' \
  -d '{"email":"admin@inspections.demo","password":"admin123"}' > /dev/null
RID=cmw1zn9em0021rjmp8kxvr7a1   # weld scan report #78
curl -s -b /tmp/cjut "http://localhost:3000/api/pipeline-inspections/$RID/pdf?orientation=landscape" \
  -o "$OUT/weldscan-after-ut-removal.pdf" --max-time 120
file "$OUT/weldscan-after-ut-removal.pdf" | tee -a "$LOG"
pdftotext "$OUT/weldscan-after-ut-removal.pdf" /tmp/ws.txt 2>/dev/null
echo "PDF contains 'UT Instrument': $(grep -c 'UT Instrument' /tmp/ws.txt || true)" | tee -a "$LOG"
echo "PDF contains 'Instrument Details': $(grep -c 'Instrument Details' /tmp/ws.txt || true)" | tee -a "$LOG"
echo "PDF contains 'ULTRASONIC TEST REPORT': $(grep -c 'ULTRASONIC TEST REPORT' /tmp/ws.txt || true)" | tee -a "$LOG"
echo "PDF contains 'WELD SCAN REPORT': $(grep -c 'WELD SCAN REPORT' /tmp/ws.txt || true)" | tee -a "$LOG"

step "5) THICKNESS REPORT PDF SANITY (other types unaffected)"
RID2=cmw1y9mes003xrjizjwn4ji1s   # thickness report #2 (Coromandel)
curl -s -b /tmp/cjut "http://localhost:3000/api/pipeline-inspections/$RID2/pdf?orientation=landscape" \
  -o "$OUT/thickness-after-ut-removal.pdf" --max-time 120
file "$OUT/thickness-after-ut-removal.pdf" | tee -a "$LOG"

step "6) DONE"
ls -la "$OUT"/10-*.png "$OUT"/11-*.png "$OUT"/*after-ut-removal.pdf 2>/dev/null | tee -a "$LOG"
