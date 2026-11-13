#!/usr/bin/env python3
"""Scan all API route files: methods, auth checks, validation, transactions, audit."""
import os, re, json

ROOT = "/home/z/my-project/src/app/api"
rows = []
for dirpath, dirs, files in os.walk(ROOT):
    if "route.ts" not in files and "route.js" not in files:
        continue
    p = os.path.join(dirpath, "route.ts") if "route.ts" in files else os.path.join(dirpath, "route.js")
    rel = os.path.relpath(p, ROOT).replace("/route.ts", "").replace("route.ts", "")
    src = open(p).read()
    methods = sorted(set(re.findall(r'export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE|HEAD)', src)))
    has_auth = bool(re.search(r'getSession\(|requireSession\(|requireAdmin\(|getCurrentUser\(', src))
    role_check = bool(re.search(r'role\s*!==|dashboardRole\s*!==|session\.role|\.role\s*===', src))
    owner_check = bool(re.search(r'isOwner\(|session\.id\s*===|inspectorId\s*===', src))
    zod = bool(re.search(r'from ["\']zod["\']|z\.object|zodResolver', src))
    manual_val = bool(re.search(r'return NextResponse\.json\(\{ error:', src))
    transaction = bool(re.search(r'\$transaction', src))
    audit = bool(re.search(r'recordAudit\(', src))
    upload = bool(re.search(r'formData\(\)|file\.arrayBuffer|writeFileSync', src))
    size_limit = bool(re.search(r'MAX_.*SIZE|size\s*>|byteLength\s*>|\.length\s*>\s*\d{6}', src))
    rows.append({
        "route": "/" + rel.strip("/") if rel.strip("/") else "/",
        "methods": ",".join(methods),
        "auth": has_auth, "role": role_check, "owner": owner_check,
        "zod": zod, "manual_err": manual_val, "tx": transaction,
        "audit": audit, "upload": upload, "size_limit": size_limit,
        "lines": src.count("\n"),
    })

rows.sort(key=lambda r: r["route"])
print(f"TOTAL ROUTE FILES: {len(rows)}")
print(f"{'ROUTE':70} {'METHODS':18} AUTH ROLE ZOD TX AUDIT UPL IMP")
no_auth = []
for r in rows:
    flag = "" if r["auth"] else "  <-- NO AUTH CHECK"
    print(f"{r['route']:70} {r['methods']:18} {int(r['auth']):4} {int(r['role']):4} {int(r['zod']):4} {int(r['tx']):3} {int(r['audit']):5} {int(r['upload']):4} {int(r['size_limit']):4}{flag}")
    if not r["auth"]:
        no_auth.append(r["route"])
print()
print("ROUTES WITHOUT ANY AUTH CHECK:", no_auth if no_auth else "NONE")
print("ROUTES USING ZOD:", sum(1 for r in rows if r["zod"]))
print("ROUTES USING $transaction:", sum(1 for r in rows if r["tx"]))
print("ROUTES WITH recordAudit:", sum(1 for r in rows if r["audit"]))
print("ROUTES WITH FILE UPLOAD:", sum(1 for r in rows if r["upload"]))
print("ROUTES WITH SIZE LIMIT:", sum(1 for r in rows if r["size_limit"]))
json.dump(rows, open("/home/z/my-project/tool-results/api_scan.json", "w"), indent=1)
