#!/usr/bin/env python3
"""End-to-end verification for the Vessel Weld Scan module + Piping Weld
Scan regression check. Uses the real API with a session cookie."""
import json
import subprocess
import sys
import urllib.request
import urllib.error
import http.cookiejar

BASE = "http://localhost:3000"
JAR = http.cookiejar.CookieJar()
OPENER = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(JAR))


def req(path, method="GET", body=None, raw=False):
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(BASE + path, data=data, method=method)
    if data:
        r.add_header("Content-Type", "application/json")
    try:
        resp = OPENER.open(r, timeout=60)
        payload = resp.read()
        return resp.status, payload if raw else json.loads(payload)
    except urllib.error.HTTPError as e:
        payload = e.read()
        try:
            return e.code, json.loads(payload)
        except Exception:
            return e.code, payload[:200]


# ── 1. Login as admin (POST /api/auth with email + password) ───────
status, res = req("/api/auth", "POST", {"email": "admin@inspections.demo", "password": "admin123"})
print(f"login: {status}")
assert status == 200, res

# ── 2. Get a client + plant for report creation ────────────────────
status, clients = req("/api/clients")
assert status == 200, clients
client = clients["items"][0]
plant_id = client["plants"][0]["id"]
print(f"client: {client['name']} plant: {plant_id}")

# ── 3. Create VESSEL_WELD_SCAN report with full parameter set ──────
vws_payload = {
    "reportNumber": "VWS-VERIFY-001",
    "reportType": "VESSEL_WELD_SCAN",
    "equipmentType": "VESSEL",
    "clientId": client["id"],
    "plantId": plant_id,
    "inspectionArea": "Unit 100",
    "pipelineDescription": "V-101 Test Separator vessel verification",
    "pipelineIdentificationNumber": "V-101",
    "materialOfConstruction": "Carbon Steel",
    "applicableStandard": "ASME Sec VIII",
    "inspectionDate": "2026-11-13",
    "vwsDateOfExamination": "2026-11-13",
    "vwsTestingStandard": "ASME Section V 2023, Article 4",
    "vwsAcceptanceCriteria": "ASME Section VIII Div. 1, Appx. 12",
    "vwsUtProcedure": "ATL/NDT/PROC/UWS/21",
    "vwsEquipmentMake": "Olympus",
    "vwsEquipmentModel": "EPOCH 650",
    "vwsEquipmentSerialNo": "171G2032",
    "vwsCalibrationDueDate": "2027-01-15",
    "vwsCableLength": "2.0 meters",
    "vwsCableType": "Coaxial",
    "vwsProbeDetails": json.dumps([
        {"probeType": "Longitudinal Wave", "probeAngle": "0°", "frequency": "4 MHz", "probeSize": "10 mm dia", "serialNo": "P-001"},
        {"probeType": "Shear Wave", "probeAngle": "45°", "frequency": "2.25 MHz", "probeSize": "8x9 mm", "serialNo": "P-045"},
        {"probeType": "Shear Wave", "probeAngle": "60°", "frequency": "4 MHz", "probeSize": "8x9 mm", "serialNo": "P-060"},
        {"probeType": "Shear Wave", "probeAngle": "70°", "frequency": "4 MHz", "probeSize": "8x9 mm", "serialNo": "P-070"},
    ]),
    "vwsCalibrationBlock": "V1 Block",
    "vwsCalibrationBlockMoc": "Carbon Steel",
    "vwsReferenceReflector": "Side drilled hole",
    "vwsReferenceLevel": "100% DAC",
    "vwsFlawSizingTechnique": "DAC",
    "vwsSurfaceTemperature": "32 C",
    "vwsTestingMethod": "Contact pulse echo",
    "vwsCouplant": "Gel",
    "vwsSurfacePreparation": "Grinding",
    "vwsSurfaceFinish": "Smooth",
    "vwsExtentOfScanning": "100% of weld length",
    "vwsDetailRows": json.dumps([
        {"component": "Shell-1", "plateWeldId": "Longitudinal Weld", "weldDimension": "L600 mm x T24 mm", "probeAngle": "70°", "probeFrequency": "4 MHz", "observationResult": "No Significant Indication Observed"},
        {"component": "Head", "plateWeldId": "Circumferential Weld", "weldDimension": "L900 mm x T20 mm", "probeAngle": "45°", "probeFrequency": "2.5 MHz", "observationResult": "Accept"},
        {"component": "Nozzle-N3", "plateWeldId": "Nozzle Weld", "weldDimension": "T12 mm", "probeAngle": "60°", "probeFrequency": "4 MHz", "observationResult": "Accept"},
    ]),
}
status, created = req("/api/pipeline-inspections", "POST", vws_payload)
print(f"create VESSEL_WELD_SCAN: {status}")
assert status == 201, created
rid = created["id"]
print(f"  id={rid} reportNo={created.get('reportNumber')}")

# ── 4. Read it back and confirm persistence ────────────────────────
status, back = req(f"/api/pipeline-inspections/{rid}")
assert status == 200
assert back["reportType"] == "VESSEL_WELD_SCAN"
assert back["vwsTestingStandard"] == "ASME Section V 2023, Article 4"
assert back["vwsEquipmentMake"] == "Olympus"
assert len(json.loads(back["vwsProbeDetails"])) == 4
assert len(json.loads(back["vwsDetailRows"])) == 3
assert back["vwsDateOfExamination"].startswith("2026-11-13")
print("read-back: vws fields persisted OK")

# ── 5. PUT update (partial edit) then confirm ──────────────────────
status, upd = req(f"/api/pipeline-inspections/{rid}", "PUT", {
    "vwsCouplant": "Glycerine",
    "vwsDetailRows": json.dumps([
        {"component": "Shell-1", "plateWeldId": "Longitudinal Weld", "weldDimension": "L600 mm x T24 mm", "probeAngle": "70°", "probeFrequency": "4 MHz", "observationResult": "No Significant Indication Observed"},
        {"component": "Shell-2", "plateWeldId": "Longitudinal Weld", "weldDimension": "L600 mm x T24 mm", "probeAngle": "70°", "probeFrequency": "4 MHz", "observationResult": "Accept"},
        {"component": "Cone", "plateWeldId": "CS-1 Butt Weld", "weldDimension": "L400 mm x T18 mm", "probeAngle": "45°", "probeFrequency": "5 MHz", "observationResult": "Accept"},
        {"component": "Custom-Comp", "plateWeldId": "Custom Weld Entry", "weldDimension": "L100 mm x T8 mm", "probeAngle": "60°", "probeFrequency": "10 MHz", "observationResult": "Custom text result"},
    ]),
})
assert status == 200, upd
status, back2 = req(f"/api/pipeline-inspections/{rid}")
assert back2["vwsCouplant"] == "Glycerine"
assert len(json.loads(back2["vwsDetailRows"])) == 4
assert json.loads(back2["vwsDetailRows"])[3]["component"] == "Custom-Comp"
print("partial PUT update: OK (custom values preserved)")

# ── 6. Generate PDF (portrait + landscape) ─────────────────────────
for orient in ("portrait", "landscape"):
    status, pdf_bytes = req(f"/api/pipeline-inspections/{rid}/pdf?orientation={orient}", "GET", None, raw=True)
    ok = status == 200 and pdf_bytes[:4] == b"%PDF"
    size = len(pdf_bytes) if isinstance(pdf_bytes, bytes) else 0
    print(f"PDF {orient}: status={status} bytes={size} pdf_magic={ok}")
    assert ok, pdf_bytes
    with open(f"/tmp/vws-{orient}.pdf", "wb") as f:
        f.write(pdf_bytes)

# ── 7. Piping Weld Scan regression: pick an existing piping WS draft
#      with legacy rows and generate its PDF ─────────────────────────
status, reports = req("/api/pipeline-inspections")
ws_reports = [r for r in (reports.get("items") if isinstance(reports, dict) else reports) if r.get("reportType") == "PIPELINE_WELD_SCAN"]
print(f"piping weld scan drafts available: {len(ws_reports)}")
target = None
for r in ws_reports:
    status, full = req(f"/api/pipeline-inspections/{r['id']}")
    if full.get("wsTestResultRows") and json.loads(full["wsTestResultRows"]):
        target = full
        break
if target:
    status, pdf_bytes = req(f"/api/pipeline-inspections/{target['id']}/pdf", "GET", None, raw=True)
    ok = status == 200 and isinstance(pdf_bytes, bytes) and pdf_bytes[:4] == b"%PDF"
    print(f"PIPING WS PDF regression: status={status} bytes={len(pdf_bytes)} pdf_magic={ok} (report {target['reportNumber']})")
    assert ok, pdf_bytes
    with open("/tmp/piping-ws.pdf", "wb") as f:
        f.write(pdf_bytes)
else:
    print("PIPING WS PDF regression: skipped (no draft with result rows)")

# ── 8. Submit-block check: vessel weld scan with no rows ───────────
status, empty_ws = req("/api/pipeline-inspections", "POST", {
    "reportNumber": "VWS-EMPTY-001",
    "reportType": "VESSEL_WELD_SCAN",
    "equipmentType": "VESSEL",
    "clientId": client["id"],
    "plantId": plant_id,
    "vwsDetailRows": "[]",
})
assert status == 201, empty_ws
status, err = req(f"/api/pipeline-inspections/{empty_ws['id']}/submit", "POST", {})
print(f"submit empty VWS: status={status} error={err.get('error', '')[:60]!r}")
assert status == 400, "empty vessel weld scan must be blocked from submit"

# ── 9. Cleanup verification artifacts ──────────────────────────────
for d in (rid, empty_ws["id"]):
    status, _ = req(f"/api/pipeline-inspections/{d}", "DELETE")
    print(f"cleanup {d[:12]}…: {status}")

print("\nALL API CHECKS PASSED")
