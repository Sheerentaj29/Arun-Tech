#!/bin/bash
# verify_weldscan_surface.sh — atomic: fresh server + UI verification of
# Weld Scan "Surface Condition" dropdown (exactly 3 options) with screenshots.
# Test report WS-TEST-SC-001 is created via UI and DELETED via API at the end.
set -u
cd /home/z/my-project
OUT=/home/z/my-project/download/verify-temp
LOG=/tmp/wsfix.log
AB="agent-browser"
S="wsfix"
CREATED=0
mkdir -p "$OUT"; : > "$LOG"; : > dev.log

say() { echo "=== $1 ===" | tee -a "$LOG"; }
ab()  { $AB --session "$S" "$@" >> "$LOG" 2>&1; }
js()  { $AB --session "$S" eval "$1" 2>>"$LOG"; }

# click_at JS_EXPR  — JS returns "cx,cy" of element center; real mouse click
click_at() {
  local P CX CY
  P=$(js "$1" | tail -1 | tr -d '"')
  CX="${P%,*}"; CY="${P#*,}"
  case "$CX" in ''|*[!0-9]*) echo "NOT_FOUND: $P" | tee -a "$LOG"; return 1 ;; esac
  echo "CLICK @ $CX,$CY" | tee -a "$LOG"
  ab mouse move "$CX" "$CY"; sleep 0.4
  ab mouse down left; ab mouse up left; sleep 0.8
}

cleanup_db() {
  say "9) DELETE test report (DB cleanup)"
  curl -s -c /tmp/wsfix.cookies -X POST http://localhost:3000/api/auth \
    -H 'Content-Type: application/json' \
    -d '{"email":"admin@inspections.demo","password":"admin123"}' >> "$LOG" 2>&1
  local ID
  ID=$(python3 -c "
import sqlite3
c = sqlite3.connect('/home/z/my-project/db/custom.db')
r = c.execute(\"SELECT id FROM PipelineInspection WHERE reportNumber='WS-TEST-SC-001'\").fetchone()
print(r[0] if r else '')")
  if [ -n "$ID" ]; then
    CODE=$(curl -s -b /tmp/wsfix.cookies -o /tmp/wsfix_del.json -w "%{http_code}" \
      -X DELETE "http://localhost:3000/api/pipeline-inspections/$ID")
    echo "DELETE WS-TEST-SC-001 ($ID) -> HTTP $CODE" | tee -a "$LOG"
  fi
  python3 -c "
import sqlite3
c = sqlite3.connect('/home/z/my-project/db/custom.db')
n = c.execute(\"SELECT COUNT(*) FROM PipelineInspection WHERE reportType='PIPELINE_WELD_SCAN'\").fetchone()[0]
t = c.execute(\"SELECT COUNT(*) FROM PipelineInspection WHERE reportNumber='WS-TEST-SC-001'\").fetchone()[0]
print(f'WS reports now: {n}; test report remaining: {t}')"
}

say "1) kill zombies / free port 3000"
pkill -f "next dev" 2>/dev/null; pkill -f "next-server" 2>/dev/null; sleep 3
for i in 1 2 3 4 5; do
  ss -tln 2>/dev/null | grep -q ':3000 ' || break
  pkill -9 -f "next-server" 2>/dev/null; sleep 2
done
ss -tln 2>/dev/null | grep ':3000 ' && { echo "PORT BUSY — ABORT" | tee -a "$LOG"; exit 1; }

say "2) start fresh dev server"
rm -rf .next/dev
setsid nohup bash -c 'exec npm run dev > /home/z/my-project/dev.log 2>&1' < /dev/null > /dev/null 2>&1 &
CODE=000
for i in $(seq 1 60); do
  sleep 3
  CODE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/ --max-time 20)
  [ "$CODE" = "200" ] && break
done
echo "SERVER: HTTP $CODE after ~$((i*3))s" | tee -a "$LOG"
[ "$CODE" != "200" ] && { tail -30 dev.log | tee -a "$LOG"; exit 1; }

say "3) login as admin"
ab set viewport 1440 900
ab open http://localhost:3000
sleep 10
ab find label "Email" fill "admin@inspections.demo"
ab find label "Password" fill "admin123"
ab find role button click --name "Sign in"
sleep 15

say "4) navigate: Pipeline Reports -> New Pipeline Report -> Weld Scan"
ab find text "Pipeline Reports" click
ab wait --text "New Pipeline Report" --timeout 20000 || ab snapshot -i >> "$LOG" 2>&1
ab find role button click --name "New Pipeline Report"
if ! ab wait --text "Select Report Type" --timeout 20000; then
  echo "TYPE SELECTOR DID NOT SHOW Weld Scan" | tee -a "$LOG"
  ab snapshot -i >> "$LOG" 2>&1
  cleanup_db; ab close; exit 1
fi
ab find text "Weld Scan" click
if ! ab wait --text "Report Header" --timeout 20000; then
  echo "FORM STEP-1 DID NOT RENDER" | tee -a "$LOG"
  ab snapshot -i >> "$LOG" 2>&1
  cleanup_db; ab close; exit 1
fi

say "5) fill step-1: report number, client, plant"
R=$(js '(() => { const i=[...document.querySelectorAll("input")].find(x=>(x.placeholder||"").startsWith("e.g. ")); if(!i) return "NO_INPUT"; const s=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,"value").set; s.call(i,"WS-TEST-SC-001"); i.dispatchEvent(new Event("input",{bubbles:true})); return "OK"; })()' | tail -1 | tr -d '"')
echo "reportNumber fill: $R" | tee -a "$LOG"
[ "$R" != "OK" ] && { cleanup_db; ab close; exit 1; }

click_at '(() => { const l=[...document.querySelectorAll("label")].find(x=>x.textContent.trim()==="Client *"); if(!l) return "no"; const b=l.parentElement.querySelector("button[role=combobox]"); if(!b) return "no"; b.scrollIntoView({block:"center"}); const r=b.getBoundingClientRect(); return Math.round(r.x+r.width/2)+","+Math.round(r.y+r.height/2); })()' \
  && click_at '(() => { const o=[...document.querySelectorAll("[role=option]")]; if(!o.length) return "no"; const r=o[0].getBoundingClientRect(); return Math.round(r.x+r.width/2)+","+Math.round(r.y+r.height/2); })()' \
  || { echo "client select failed" | tee -a "$LOG"; cleanup_db; ab close; exit 1; }
sleep 1

click_at '(() => { const l=[...document.querySelectorAll("label")].find(x=>x.textContent.trim()==="Plant Location *"); if(!l) return "no"; const b=l.parentElement.querySelector("button[role=combobox]"); if(!b) return "no"; b.scrollIntoView({block:"center"}); const r=b.getBoundingClientRect(); return Math.round(r.x+r.width/2)+","+Math.round(r.y+r.height/2); })()' \
  && click_at '(() => { const o=[...document.querySelectorAll("[role=option]")]; if(!o.length) return "no"; const r=o[0].getBoundingClientRect(); return Math.round(r.x+r.width/2)+","+Math.round(r.y+r.height/2); })()' \
  || { echo "plant select failed" | tee -a "$LOG"; cleanup_db; ab close; exit 1; }
sleep 1

say "6) Proceed to Next (creates Draft WS-TEST-SC-001, moves to Step 2)"
CREATED=1
ab find role button click --name "Proceed to Next"
if ! ab wait --text "Scanning Details" --timeout 25000; then
  echo "STEP-2 DID NOT RENDER" | tee -a "$LOG"
  ab snapshot -i >> "$LOG" 2>&1
  cleanup_db; ab close; exit 1
fi

say "7) open Surface Condition dropdown in Scanning Details"
sleep 2
click_at '(() => { const td=[...document.querySelectorAll("td")].find(x=>x.textContent.trim()==="Surface Condition"); if(!td) return "no"; const b=td.nextElementSibling ? td.nextElementSibling.querySelector("button[role=combobox]") : null; if(!b) return "no"; b.scrollIntoView({block:"center"}); const r=b.getBoundingClientRect(); return Math.round(r.x+r.width/2)+","+Math.round(r.y+r.height/2); })()' \
  || { echo "surface condition trigger not found" | tee -a "$LOG"; cleanup_db; ab close; exit 1; }
sleep 1

OPTS=$(js '(() => { return JSON.stringify([...document.querySelectorAll("[role=option]")].map(o=>o.textContent.trim())); })()' | tail -1)
OPTS="${OPTS#\"}"; OPTS="${OPTS%\"}"; OPTS="${OPTS//\\\"/\"}"
echo "SURFACE CONDITION OPTIONS: $OPTS" | tee -a "$LOG"
ab screenshot "$OUT/01-weld-scan-surface-condition-dropdown-open.png"

EXACT=$(python3 -c "
import json,sys
try:
    v = json.loads(sys.argv[1])
except Exception:
    print('PARSE_FAIL'); sys.exit()
exp = ['Clean & Smooth','Rough Surface','Painted Surface']
print('EXACT_MATCH' if v == exp else f'MISMATCH: {v}')" "$OPTS")
echo "OPTION CHECK: $EXACT" | tee -a "$LOG"

say "8) select Rough Surface, verify value + Flaw Sizing untouched"
click_at '(() => { const o=[...document.querySelectorAll("[role=option]")].find(x=>x.textContent.trim()==="Rough Surface"); if(!o) return "no"; const r=o.getBoundingClientRect(); return Math.round(r.x+r.width/2)+","+Math.round(r.y+r.height/2); })()' || true
sleep 1
TRIG=$(js '(() => { const td=[...document.querySelectorAll("td")].find(x=>x.textContent.trim()==="Surface Condition"); if(!td) return "no"; const b=td.nextElementSibling ? td.nextElementSibling.querySelector("button[role=combobox]") : null; return b ? (b.textContent||"").trim() : "no"; })()' | tail -1 | tr -d '"')
echo "SELECTED VALUE NOW: $TRIG" | tee -a "$LOG"
ab screenshot "$OUT/02-weld-scan-surface-condition-selected.png"

click_at '(() => { const td=[...document.querySelectorAll("td")].find(x=>x.textContent.trim()==="Flaw Sizing Technique"); if(!td) return "no"; const b=td.nextElementSibling ? td.nextElementSibling.querySelector("button[role=combobox]") : null; if(!b) return "no"; b.scrollIntoView({block:"center"}); const r=b.getBoundingClientRect(); return Math.round(r.x+r.width/2)+","+Math.round(r.y+r.height/2); })()' || true
sleep 1
FOPTS=$(js '(() => { return JSON.stringify([...document.querySelectorAll("[role=option]")].map(o=>o.textContent.trim())); })()' | tail -1)
FOPTS="${FOPTS#\"}"; FOPTS="${FOPTS%\"}"; FOPTS="${FOPTS//\\\"/\"}"
echo "FLAW SIZING OPTIONS: $FOPTS" | tee -a "$LOG"
ab screenshot "$OUT/03-flaw-sizing-technique-unchanged.png"
ab press Escape; sleep 0.5

say "10) close browser"
ab close

cleanup_db

say "11) stop server"
pkill -f "next dev" 2>/dev/null; pkill -f "next-server" 2>/dev/null
ls -la "$OUT" | tee -a "$LOG"
echo "RESULT: $EXACT | selected=$TRIG" | tee -a "$LOG"
tail -3 dev.log >> "$LOG" 2>/dev/null
