#!/bin/bash
# revfix_session2.sh — capture below-the-fold Review sections via inner-container scrolling
set -u
cd /home/z/my-project
OUT=/home/z/my-project/download/preview
AB="agent-browser"
LOG="$OUT/revfix2.log"
: > "$LOG"

step() { echo "=== $1 ===" | tee -a "$LOG"; }

# JS helper: scroll the app's main scrollable container to an absolute offset
SCROLL_JS='((y) => { const c=document.querySelector("main"); if(!c) return "no-main"; c.scrollTop=y; return "at "+c.scrollTop+"/"+c.scrollHeight; })'

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

step "A3) LOGIN + CLEANUP DUPLICATE MPT ROWS"
CJ=/tmp/cj_rf2; rm -f $CJ
curl -s -c $CJ -X POST http://localhost:3000/api/auth -H 'Content-Type: application/json' \
  -d '{"email":"admin@inspections.demo","password":"admin123"}' > /dev/null
MID=cmw0bl6if000vn0t1afb16vdj
# delete the two duplicated observation rows added by the second run (newest by createdAt)
DUP=$(curl -s -b $CJ "http://localhost:3000/api/pipeline-inspections/$MID/dpt-observations" | python3 -c "
import sys,json
items=json.load(sys.stdin)['items']
items.sort(key=lambda o:o['createdAt'], reverse=True)
for o in items[:2]: print(o['id'])
")
for OID in $DUP; do
  curl -s -b $CJ -X DELETE "http://localhost:3000/api/pipeline-inspections/$MID/dpt-observations/$OID" > /dev/null
  echo "deleted dup obs $OID" | tee -a "$LOG"
done

step "B1) LOGIN UI + OPEN REV-FIX-001 REVIEW"
$AB --session fresh set viewport 1440 900 >> "$LOG" 2>&1
$AB --session fresh open http://localhost:3000 >> "$LOG" 2>&1
sleep 6
$AB --session fresh find label "Email" fill "admin@inspections.demo" >> "$LOG" 2>&1
$AB --session fresh find label "Password" fill "admin123" >> "$LOG" 2>&1
$AB --session fresh find role button click --name "Sign in" >> "$LOG" 2>&1
sleep 13
$AB --session fresh find text "Pipeline Reports" click >> "$LOG" 2>&1
sleep 4
$AB --session fresh eval "[...document.querySelectorAll('td')].find(e=>e.textContent.trim()==='REV-FIX-001')?.click()" >> "$LOG" 2>&1
sleep 11

step "B2) SECTION CAPTURES (inner-container scroll)"
# 0: cover + primary photo
$AB --session fresh eval "${SCROLL_JS}(0)" >> "$LOG" 2>&1; sleep 2
$AB --session fresh screenshot "$OUT/revfix-20-cover-primary.png" >> "$LOG" 2>&1
# 1: drawings
$AB --session fresh eval "${SCROLL_JS}(700)" >> "$LOG" 2>&1; sleep 2
$AB --session fresh screenshot "$OUT/revfix-21-drawings.png" >> "$LOG" 2>&1
# 2: drawings bottom + start of tables
$AB --session fresh eval "${SCROLL_JS}(1050)" >> "$LOG" 2>&1; sleep 2
$AB --session fresh screenshot "$OUT/revfix-22-table-1.png" >> "$LOG" 2>&1
# 3: second table + photos
$AB --session fresh eval "${SCROLL_JS}(1450)" >> "$LOG" 2>&1; sleep 2
$AB --session fresh screenshot "$OUT/revfix-23-table-2-photos.png" >> "$LOG" 2>&1
# 4: certificates + sign-off
$AB --session fresh eval "${SCROLL_JS}(1900)" >> "$LOG" 2>&1; sleep 2
$AB --session fresh screenshot "$OUT/revfix-24-certs-signoff.png" >> "$LOG" 2>&1
# measure total height for reference
$AB --session fresh eval "${SCROLL_JS}(99999)" >> "$LOG" 2>&1

step "B3) EDIT PAGE — STEP 2 (measurement tables in form)"
$AB --session fresh eval "${SCROLL_JS}(0)" >> "$LOG" 2>&1; sleep 1
$AB --session fresh find role button click --name "Edit" >> "$LOG" 2>&1
sleep 7
$AB --session fresh screenshot "$OUT/revfix-25-edit-step1.png" >> "$LOG" 2>&1
$AB --session fresh find role button click --name "Proceed to Next" >> "$LOG" 2>&1
sleep 6
$AB --session fresh screenshot "$OUT/revfix-26-edit-step2-tables.png" >> "$LOG" 2>&1

step "B4) MPT REVIEW — results table below fold"
$AB --session fresh open http://localhost:3000 >> "$LOG" 2>&1
sleep 5
$AB --session fresh find text "Pipeline Reports" click >> "$LOG" 2>&1
sleep 4
$AB --session fresh eval "[...document.querySelectorAll('td')].find(e=>e.textContent.trim()==='L')?.click()" >> "$LOG" 2>&1
sleep 10
$AB --session fresh eval "${SCROLL_JS}(1900)" >> "$LOG" 2>&1; sleep 2
$AB --session fresh screenshot "$OUT/revfix-27-mpt-results.png" >> "$LOG" 2>&1

step "B5) WS REVIEW — test results below fold"
$AB --session fresh open http://localhost:3000 >> "$LOG" 2>&1
sleep 5
$AB --session fresh find text "Pipeline Reports" click >> "$LOG" 2>&1
sleep 4
$AB --session fresh eval "[...document.querySelectorAll('td')].find(e=>e.textContent.trim()==='123456')?.click()" >> "$LOG" 2>&1
sleep 10
$AB --session fresh eval "${SCROLL_JS}(1800)" >> "$LOG" 2>&1; sleep 2
$AB --session fresh screenshot "$OUT/revfix-28-ws-test-results.png" >> "$LOG" 2>&1
$AB --session fresh close >> "$LOG" 2>&1

step "C) DONE"
ls -la "$OUT"/revfix-2*.png | tee -a "$LOG"
