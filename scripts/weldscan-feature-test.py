"""End-to-end test for the Weld Scan calibration-block dropdown and the
Probe Type column visibility toggle, through the REAL API + PDF endpoints.

Checks (req 5 checklist):
1. all five calibration-block options save and read back
2. selected option + admin spec appear in the PDF
3. Probe Type column visible by default, removed via wsProbeTypeHidden=true
   (heading + values gone, remaining columns intact)
4. hidden state persists on the record (save / reopen)
5. restore brings the column AND its original values back
6. vessel weld-scan options + spec row appear in its PDF
"""
import json
import sqlite3
import subprocess
import sys
import urllib.request

BASE = "http://localhost:3000"

con = sqlite3.connect("db/custom.db")
ADMIN_ID = con.execute("SELECT id FROM User WHERE email='admin@inspections.demo'").fetchone()[0]
ws_id = "cmwix0dax0005pjhy2emj6yve"  # pipeline WS report with real test-result rows
vws_id = con.execute(
    "SELECT id FROM PipelineInspection WHERE reportType='VESSEL_WELD_SCAN' LIMIT 1"
).fetchone()[0]
print(f"pipeline WS report: {ws_id} | vessel WS report: {vws_id}")

HDRS = {"Content-Type": "application/json", "Authorization": f"Bearer {ADMIN_ID}"}

def api(method, path, body=None):
    req = urllib.request.Request(
        BASE + path,
        data=json.dumps(body).encode() if body is not None else None,
        headers=HDRS,
        method=method,
    )
    with urllib.request.urlopen(req, timeout=240) as r:
        raw = r.read()
        try:
            return json.loads(raw)
        except Exception:
            return raw

def pdf(path, fname):
    req = urllib.request.Request(BASE + path, headers={"Authorization": f"Bearer {ADMIN_ID}"})
    with urllib.request.urlopen(req, timeout=240) as r:
        data = r.read()
    open(fname, "wb").write(data)
    return fname

def pdftext(fname):
    return subprocess.run(["pdftotext", fname, "-"], capture_output=True, text=True).stdout

OPTIONS = [
    "V1 Block (IIW Type 1)",
    "V2 Block (IIW Type 2 / A4)",
    "DAC Block – 19 mm",
    "VW Step Block – 1 mm to 10 mm (10-step)",
    "Step Wedge – 2 mm to 25 mm",
]

# ── 1. all five options save + read back (pipeline) ──
ok = True
for opt in OPTIONS:
    api("PUT", f"/api/pipeline-inspections/{ws_id}", {"wsScanningCalibrationBlock": opt})
    rec = api("GET", f"/api/pipeline-inspections/{ws_id}")
    got = rec.get("wsScanningCalibrationBlock") if isinstance(rec, dict) else None
    status = "OK " if got == opt else "FAIL"
    ok = ok and got == opt
    print(f"{status} save+readback: {opt!r} -> {got!r}")
if not ok:
    sys.exit("calibration-block round-trip failed")

# leave a realistic selection + admin spec
api("PUT", f"/api/pipeline-inspections/{ws_id}", {
    "wsScanningCalibrationBlock": OPTIONS[3],
    "wsScanningCalibrationBlockSpec": "Steps: 1, 2, 3, 4, 5, 6, 7, 8, 9, 10 mm",
})

# ── 2/3. PDF with Probe Type visible → then hidden ──
f1 = pdf(f"/api/pipeline-inspections/{ws_id}/pdf?orientation=portrait", "/tmp/ws_visible.pdf")
t1 = pdftext(f1)
print("visible PDF: Probe Type heading:", "Probe Type" in t1,
      "| spec row:", "Calibration Block Specification" in t1,
      "| block name:", "VW Step Block" in t1,
      "| 10-step option:", "10-step" in t1)

api("PUT", f"/api/pipeline-inspections/{ws_id}", {"wsProbeTypeHidden": True})
f2 = pdf(f"/api/pipeline-inspections/{ws_id}/pdf?orientation=portrait", "/tmp/ws_hidden.pdf")
t2 = pdftotext = pdftext(f2)
print("hidden PDF: Probe Type heading gone:", "Probe Type" not in t2,
      "| BP/SD/Depth still there:", all(w in t2 for w in ["Beam Path", "Skip Distance", "Depth"]),
      "| Observation/Result intact:", all(w in t2 for w in ["Observation", "Result"]),
      "| spec row still there:", "Calibration Block Specification" in t2)

# ── 4. persistence on the record ──
rec = api("GET", f"/api/pipeline-inspections/{ws_id}")
print("persisted wsProbeTypeHidden:", rec.get("wsProbeTypeHidden") is True)

# ── 5. restore → values return ──
api("PUT", f"/api/pipeline-inspections/{ws_id}", {"wsProbeTypeHidden": False})
f3 = pdf(f"/api/pipeline-inspections/{ws_id}/pdf?orientation=portrait", "/tmp/ws_restored.pdf")
t3 = pdftext(f3)
rows = json.loads(rec.get("wsTestResultRows") or "[]")
first_probe = rows[0].get("probeType", "") if rows else "NONE"
print("row count:", len(rows), "| first probeType:", repr(first_probe))
print("restored PDF: Probe Type heading back:", "Probe Type" in t3,
      "| first row probeType value:", first_probe in t3,
      "| hidden flag now:", api("GET", f"/api/pipeline-inspections/{ws_id}").get("wsProbeTypeHidden") is False)

# ── 6. vessel weld-scan options + spec row in its PDF ──
for opt in OPTIONS[:2]:
    api("PUT", f"/api/pipeline-inspections/{vws_id}", {"vwsCalibrationBlock": opt})
    rec = api("GET", f"/api/pipeline-inspections/{vws_id}")
    print("vessel save+readback:", rec.get("vwsCalibrationBlock") == opt, repr(rec.get("vwsCalibrationBlock")))
api("PUT", f"/api/pipeline-inspections/{vws_id}", {
    "vwsCalibrationBlock": OPTIONS[1],
    "vwsCalibrationBlockSpec": "V2 block, A4 steel, side-drilled holes per IIW",
})
f4 = pdf(f"/api/pipeline-inspections/{vws_id}/pdf?orientation=portrait", "/tmp/vws_calib.pdf")
t4 = pdftext(f4)
print("vessel PDF: block name:", "V2 Block (IIW Type 2 / A4)" in t4,
      "| spec row:", "Calibration Block Specification" in t4)

print("DONE")
