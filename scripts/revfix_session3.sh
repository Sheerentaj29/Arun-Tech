#!/bin/bash
# revfix_session3.sh — re-add MPT observation rows + capture MPT results section
set -u
cd /home/z/my-project
OUT=/home/z/my-project/download/preview
AB="agent-browser"
LOG="$OUT/revfix3.log"
: > "$LOG"
SCROLL_JS='((y) => { const c=document.querySelector("main"); if(!c) return "no-main"; c.scrollTop=y; return "at "+c.scrollTop+"/"+c.scrollHeight; })'

step() { echo "=== $1 ===" | tee -a "$LOG"; }

step "A1) KILL STALE SERVERS"
pkill -f "next dev" 2>/dev/null; pkill -f "next-server" 2>/dev/null; pkill -f "bun run dev" 2>/dev/null
sleep 3
for i in 1 2 3 4 5; do
  ss -tln 2>/dev/null | grep -q ':3000 ' || break
  pkill -9 -f "next-server" 2>/dev/null; sleep 2
done
ss -tln 2>/dev/null | grep ':3000 ' && { echo "PORT BUSY — ABORT" | tee -a "$LOG"; exit 1; }

step "A2) START FRESH SERVER"
rm -rf .next/dev dev.log
setsid nohup bash -c 'exec npm run dev > /dev/null 2>&1' < /dev/null > /dev/null 2>&1 &
CODE=000
for i in $(seq 1 55); do
  sleep 3
  CODE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/ --max-time 20)
  [ "$CODE" = "200" ] && break
done
echo "SERVER: HTTP $CODE" | tee -a "$LOG"
[ "$CODE" != "200" ] && { tail -40 dev.log >> "$LOG"; exit 1; }

step "A3) RE-ADD 2 MPT OBSERVATION ROWS (report L)"
CJ=/tmp/cj_rf3; rm -f $CJ
curl -s -c $CJ -X POST http://localhost:3000/api/auth -H 'Content-Type: application/json' \
  -d '{"email":"admin@inspections.demo","password":"admin123"}' > /dev/null
MID=cmw0bl6if000vn0t1afb16vdj
curl -s -b $CJ -X POST "http://localhost:3000/api/pipeline-inspections/$MID/dpt-observations" -H 'Content-Type: application/json' -d '{
  "description":"Weld W-12 toe crack","weldType":"Butt Weld","indicationSize":"2.4",
  "result":"Reject","remarks":"Linear indication - grind and re-test",
  "customColumnValues":"{\"mptcol_d\":\"100\"}"
}' | head -c 80 | tee -a "$LOG"; echo | tee -a "$LOG"
curl -s -b $CJ -X POST "http://localhost:3000/api/pipeline-inspections/$MID/dpt-observations" -H 'Content-Type: application/json' -d '{
  "description":"Nozzle N-3 fillet","weldType":"Fillet Weld","indicationSize":"—",
  "result":"Accept","remarks":"No relevant indications",
  "customColumnValues":"{\"mptcol_d\":\"—\"}"
}' | head -c 80 | tee -a "$LOG"; echo | tee -a "$LOG"

step "B1) LOGIN UI → MPT REPORT REVIEW"
$AB --session fresh set viewport 1440 900 >> "$LOG" 2>&1
$AB --session fresh open http://localhost:3000 >> "$LOG" 2>&1
sleep 6
$AB --session fresh find label "Email" fill "admin@inspections.demo" >> "$LOG" 2>&1
$AB --session fresh find label "Password" fill "admin123" >> "$LOG" 2>&1
$AB --session fresh find role button click --name "Sign in" >> "$LOG" 2>&1
sleep 13
$AB --session fresh find text "Pipeline Reports" click >> "$LOG" 2>&1
sleep 4
$AB --session fresh eval "[...document.querySelectorAll('td')].find(e=>e.textContent.trim()==='L')?.click()" >> "$LOG" 2>&1
sleep 10
$AB --session fresh eval "${SCROLL_JS}(1200)" >> "$LOG" 2>&1; sleep 2
$AB --session fresh screenshot "$OUT/revfix-30-mpt-results.png" >> "$LOG" 2>&1
$AB --session fresh close >> "$LOG" 2>&1

step "C) DONE"
ls -la "$OUT"/revfix-30*.png | tee -a "$LOG"
