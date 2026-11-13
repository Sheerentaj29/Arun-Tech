#!/usr/bin/env python3
"""Upload two test inspection photos to the VESSEL Weld Scan test report,
add captions, then regenerate the PDF to verify photographs appear after
the Weld Scan Testing Details table."""
import json
import urllib.request
import mimetypes
import uuid

BASE = "http://localhost:3000"
SESSION = {}

def call(method, path, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method)
    req.add_header("Content-Type", "application/json")
    if "uid" in SESSION:
        req.add_header("Authorization", "Bearer " + SESSION["uid"])
    with urllib.request.urlopen(req) as r:
        return r.status, json.loads(r.read())

st, resp = call("POST", "/api/auth", {"email": "admin@inspections.demo", "password": "admin123"})
SESSION["uid"] = resp["user"]["id"] if "user" in resp else resp["id"]

REPORT_ID = "cmwev8b44000brn7j5xqfvx7c"  # VESSEL weld scan test report

def upload_photo(path, caption):
    boundary = uuid.uuid4().hex
    with open(path, "rb") as f:
        file_bytes = f.read()
    mime = mimetypes.guess_type(path)[0] or "image/png"
    parts = []
    parts.append(("--" + boundary).encode())
    parts.append(f'Content-Disposition: form-data; name="file"; filename="{path.split("/")[-1]}"'.encode())
    parts.append(f"Content-Type: {mime}".encode())
    parts.append(b"")
    parts.append(file_bytes)
    parts.append(("--" + boundary).encode())
    parts.append(b'Content-Disposition: form-data; name="caption"')
    parts.append(b"")
    parts.append(caption.encode())
    parts.append(("--" + boundary + "--").encode())
    body = b"\r\n".join(parts)
    req = urllib.request.Request(f"{BASE}/api/pipeline-inspections/{REPORT_ID}/photos", data=body, method="POST")
    req.add_header("Content-Type", f"multipart/form-data; boundary={boundary}")
    req.add_header("Authorization", "Bearer " + SESSION["uid"])
    with urllib.request.urlopen(req) as r:
        return r.status, json.loads(r.read())

# Generate a couple of small test inspection photos with PIL if available
try:
    from PIL import Image, ImageDraw
    import os
    p1 = "/tmp/ws-photo-1.png"
    p2 = "/tmp/ws-photo-2.png"
    for path, label, color in ((p1, "WS Photo A", (120, 140, 160)), (p2, "WS Photo B", (150, 110, 90))):
        img = Image.new("RGB", (640, 420), color)
        d = ImageDraw.Draw(img)
        d.rectangle([40, 40, 600, 380], outline=(255, 255, 255), width=6)
        d.text((230, 200), label, fill=(255, 255, 255))
        img.save(path)
    use_gen = True
except Exception as e:
    print("PIL unavailable:", e)
    use_gen = False

if use_gen:
    for path, cap in ((p1, "Weld scan on Shell-1 T-joint"), (p2, "Weld scan on Nozzle-N3 weld")):
        st, resp = upload_photo(path, cap)
        print("upload", path, "->", st, resp.get("id", resp))

# Also verify photo reorder endpoint semantics? (optional) — instead regenerate PDF.
req = urllib.request.Request(f"{BASE}/api/pipeline-inspections/{REPORT_ID}/pdf")
req.add_header("Authorization", "Bearer " + SESSION["uid"])
with urllib.request.urlopen(req) as r:
    pdf = r.read()
with open("/tmp/weldscan-test-VESSEL-photos.pdf", "wb") as f:
    f.write(pdf)
print("PDF with photos ->", len(pdf), "bytes")
