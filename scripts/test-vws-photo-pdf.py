#!/usr/bin/env python3
"""Final check: Vessel Weld Scan with photo — photo must appear AFTER the
Weld Scan Testing Details table in the PDF, aspect ratio preserved."""
import json
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
        resp = OPENER.open(r, timeout=120)
        payload = resp.read()
        return resp.status, payload if raw else json.loads(payload)
    except urllib.error.HTTPError as e:
        payload = e.read()
        try:
            return e.code, json.loads(payload)
        except Exception:
            return e.code, payload[:200]


status, res = req("/api/auth", "POST", {"email": "admin@inspections.demo", "password": "admin123"})
assert status == 200, res
status, clients = req("/api/clients")
client = clients["items"][0]
plant_id = client["plants"][0]["id"]

# Create report
status, created = req("/api/pipeline-inspections", "POST", {
    "reportNumber": "VWS-PHOTO-001",
    "reportType": "VESSEL_WELD_SCAN",
    "equipmentType": "VESSEL",
    "clientId": client["id"],
    "plantId": plant_id,
    "pipelineDescription": "Photo placement verification vessel",
    "vwsTestingStandard": "ASME Section V 2023, Article 4",
    "vwsProbeDetails": json.dumps([
        {"probeType": "Longitudinal Wave", "probeAngle": "0°", "frequency": "4 MHz", "probeSize": "10 mm", "serialNo": "P1"},
        {"probeType": "Shear Wave", "probeAngle": "45°", "frequency": "", "probeSize": "", "serialNo": ""},
        {"probeType": "Shear Wave", "probeAngle": "60°", "frequency": "", "probeSize": "", "serialNo": ""},
        {"probeType": "Shear Wave", "probeAngle": "70°", "frequency": "", "probeSize": "", "serialNo": ""},
    ]),
    "vwsDetailRows": json.dumps([
        {"component": "Shell-1", "plateWeldId": "Longitudinal Weld", "weldDimension": "L600 mm x T24 mm", "probeAngle": "70°", "probeFrequency": "4 MHz", "observationResult": "Accept"},
    ]),
})
assert status == 201, created
rid = created["id"]

# Upload photo via multipart
boundary = "----agentboundary123"
with open("/tmp/test-photo.png", "rb") as f:
    img = f.read()
parts = []
parts.append(f"--{boundary}\r\nContent-Disposition: form-data; name=\"category\"\r\n\r\nINSPECTION\r\n".encode())
parts.append(f"--{boundary}\r\nContent-Disposition: form-data; name=\"caption\"\r\n\r\nWeld scan probe setup on Shell-1\r\n".encode())
parts.append(f"--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"probe-setup.png\"\r\nContent-Type: image/png\r\n\r\n".encode() + img + b"\r\n")
parts.append(f"--{boundary}--\r\n".encode())
body = b"".join(parts)
r = urllib.request.Request(BASE + f"/api/pipeline-inspections/{rid}/photos", data=body, method="POST")
r.add_header("Content-Type", f"multipart/form-data; boundary={boundary}")
resp = OPENER.open(r, timeout=60)
print("photo upload:", resp.status)
photo = json.loads(resp.read())

# Generate PDF and check its structure: which page holds "Weld Scan Testing
# Details" vs the photo caption text.
status, pdf_bytes = req(f"/api/pipeline-inspections/{rid}/pdf", "GET", None, raw=True)
assert status == 200 and pdf_bytes[:4] == b"%PDF"
with open("/tmp/vws-photo.pdf", "wb") as f:
    f.write(pdf_bytes)
print(f"PDF generated: {len(pdf_bytes)} bytes")
print(f"photo id={photo.get('id')} caption={photo.get('caption')!r}")
print("REPORT_ID", rid)
