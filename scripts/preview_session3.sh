#!/bin/bash
# preview_session3.sh — robust atomic: kill zombies, start fresh server,
# verify HTTP 200 (not just any response), capture login + dashboard.
set -u
cd /home/z/my-project
OUT=/home/z/my-project/download/preview
AB="agent-browser"
LOG="$OUT/session3.log"
: > "$LOG"

step() { echo "=== $1 ===" | tee -a "$LOG"; }

step "1) KILL ALL NEXT PROCESSES"
pkill -f "next dev" 2>/dev/null
pkill -f "next-server" 2>/dev/null
sleep 3
for i in 1 2 3 4 5; do
  ss -tln 2>/dev/null | grep -q ':3000 ' || break
  pkill -9 -f "next-server" 2>/dev/null
  sleep 2
done
ss -tln 2>/dev/null | grep ':3000 ' && { echo "PORT STILL BUSY — ABORT" | tee -a "$LOG"; exit 1; }
echo "PORT 3000 FREE" | tee -a "$LOG"

step "2) START FRESH SERVER"
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

step "3) FRESH BROWSER SESSION → LOGIN PAGE"
$AB --session fresh set viewport 1440 900 >> "$LOG" 2>&1
$AB --session fresh open http://localhost:3000 >> "$LOG" 2>&1
sleep 8
$AB --session fresh screenshot "$OUT/01-login-page.png" >> "$LOG" 2>&1

step "4) SIGN IN → ADMIN DASHBOARD"
$AB --session fresh find label "Email" fill "admin@inspections.demo" >> "$LOG" 2>&1
$AB --session fresh find label "Password" fill "admin123" >> "$LOG" 2>&1
$AB --session fresh find role button click --name "Sign in" >> "$LOG" 2>&1
sleep 14
$AB --session fresh screenshot "$OUT/02-admin-dashboard.png" >> "$LOG" 2>&1
$AB --session fresh close >> "$LOG" 2>&1

step "5) LOGO FORMAT CHECKS (webp / avif / jpeg / png)"
curl -s -c /tmp/cj3 -X POST http://localhost:3000/api/auth -H 'Content-Type: application/json' \
  -d '{"email":"admin@inspections.demo","password":"admin123"}' > /dev/null
for f in "Hindustan Zinc Ltd.webp" "Madras Fertilizers Limited.avif" "KIRAN GLOBAL CHEMS LTD.jpeg" "JK Tyre & Industries Ltd.png"; do
  ENC=$(python3 -c "import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1]))" "$f")
  RESP=$(curl -s -b /tmp/cj3 -o /tmp/t.bin -w "%{http_code}" "http://localhost:3000/api/client-logo/$ENC")
  echo "$f -> HTTP $RESP $(file /tmp/t.bin | cut -d: -f2 | xargs)" | tee -a "$LOG"
done

step "6) DONE"
ls -la "$OUT"/0*.png | tee -a "$LOG"
