#!/bin/bash
# audit_live_tests.sh — read-only live tests: does PUT/DELETE on individual
# measurements route work (folder anomaly), open endpoints, status data.
# Uses bogus ids only — never mutates real rows.
set -u
cd /home/z/my-project
LOG=/home/z/my-project/tool-results/audit_live_tests.log
: > "$LOG"

pkill -f "next dev" 2>/dev/null; pkill -f "next-server" 2>/dev/null; sleep 3
for i in 1 2 3; do ss -tln 2>/dev/null | grep -q ':3000 ' || break; pkill -9 -f "next-server" 2>/dev/null; sleep 2; done
rm -rf .next/dev
setsid nohup bash -c 'exec npm run dev > /dev/null 2>&1' < /dev/null > /dev/null 2>&1 &
CODE=000
for i in $(seq 1 50); do
  sleep 3
  CODE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/ --max-time 20)
  [ "$CODE" = "200" ] && break
done
echo "SERVER: HTTP $CODE" | tee -a "$LOG"

curl -s -c /tmp/ca -X POST http://localhost:3000/api/auth -H 'Content-Type: application/json' \
  -d '{"email":"admin@inspections.demo","password":"admin123"}' > /dev/null
echo "login done" | tee -a "$LOG"

RID=cmw1y9mes003xrjizjwn4ji1s   # real report id (Coromandel #2)
MID=cmq0000000000000000000000   # bogus cuid-shaped id (no such row)

echo "--- GET collection (sanity, should be 200) ---" | tee -a "$LOG"
curl -s -b /tmp/ca -o /tmp/r1 -w "GET  measurements: HTTP %{http_code}\n" "http://localhost:3000/api/pipeline-inspections/$RID/measurements" | tee -a "$LOG"
head -c 120 /tmp/r1; echo | tee -a "$LOG"

echo "--- PUT bogus measurement id (route match test; no data mutated) ---" | tee -a "$LOG"
curl -s -b /tmp/ca -o /tmp/r2 -w "PUT  measurements/{bogus}: HTTP %{http_code}\n" -X PUT -H 'Content-Type: application/json' -d '{}' "http://localhost:3000/api/pipeline-inspections/$RID/measurements/$MID" | tee -a "$LOG"
head -c 200 /tmp/r2; echo | tee -a "$LOG"

echo "--- DELETE bogus measurement id (route match test; no data mutated) ---" | tee -a "$LOG"
curl -s -b /tmp/ca -o /tmp/r3 -w "DEL  measurements/{bogus}: HTTP %{http_code}\n" -X DELETE "http://localhost:3000/api/pipeline-inspections/$RID/measurements/$MID" | tee -a "$LOG"
head -c 200 /tmp/r3; echo | tee -a "$LOG"

echo "--- open endpoints (no cookie) ---" | tee -a "$LOG"
curl -s -o /tmp/r4 -w "GET  /api/equipment/catalog (no auth): HTTP %{http_code}\n" http://localhost:3000/api/equipment/catalog | tee -a "$LOG"
head -c 100 /tmp/r4; echo | tee -a "$LOG"
curl -s -o /tmp/r5 -w "GET  /api/import-export/template (no auth): HTTP %{http_code}\n" http://localhost:3000/api/import-export/template | tee -a "$LOG"
head -c 100 /tmp/r5; echo | tee -a "$LOG"
curl -s -o /tmp/r6 -w "GET  /api/client-logo/Aarti%20Industries%20Ltd.png (no auth): HTTP %{http_code}\n" "http://localhost:3000/api/client-logo/Aarti%20Industries%20Ltd.png" | tee -a "$LOG"
