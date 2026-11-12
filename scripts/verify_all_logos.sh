#!/bin/bash
# verify_all_logos.sh — atomic: restart server, verify ALL 54 mapped logos
# via the client-logo API, screenshot JK Tyre report (ampersand fix proof).
set -u
cd /home/z/my-project
OUT=/home/z/my-project/download/preview
AB="agent-browser"
LOG="$OUT/verify-logos.log"
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

step "2) AUTH"
curl -s -c /tmp/cj4 -X POST http://localhost:3000/api/auth -H 'Content-Type: application/json' \
  -d '{"email":"admin@inspections.demo","password":"admin123"}' > /dev/null

step "3) TEST ALL 54 MAPPED LOGOS VIA API"
python3 - <<'EOF' > /tmp/mapping_pairs.txt
import re
src = open('src/lib/client-logo-mapping.ts').read()
m = re.search(r'const CLIENT_LOGO_MAP[^=]*= \{(.*?)\n\};', src, re.S)
for k, v in re.findall(r'"([^"]+)":\s*"([^"]+)"', m.group(1)):
    print(f"{k}\t{v}")
EOF
PASS=0; FAIL=0
while IFS=$'\t' read -r key fname; do
  ENC=$(python3 -c "import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1]))" "$fname")
  RESP=$(curl -s -b /tmp/cj4 -o /tmp/t.bin -w "%{http_code}" "http://localhost:3000/api/client-logo/$ENC")
  TYPE=$(file -b --mime-type /tmp/t.bin 2>/dev/null)
  if [ "$RESP" = "200" ] && [[ "$TYPE" == image/* || "$TYPE" == "image/svg+xml" ]]; then
    PASS=$((PASS+1)); echo "OK   $RESP $TYPE  $fname" >> "$LOG"
  else
    FAIL=$((FAIL+1)); echo "BAD  $RESP $TYPE  $fname" >> "$LOG"
  fi
done < /tmp/mapping_pairs.txt
echo "RESULT: $PASS/54 PASS, $FAIL FAIL" | tee -a "$LOG"
grep "^BAD" "$LOG" | tee -a "$LOG" || true

step "4) SCREENSHOT JK TYRE REPORT DETAIL (ampersand client logo proof)"
$AB --session fresh2 set viewport 1440 900 >> "$LOG" 2>&1
$AB --session fresh2 open http://localhost:3000 >> "$LOG" 2>&1
sleep 6
$AB --session fresh2 find label "Email" fill "admin@inspections.demo" >> "$LOG" 2>&1
$AB --session fresh2 find label "Password" fill "admin123" >> "$LOG" 2>&1
$AB --session fresh2 find role button click --name "Sign in" >> "$LOG" 2>&1
sleep 12
$AB --session fresh2 find text "Pipeline Reports" click >> "$LOG" 2>&1
sleep 6
$AB --session fresh2 find text "JK Tyre & Industries Ltd" click >> "$LOG" 2>&1
sleep 8
$AB --session fresh2 screenshot "$OUT/09-report-detail-jktyre-amp.png" >> "$LOG" 2>&1
$AB --session fresh2 close >> "$LOG" 2>&1

step "5) DONE"
