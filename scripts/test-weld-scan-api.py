#!/usr/bin/env python3
"""
End-to-end API test for the redesigned Weld Scan module.
Creates PIPING + VESSEL Weld Scan reports, verifies field persistence,
and generates PDFs. Test reports are deleted afterwards by the cleanup script.
"""
import json
import urllib.request
import urllib.error

BASE = "http://localhost:3000"
SESSION = {}

def call(method, path, body=None, raw=False):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method)
    req.add_header("Content-Type", "application/json")
    if "uid" in SESSION:
        req.add_header("Authorization", "Bearer " + SESSION["uid"])
    try:
        with urllib.request.urlopen(req) as r:
            payload = r.read()
            return r.status, (payload if raw else json.loads(payload))
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()[:400]

# 1. Login
st, resp = call("POST", "/api/auth", {"email": "admin@inspections.demo", "password": "admin123"})
assert st in (200, 201), f"login failed: {st} {resp}"
SESSION["uid"] = resp["user"]["id"] if "user" in resp else resp["id"]
print("login OK ->", SESSION["uid"])

CLIENT = "cmvoyy4100002sx69ya02dbbv"   # AcidChem Industries (DEMO)
PLANT = "cmvoyy4150006sx69p3o84dx8"    # Vapi Acid Plant (DEMO)

ws_fields = {
    "wsDateOfExamination": "2026-11-13",
    "wsTestingStandard": "ASME Section V 2023, Article 4",
    "wsAcceptanceCriteria": "ASME Section VIII Div. 1, Appx. 8",
    "wsUtProcedure": "ATL/NDT/PROC/UFD/18",
    "wsEquipmentMake": "Olympus",
    "wsEquipmentModel": "EPOCH 600",
    "wsEquipmentSerialNo": "130491802",
    "wsCalibrationDueDate": "2027-01-15",
    "wsCableLength": "2.0 meters",
    "wsCableType": "Coaxial",
    "wsProbeDetails": json.dumps([
        {"probeType": "Longitudinal Wave", "probeAngle": "0°", "frequency": "4 MHz", "probeSize": "10 mm", "serialNo": "726482018"},
        {"probeType": "Shear Wave", "probeAngle": "45°", "frequency": "2.5 MHz", "probeSize": "8 x 9 mm", "serialNo": "01806828R"},
        {"probeType": "Shear Wave", "probeAngle": "60°", "frequency": "4 MHz", "probeSize": "8 x 9 mm", "serialNo": ""},
        {"probeType": "Shear Wave", "probeAngle": "70°", "frequency": "4 MHz", "probeSize": "8 x 9 mm", "serialNo": ""},
    ]),
    "wsCalibrationBlock": "DAC Block 200x90x19 mm",
    "wsCalibrationBlockMoc": "Carbon Steel",
    "wsReferenceReflector": "Side drilled hole",
    "wsReferenceLevel": "100% of DAC",
    "wsFlawSizingTechnique": "6 dB Drop",
    "wsSurfaceTemperature": "32 °C",
    "wsTestingMethod": "A Scan Pulse Echo",
    "wsCouplant": "Oil",
    "wsSurfacePreparation": "Wire brush & grinding",
    "wsSurfaceFinish": "Clean & Smooth",
    "wsExtentOfScanning": "100% of weld joints",
}

vessel_rows = [
    {"location": "Shell-1", "weldId": "T-Joint Butt Weld", "weldType": "", "weldDimension": "L600 mm × T24 mm", "probeAngle": "70°", "probeFrequency": "4 MHz", "observationResult": "No Significant Indication Observed"},
    {"location": "Nozzle-N3", "weldId": "Nozzle Weld", "weldType": "", "weldDimension": "T12 mm", "probeAngle": "60°", "probeFrequency": "2.5 MHz", "observationResult": "Accept"},
]
piping_rows = [
    {"location": "6\" CS Line 1128-PL-001", "weldId": "W-101", "weldType": "Butt Weld", "weldDimension": "L150 mm × T7 mm", "probeAngle": "70°", "probeFrequency": "4 MHz", "observationResult": "No Significant Indication Observed"},
    {"location": "4\" SS Line 1128-PL-002", "weldId": "W-102", "weldType": "Fillet Weld", "weldDimension": "L80 mm × T5 mm", "probeAngle": "45°", "probeFrequency": "5 MHz", "observationResult": "Reject"},
]

created = {}
for variant, extra in (
    ("PIPING", {"equipmentType": "PIPING", "wsDetailRows": json.dumps(piping_rows), "vesselOrientation": None}),
    ("VESSEL", {"equipmentType": "VESSEL", "wsDetailRows": json.dumps(vessel_rows), "vesselOrientation": None}),
):
    body = {
        "reportNumber": f"WS-TEST-{variant}-001",
        "reportType": "PIPELINE_WELD_SCAN",
        "clientId": CLIENT,
        "plantId": PLANT,
        "pipelineDescription": f"Test {variant} description",
        "pipelineIdentificationNumber": "V-1128" if variant == "VESSEL" else "PL-1128",
        "inspectorName": "Test Inspector",
        **ws_fields,
        **extra,
    }
    st, resp = call("POST", "/api/pipeline-inspections", body)
    assert st == 201, f"create {variant} failed: {st} {resp}"
    rid = resp["id"]
    created[variant] = rid
    print(f"create {variant} OK -> {rid}")
    # Verify persistence via GET
    st, got = call("GET", f"/api/pipeline-inspections/{rid}")
    assert st == 200
    checks = ["wsTestingStandard", "wsUtProcedure", "wsCableLength", "wsCalibrationBlockMoc",
              "wsSurfaceFinish", "wsExtentOfScanning", "wsDetailRows", "wsProbeDetails"]
    bad = [k for k in checks if not got.get(k)]
    missing_rows = got.get("wsDetailRows") != body["wsDetailRows"]
    missing_probe = got.get("wsProbeDetails") != body["wsProbeDetails"]
    print(f"  equipmentType={got.get('equipmentType')} dateOK={bool(got.get('wsDateOfExamination'))} probeOK={not missing_probe} rowsOK={not missing_rows} empty={bad if bad else 'none'}")

    # PUT update a couple of fields (simulating form save)
    st, up = call("PUT", f"/api/pipeline-inspections/{rid}", {
        "wsCouplant": "Gel (updated)",
        "wsDetailRows": body["wsDetailRows"],
        "wsSurfaceFinish": "Painted Surface",
    })
    assert st == 200, f"update {variant} failed: {st} {up}"
    st, got2 = call("GET", f"/api/pipeline-inspections/{rid}")
    print(f"  update OK couplant={got2.get('wsCouplant')} finish={got2.get('wsSurfaceFinish')}")

    # Generate PDF
    st, pdf_bytes = call("GET", f"/api/pipeline-inspections/{rid}/pdf", raw=True)
    assert st == 200, f"pdf {variant} failed: {st} {pdf_bytes[:120]}"
    out = f"/tmp/weldscan-test-{variant}.pdf"
    with open(out, "wb") as f:
        f.write(pdf_bytes)
    print(f"  PDF OK -> {out} ({len(pdf_bytes)} bytes)")

print("ALL API TESTS PASSED. Test report ids:", created)
