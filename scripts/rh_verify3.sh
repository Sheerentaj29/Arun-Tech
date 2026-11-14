#!/bin/bash
# rh_verify3.sh — wide-viewport reshoot of Report History (admin + submitted states)
set -u
OUT=/tmp/rh-verify
LOG="$OUT/verify3.log"
cd /home/z/my-project
AB="agent-browser"
S="$AB --session fresh"
step() { echo "=== $1 ===" | tee -a "$LOG"; }
shot() { $S screenshot "$OUT/$1" >> "$LOG" 2>&1 && echo "shot: $1" | tee -a "$LOG"; }
ev()   { echo "EVAL> $1" | tee -a "$LOG"; $S eval "$1" 2>&1 | tee -a "$LOG"; }

CODE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/ --max-time 10)
[ "$CODE" != "200" ] && { echo "SERVER DOWN"; exit 1; }

$S set viewport 1780 1000 >> "$LOG" 2>&1
$S open http://localhost:3000 >> "$LOG" 2>&1
sleep 10
$S find label "Email" fill "admin@inspections.demo" >> "$LOG" 2>&1
$S find label "Password" fill "admin123" >> "$LOG" 2>&1
$S find role button click --name "Sign in" >> "$LOG" 2>&1
sleep 12
$S find role button click --name "Report History" >> "$LOG" 2>&1
sleep 6
ev "(() => { const rows = Array.from(document.querySelectorAll('tbody tr')); const row = rows.find(r => r.textContent.includes('RH-VERIFY-001')); return JSON.stringify({ rows: rows.length, rhButtons: row ? Array.from(row.querySelectorAll('button')).map(b => b.textContent.trim()) : null }); })()"
shot "13-report-history-admin-wide.png"
echo "DONE" | tee -a "$LOG"
