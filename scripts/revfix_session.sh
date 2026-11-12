#!/bin/bash
# revfix_session.sh — atomic: fresh server → create verified test data via API
# → browser screenshots of the fixed Review page → download final PDF.
set -u
cd /home/z/my-project
OUT=/home/z/my-project/download/preview
AB="agent-browser"
LOG="$OUT/revfix.log"
: > "$LOG"
mkdir -p "$OUT"

step() { echo "=== $1 ===" | tee -a "$LOG"; }

# ─────────────────────────────────────────────────────────────
step "A1) KILL STALE SERVERS"
pkill -f "next dev" 2>/dev/null; pkill -f "next-server" 2>/dev/null; pkill -f "bun run dev" 2>/dev/null
sleep 3
for i in 1 2 3 4 5; do
  ss -tln 2>/dev/null | grep -q ':3000 ' || break
  pkill -9 -f "next-server" 2>/dev/null
  sleep 2
done
ss -tln 2>/dev/null | grep ':3000 ' && { echo "PORT BUSY — ABORT" | tee -a "$LOG"; exit 1; }
echo "PORT 3000 FREE" | tee -a "$LOG"

step "A2) START FRESH SERVER"
rm -rf .next/dev dev.log
setsid nohup bash -c 'exec npm run dev > /dev/null 2>&1' < /dev/null > /dev/null 2>&1 &
CODE=000
for i in $(seq 1 55); do
  sleep 3
  CODE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/ --max-time 20)
  [ "$CODE" = "200" ] && break
done
echo "SERVER: HTTP $CODE after ~$((i*3))s" | tee -a "$LOG"
[ "$CODE" != "200" ] && { tail -40 dev.log >> "$LOG"; exit 1; }

# ─────────────────────────────────────────────────────────────
step "B1) LOGIN VIA API"
CJ=/tmp/cj_revfix; rm -f $CJ
LR=$(curl -s -c $CJ -X POST http://localhost:3000/api/auth -H 'Content-Type: application/json' \
  -d '{"email":"admin@inspections.demo","password":"admin123"}')
echo "$LR" | head -c 200 | tee -a "$LOG"; echo | tee -a "$LOG"
echo "$LR" | grep -q '"id"' || { echo "LOGIN FAILED" | tee -a "$LOG"; exit 1; }

step "B2) CREATE TEST THICKNESS REPORT (REV-FIX-001)"
TODAY=$(date +%F)
# Remove any previous run of this test report (cleanup for idempotency)
OLD=$(curl -s -b $CJ "http://localhost:3000/api/pipeline-inspections?q=REV-FIX-001&pageSize=5")
OLDID=$(echo "$OLD" | python3 -c "
import sys,json
try:
    d=json.load(sys.stdin)
    for it in d.get('items',[]):
        if it['reportNumber']=='REV-FIX-001': print(it['id']); break
except Exception: pass
")
if [ -n "${OLDID:-}" ]; then
  echo "Deleting stale test report $OLDID" | tee -a "$LOG"
  curl -s -b $CJ -X DELETE "http://localhost:3000/api/pipeline-inspections/$OLDID" > /dev/null
fi
CREATE=$(curl -s -b $CJ -X POST http://localhost:3000/api/pipeline-inspections -H 'Content-Type: application/json' -d '{
  "reportNumber": "REV-FIX-001",
  "reportType": "PIPELINE_THICKNESS",
  "clientId": "cmvp0fvl0002esx108cjfgvpp",
  "plantId": "cmvp0fvl2002gsx10j5rdp6t3",
  "inspectionArea": "Unit-100 Pipe Rack",
  "pipelineDescription": "4in CS Cooling Water Line",
  "pipelineIdentificationNumber": "4-CS-CW-0012",
  "isometricDrawingNumber": "ISO-A-101",
  "materialOfConstruction": "Carbon Steel ASTM A106 Gr.B",
  "applicableStandard": "ASME B36.10M",
  "standardEdition": "2018",
  "inspectionDate": "'"$TODAY"'",
  "fromDate": "'"$TODAY"'",
  "toDate": "'"$TODAY"'",
  "customColumns": "[{\"id\":\"col_temp\",\"name\":\"Surface Temp\",\"unit\":\"degC\"}]",
  "thicknessTablesConfig": "[{\"id\":\"default\",\"label\":\"Line 4-CS-CW-0012 - Straight Runs\",\"sortOrder\":0},{\"id\":\"t_fittings\",\"label\":\"Line 4-CS-CW-0012 - Elbows and Tees\",\"sortOrder\":1}]"
}')
RID=$(echo "$CREATE" | python3 -c "import sys,json; print(json.load(sys.stdin).get('id',''))" 2>/dev/null)
if [ -z "$RID" ]; then echo "CREATE FAILED: $CREATE" | tee -a "$LOG"; exit 1; fi
echo "REPORT ID: $RID" | tee -a "$LOG"

step "B3) ADD 3 MEASUREMENT ROWS (2 tables + custom column value)"
curl -s -b $CJ -X POST "http://localhost:3000/api/pipeline-inspections/$RID/measurements" -H 'Content-Type: application/json' -d '{
  "pointNo":"P-1","tableGroup":"default","pipeSizeInch":"4","pipeSchedule":"SCH 40",
  "componentTypeCode":"PIPE","northMm":"5.82","northStatus":"Measured","eastMm":"5.91","eastStatus":"Measured",
  "southMm":"5.74","southStatus":"Measured","westMm":"5.88","westStatus":"Measured",
  "findingsComments":"Uniform wall loss, acceptable.","customColumnValues":"{\"col_temp\":\"31.5\"}"
}' | head -c 120 | tee -a "$LOG"; echo | tee -a "$LOG"
curl -s -b $CJ -X POST "http://localhost:3000/api/pipeline-inspections/$RID/measurements" -H 'Content-Type: application/json' -d '{
  "pointNo":"P-2","tableGroup":"default","pipeSizeInch":"4","pipeSchedule":"SCH 40",
  "componentTypeCode":"PIPE","northMm":"5.95","northStatus":"Measured","eastMm":"6.01","eastStatus":"Measured",
  "southMm":"5.83","southStatus":"Measured","westStatus":"NotApplicable",
  "findingsComments":"West side not accessible (insulation).","customColumnValues":"{\"col_temp\":\"30.9\"}"
}' | head -c 120 | tee -a "$LOG"; echo | tee -a "$LOG"
curl -s -b $CJ -X POST "http://localhost:3000/api/pipeline-inspections/$RID/measurements" -H 'Content-Type: application/json' -d '{
  "pointNo":"E-1","tableGroup":"t_fittings","pipeSizeInch":"2","pipeSchedule":"SCH 40",
  "componentTypeCode":"ELBOW","northMm":"3.71","northStatus":"Measured","eastMm":"3.65","eastStatus":"Measured",
  "southMm":"3.78","southStatus":"Measured","westMm":"3.69","westStatus":"Measured",
  "findingsComments":"Erosion at elbow intrados — monitor.","customColumnValues":"{\"col_temp\":\"33.2\"}"
}' | head -c 120 | tee -a "$LOG"; echo | tee -a "$LOG"

step "B4) ATTACH DRAWINGS (PNG + PDF + WEBP)"
curl -s -b $CJ -X POST "http://localhost:3000/api/pipeline-inspections/$RID/drawings" \
  -F "file=@/tmp/revfix-assets/drawing-iso-a101.png" | head -c 200 | tee -a "$LOG"; echo | tee -a "$LOG"
curl -s -b $CJ -X POST "http://localhost:3000/api/pipeline-inspections/$RID/drawings" \
  -F "file=@/tmp/revfix-assets/drawing-ga-205.pdf" | head -c 200 | tee -a "$LOG"; echo | tee -a "$LOG"
curl -s -b $CJ -X POST "http://localhost:3000/api/pipeline-inspections/$RID/drawings" \
  -F "file=@/tmp/revfix-assets/drawing-pid-77.webp" | head -c 200 | tee -a "$LOG"; echo | tee -a "$LOG"

step "B5) PRIMARY PHOTO + 2 INSPECTION PHOTOS"
curl -s -b $CJ -X POST "http://localhost:3000/api/pipeline-inspections/$RID/primary-photo" \
  -F "file=@/tmp/revfix-assets/primary-photo.png" | head -c 120 | tee -a "$LOG"; echo | tee -a "$LOG"
curl -s -b $CJ -X POST "http://localhost:3000/api/pipeline-inspections/$RID/photos" \
  -F "file=@/tmp/revfix-assets/inspection-photo-1.png" -F "caption=Corrosion at elbow E-3" | head -c 120 | tee -a "$LOG"; echo | tee -a "$LOG"
curl -s -b $CJ -X POST "http://localhost:3000/api/pipeline-inspections/$RID/photos" \
  -F "file=@/tmp/revfix-assets/inspection-photo-2.png" -F "caption=Support H-7 coating peeling" | head -c 120 | tee -a "$LOG"; echo | tee -a "$LOG"

step "B6) ADD MPT OBSERVATION ROWS to MPT report L (id cmw0bl6if000vn0t1afb16vdj)"
MID=cmw0bl6if000vn0t1afb16vdj
curl -s -b $CJ -X PUT "http://localhost:3000/api/pipeline-inspections/$MID" -H 'Content-Type: application/json' -d '{
  "mptCustomColumns":"[{\"id\":\"mptcol_d\",\"name\":\"Yoke Gap\",\"unit\":\"mm\"}]",
  "mptTestingStandard":"ASTM E709-15","mptAcceptanceCriteria":"No relevant indication",
  "mptSurfacePreparation":"Wire brush - Sa 2.5","mptSurfaceTemperature":"32 degC",
  "mptInstrumentSerialNo":"Y-8 AC Yoke / SN 4421","mptMethod":"AC Electromagnetic Yoke",
  "mptTypeOfCurrent":"AC","mptAcYokeLiftingCapacity":"4.5 kg","mptContrastMedium":"White contrast spray",
  "mptMagneticMedium":"Wet fluorescent iron ink","mptWhiteContrast":"WC-7 (batch 2231)",
  "mptWetParticleIronInk":"WPI-14 (batch 8890)","mptPostCleaning":"Solvent wipe"
}' | head -c 100 | tee -a "$LOG"; echo | tee -a "$LOG"
curl -s -b $CJ -X POST "http://localhost:3000/api/pipeline-inspections/$MID/dpt-observations" -H 'Content-Type: application/json' -d '{
  "description":"Weld W-12 toe crack","weldType":"Butt Weld","indicationSize":"2.4",
  "result":"Reject","remarks":"Linear indication - grind and re-test",
  "customColumnValues":"{\"mptcol_d\":\"100\"}"
}' | head -c 100 | tee -a "$LOG"; echo | tee -a "$LOG"
curl -s -b $CJ -X POST "http://localhost:3000/api/pipeline-inspections/$MID/dpt-observations" -H 'Content-Type: application/json' -d '{
  "description":"Nozzle N-3 fillet","weldType":"Fillet Weld","indicationSize":"—",
  "result":"Accept","remarks":"No relevant indications",
  "customColumnValues":"{\"mptcol_d\":\"—\"}"
}' | head -c 100 | tee -a "$LOG"; echo | tee -a "$LOG"

step "B7) VERIFY GET PAYLOAD (server returns all data)"
curl -s -b $CJ "http://localhost:3000/api/pipeline-inspections/$RID" > /tmp/revfix-report.json
python3 - <<PYEOF | tee -a "$LOG"
import json
r = json.load(open("/tmp/revfix-report.json"))
print("reportNumber:", r["reportNumber"], "| type:", r["reportType"], "| status:", r["status"])
print("measurements:", len(r["measurements"]), "| groups:", sorted({m.get("tableGroup","default") for m in r["measurements"]}))
print("thicknessTablesConfig:", r.get("thicknessTablesConfig"))
print("drawingLinks:", len(r.get("drawingLinks") or []), [(l["drawing"]["title"], l["drawing"]["revisions"][0]["fileExtension"]) for l in (r.get("drawingLinks") or [])])
print("reportPhotos:", [(p["fileName"], p["category"]) for p in (r.get("reportPhotos") or [])])
print("primaryPhotoPath:", bool(r.get("primaryPhotoPath")))
PYEOF

curl -s -b $CJ "http://localhost:3000/api/pipeline-inspections/$MID" > /tmp/revfix-mpt.json
python3 - <<PYEOF | tee -a "$LOG"
import json
r = json.load(open("/tmp/revfix-mpt.json"))
print("MPT obs:", len(r.get("dptObservations") or []), [(o["serialNo"], o["indicationSize"], o["result"]) for o in (r.get("dptObservations") or [])])
print("mptCustomColumns:", r.get("mptCustomColumns"))
PYEOF

# preview API checks
step "B8) DRAWING PREVIEW API CHECKS (png / pdf-raster / webp)"
for EXT in png pdf webp; do
  DID=$(python3 -c "
import json
r=json.load(open('/tmp/revfix-report.json'))
for l in r['drawingLinks']:
    if l['drawing']['revisions'][0]['fileExtension']=='.$EXT':
        print(l['drawing']['id']); break
")
  H=$(curl -s -b $CJ -o /tmp/prev_$EXT.bin -w "%{http_code} %{content_type} %{size_download}" "http://localhost:3000/api/drawings/$DID/preview")
  echo "$EXT preview -> $H $(file /tmp/prev_$EXT.bin | cut -d: -f2 | xargs | head -c 60)" | tee -a "$LOG"
done

# ─────────────────────────────────────────────────────────────
step "C1) BROWSER: LOGIN PAGE"
$AB --session fresh set viewport 1440 900 >> "$LOG" 2>&1
$AB --session fresh open http://localhost:3000 >> "$LOG" 2>&1
sleep 7
$AB --session fresh screenshot "$OUT/revfix-01-login.png" >> "$LOG" 2>&1

step "C2) SIGN IN"
$AB --session fresh find label "Email" fill "admin@inspections.demo" >> "$LOG" 2>&1
$AB --session fresh find label "Password" fill "admin123" >> "$LOG" 2>&1
$AB --session fresh find role button click --name "Sign in" >> "$LOG" 2>&1
sleep 14

step "C3) OPEN PIPELINE REPORTS LIST"
$AB --session fresh find text "Pipeline Reports" click >> "$LOG" 2>&1 || \
  $AB --session fresh eval "[...document.querySelectorAll('button,a,[role=button],span,div')].filter(e=>e.childElementCount===0&&e.textContent.trim()==='Pipeline Reports')[0]?.click()" >> "$LOG" 2>&1
sleep 4
$AB --session fresh screenshot "$OUT/revfix-02-reports-list.png" >> "$LOG" 2>&1

step "C4) OPEN REV-FIX-001 REVIEW PAGE"
$AB --session fresh find text "REV-FIX-001" click >> "$LOG" 2>&1 || \
  $AB --session fresh eval "[...document.querySelectorAll('td')].find(e=>e.textContent.trim()==='REV-FIX-001')?.click()" >> "$LOG" 2>&1 >> "$LOG" 2>&1
sleep 11
$AB --session fresh screenshot "$OUT/revfix-03-review-top.png" >> "$LOG" 2>&1

step "C5) FULL-PAGE SCREENSHOT OF REVIEW"
$AB --session fresh screenshot --full "$OUT/revfix-04-review-full.png" >> "$LOG" 2>&1

step "C6) SCROLL CAPTURES (drawings / tables / photos)"
$AB --session fresh scroll down 1400 >> "$LOG" 2>&1; sleep 3
$AB --session fresh screenshot "$OUT/revfix-05-review-mid1.png" >> "$LOG" 2>&1
$AB --session fresh scroll down 1400 >> "$LOG" 2>&1; sleep 3
$AB --session fresh screenshot "$OUT/revfix-06-review-mid2.png" >> "$LOG" 2>&1
$AB --session fresh scroll down 1400 >> "$LOG" 2>&1; sleep 3
$AB --session fresh screenshot "$OUT/revfix-07-review-mid3.png" >> "$LOG" 2>&1

step "C7) EDIT PAGE (STEP 1) — same data visible"
$AB --session fresh scroll up 9000 >> "$LOG" 2>&1; sleep 1
$AB --session fresh find role button click --name "Edit" >> "$LOG" 2>&1 || \
  $AB --session fresh eval "Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim().startsWith('Edit'))?.click()" >> "$LOG" 2>&1
sleep 7
$AB --session fresh screenshot "$OUT/revfix-08-edit-step1.png" >> "$LOG" 2>&1

step "C8) MPT REPORT REVIEW (report L)"
$AB --session fresh open http://localhost:3000 >> "$LOG" 2>&1
sleep 5
$AB --session fresh find text "Pipeline Reports" click >> "$LOG" 2>&1 || \
  $AB --session fresh eval "[...document.querySelectorAll('button,a,[role=button],span,div')].filter(e=>e.childElementCount===0&&e.textContent.trim()==='Pipeline Reports')[0]?.click()" >> "$LOG" 2>&1
sleep 4
$AB --session fresh eval "(() => { const c=[...document.querySelectorAll('td')].find(e=>e.textContent.trim()==='L'); c?.click(); return c?'clicked L':'not-found L'; })()" >> "$LOG" 2>&1
sleep 9
$AB --session fresh screenshot --full "$OUT/revfix-09-mpt-review.png" >> "$LOG" 2>&1

step "C9) WELD SCAN REPORT REVIEW (report 123456)"
$AB --session fresh open http://localhost:3000 >> "$LOG" 2>&1
sleep 5
$AB --session fresh find text "Pipeline Reports" click >> "$LOG" 2>&1 || \
  $AB --session fresh eval "[...document.querySelectorAll('button,a,[role=button],span,div')].filter(e=>e.childElementCount===0&&e.textContent.trim()==='Pipeline Reports')[0]?.click()" >> "$LOG" 2>&1
sleep 4
$AB --session fresh eval "(() => { const c=[...document.querySelectorAll('td')].find(e=>e.textContent.trim()==='123456'); c?.click(); return c?'clicked 123456':'not-found 123456'; })()" >> "$LOG" 2>&1
sleep 9
$AB --session fresh screenshot --full "$OUT/revfix-10-ws-review.png" >> "$LOG" 2>&1

step "C10) DPT REPORT REVIEW (report 123)"
$AB --session fresh open http://localhost:3000 >> "$LOG" 2>&1
sleep 5
$AB --session fresh find text "Pipeline Reports" click >> "$LOG" 2>&1 || \
  $AB --session fresh eval "[...document.querySelectorAll('button,a,[role=button],span,div')].filter(e=>e.childElementCount===0&&e.textContent.trim()==='Pipeline Reports')[0]?.click()" >> "$LOG" 2>&1
sleep 4
$AB --session fresh find placeholder fill "Report #, pipeline, isometric..." "123" >> "$LOG" 2>&1
sleep 3
$AB --session fresh eval "
(() => {
  const cell = Array.from(document.querySelectorAll('td')).find(e => e.textContent.trim() === '123');
  cell?.click();
  return cell ? 'clicked' : 'not-found';
})()" >> "$LOG" 2>&1
sleep 9
$AB --session fresh screenshot --full "$OUT/revfix-11-dpt-review.png" >> "$LOG" 2>&1

step "C11) VISUAL REPORT REVIEW (E2E-VISUAL-001)"
$AB --session fresh open http://localhost:3000 >> "$LOG" 2>&1
sleep 5
$AB --session fresh find text "Pipeline Reports" click >> "$LOG" 2>&1 || \
  $AB --session fresh eval "[...document.querySelectorAll('button,a,[role=button],span,div')].filter(e=>e.childElementCount===0&&e.textContent.trim()==='Pipeline Reports')[0]?.click()" >> "$LOG" 2>&1
sleep 4
$AB --session fresh find placeholder fill "Report #, pipeline, isometric..." "E2E-VISUAL-001" >> "$LOG" 2>&1
sleep 3
$AB --session fresh eval "
(() => {
  const cell = Array.from(document.querySelectorAll('td')).find(e => e.textContent.trim() === 'E2E-VISUAL-001');
  cell?.click();
  return cell ? 'clicked' : 'not-found';
})()" >> "$LOG" 2>&1
sleep 9
$AB --session fresh screenshot --full "$OUT/revfix-12-visual-review.png" >> "$LOG" 2>&1
$AB --session fresh close >> "$LOG" 2>&1

# ─────────────────────────────────────────────────────────────
step "D1) DOWNLOAD FINAL PDF (landscape)"
curl -s -b $CJ -o "$OUT/revfix-report-landscape.pdf" \
  "http://localhost:3000/api/pipeline-inspections/$RID/pdf?orientation=landscape"
echo "PDF: $(file "$OUT/revfix-report-landscape.pdf" | cut -d: -f2 | xargs)" | tee -a "$LOG"
pdfinfo "$OUT/revfix-report-landscape.pdf" 2>/dev/null | grep Pages | tee -a "$LOG"
rm -rf /tmp/revfix-pdfpages && mkdir -p /tmp/revfix-pdfpages
pdftoppm -r 55 -jpeg -jpegopt quality=60 "$OUT/revfix-report-landscape.pdf" /tmp/revfix-pdfpages/pg 2>/dev/null
ls /tmp/revfix-pdfpages/ | tee -a "$LOG"

step "D2) DONE"
ls -la "$OUT"/revfix-* | tee -a "$LOG"
echo "RID=$RID" | tee -a "$LOG"
