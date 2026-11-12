#!/bin/bash
# preview_session.sh — ATOMIC run: start server, drive UI via agent-browser,
# save all screenshots to download/preview/. One call = one full session.
set -u
cd /home/z/my-project
OUT=/home/z/my-project/download/preview
mkdir -p "$OUT"
AB="agent-browser"
LOG="$OUT/session.log"
: > "$LOG"

step() { echo "=== $1 ===" | tee -a "$LOG"; }

step "1) START DEV SERVER"
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

step "2) LOGIN PAGE"
$AB set viewport 1440 900 >> "$LOG" 2>&1
$AB open http://localhost:3000 >> "$LOG" 2>&1
sleep 8
$AB screenshot "$OUT/01-login-page.png" >> "$LOG" 2>&1

step "3) SIGN IN (admin@inspections.demo)"
$AB find label "Email" fill "admin@inspections.demo" >> "$LOG" 2>&1
$AB find label "Password" fill "admin123" >> "$LOG" 2>&1
$AB find role button click --name "Sign in" >> "$LOG" 2>&1 || $AB press Enter >> "$LOG" 2>&1
sleep 10
$AB screenshot "$OUT/02-admin-dashboard.png" >> "$LOG" 2>&1

step "4) PIPELINE REPORTS LIST"
$AB find text "Pipeline Reports" click >> "$LOG" 2>&1
sleep 7
$AB screenshot "$OUT/03-pipeline-reports-list.png" >> "$LOG" 2>&1

step "5) OPEN COROMANDEL REPORT DETAIL (header logos)"
$AB find text "COROMANDEL INTERNATIONAL LIMITED" click >> "$LOG" 2>&1
sleep 8
$AB screenshot "$OUT/04-report-detail-coromandel.png" >> "$LOG" 2>&1

step "6) NEW REPORT — TYPE SELECTOR"
$AB find text "Pipeline Reports" click >> "$LOG" 2>&1
sleep 5
$AB find role button click --name "New Pipeline Report" >> "$LOG" 2>&1
sleep 5
$AB screenshot "$OUT/05-report-type-selector.png" >> "$LOG" 2>&1

step "7) REPORT CREATION FORM (client selection + header logos)"
$AB find text "Pipeline Thickness Measurement" click >> "$LOG" 2>&1
sleep 10
$AB screenshot "$OUT/06-report-form-blank.png" >> "$LOG" 2>&1

step "8) OPEN CLIENT DROPDOWN"
$AB find role combobox click >> "$LOG" 2>&1
sleep 3
$AB screenshot "$OUT/07-client-dropdown-open.png" >> "$LOG" 2>&1

step "9) SELECT COROMANDEL → CLIENT LOGO IN HEADER"
$AB find role option click --name "COROMANDEL INTERNATIONAL LIMITED" >> "$LOG" 2>&1
sleep 6
$AB screenshot "$OUT/08-report-form-coromandel-logo.png" >> "$LOG" 2>&1

step "10) API CHECKS (cookie auth)"
curl -s -c /tmp/cj -X POST http://localhost:3000/api/auth \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@inspections.demo","password":"admin123"}' > "$OUT/auth-response.json"
echo "AUTH: $(head -c 200 "$OUT/auth-response.json")" | tee -a "$LOG"
curl -s -b /tmp/cj "http://localhost:3000/api/client-logo/Coromandel%20International%20Limited.png" -o /tmp/clogo.png
echo "CLIENT LOGO API: $(file /tmp/clogo.png | cut -d: -f2)" | tee -a "$LOG"
cp /tmp/clogo.png "$OUT/client-logo-coromandel.png" 2>/dev/null
curl -s -b /tmp/cj "http://localhost:3000/api/settings/service-logo" -o /tmp/slogo.png
echo "SERVICE LOGO API: $(file /tmp/slogo.png | cut -d: -f2)" | tee -a "$LOG"

step "11) PDF REPORT (landscape, Coromandel)"
curl -s -b /tmp/cj "http://localhost:3000/api/pipeline-inspections/cmw1y9mes003xrjizjwn4ji1s/pdf?orientation=landscape" \
  -o "$OUT/report-coromandel-landscape.pdf" --max-time 120
file "$OUT/report-coromandel-landscape.pdf" | tee -a "$LOG"

step "12) DONE"
ls -la "$OUT" | tee -a "$LOG"
