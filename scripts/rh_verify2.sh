#!/bin/bash
# rh_verify2.sh — re-run of steps that got stuck in the first pass:
# dashboard, equipment list/detail (no Inspection History), type selector cards.
set -u
OUT=/tmp/rh-verify
LOG="$OUT/verify2.log"
cd /home/z/my-project
AB="agent-browser"
S="$AB --session fresh"

step() { echo "=== $1 ===" | tee -a "$LOG"; }
shot() { $S screenshot "$OUT/$1" >> "$LOG" 2>&1 && echo "shot: $1" | tee -a "$LOG"; }
ev()   { echo "EVAL> $1" | tee -a "$LOG"; $S eval "$1" 2>&1 | tee -a "$LOG"; }

step "1) SERVER"
CODE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/ --max-time 10)
echo "SERVER: HTTP $CODE" | tee -a "$LOG"
[ "$CODE" != "200" ] && exit 1

step "2) LOGIN ADMIN"
$S set viewport 1440 900 >> "$LOG" 2>&1
$S open http://localhost:3000 >> "$LOG" 2>&1
sleep 10
$S find label "Email" fill "admin@inspections.demo" >> "$LOG" 2>&1
$S find label "Password" fill "admin123" >> "$LOG" 2>&1
$S find role button click --name "Sign in" >> "$LOG" 2>&1
sleep 12

step "3) EQUIPMENT MASTER LIST — no Inspections column"
$S find role button click --name "Equipment Master" >> "$LOG" 2>&1
sleep 10
ev "(() => { const ths = Array.from(document.querySelectorAll('thead th')).map(h => h.textContent.trim()); const rows = Array.from(document.querySelectorAll('tbody tr')); return JSON.stringify({ headers: ths, rowCount: rows.length, hasInspectionsCol: ths.includes('Inspections') }); })()"
shot "09-equipment-list-clean.png"

step "4) EQUIPMENT DETAIL — no Inspection History / New Inspection"
ev "(() => { const r = Array.from(document.querySelectorAll('tbody tr'))[0]; if (!r) return 'NO_ROW'; const tag = r.querySelector('td'); if (tag) tag.click(); return 'CLICKED:' + r.textContent.slice(0, 40); })()"
sleep 8
ev "(() => { const t = document.body.innerText; return JSON.stringify({ hasInspectionHistorySection: t.includes('Inspection History'), hasNewInspectionBtn: t.includes('New Inspection'), hasSpecs: t.includes('Registered Specifications') }); })()"
shot "10-equipment-detail-clean.png"

step "5) TYPE SELECTOR — 4 clean cards"
$S find role button click --name "Pipeline Reports" >> "$LOG" 2>&1
sleep 6
$S find role button click --name "New Pipeline Report" >> "$LOG" 2>&1
sleep 6
ev "(() => { const t = document.body.innerText; return JSON.stringify({ types: ['Penetrant Testing','Particle Testing','Weld Scan','Thickness Measurement'].map(x => t.includes(x)), noUltrasonicWord: !/ultrasonic/i.test(t) }); })()"
shot "11-type-selector-4-cards.png"

step "6) DASHBOARD — Reports card"
$S find role button click --name "Admin Dashboard" >> "$LOG" 2>&1
sleep 8
ev "(() => { const t = document.body.innerText; return JSON.stringify({ hasReportsCard: /Reports/.test(t), noInspectionsWord: !/inspections/i.test(t) }); })()"
shot "12-admin-dashboard.png"

$S close >> "$LOG" 2>&1
step "7) FILES"
ls -la "$OUT"/09*.png "$OUT"/10*.png "$OUT"/11*.png "$OUT"/12*.png 2>/dev/null | tee -a "$LOG"
echo "DONE" | tee -a "$LOG"
