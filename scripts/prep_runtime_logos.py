#!/usr/bin/env python3
"""Prepare runtime logo dir + generate the new mapping entries.

Follows the app's documented convention (client-logo-mapping.ts):
"Filenames are taken verbatim from the user's upload (with the accidental
leading space stripped)." — so we strip leading/trailing edge spaces of the
filename stem in the RUNTIME storage dir only. Repo checkout stays untouched.
"""
import os, shutil, sqlite3, re

RUNTIME = "/home/z/my-project/storage/logos/clients"

def norm(name: str) -> str:
    if not name:
        return ""
    s = name.lower().strip()
    s = re.sub(r'\s+', ' ', s)
    s = re.sub(r"[&/\\,.()'\"!\-;:]+", ' ', s)
    s = re.sub(r'\s+', ' ', s).strip()
    return s

# 1) Rename runtime files: strip leading/trailing spaces of the full filename
renames = []
for f in sorted(os.listdir(RUNTIME)):
    clean = f.strip()
    if clean != f:
        target = os.path.join(RUNTIME, clean)
        if os.path.exists(target):
            print(f"COLLISION! {f!r} -> {clean!r} already exists")
        else:
            os.rename(os.path.join(RUNTIME, f), target)
            renames.append((f, clean))
print(f"RENAMED {len(renames)} files:")
for old, new in renames:
    print(f"  {old!r} -> {new!r}")

# 2) Verify no files remain with edge spaces
bad = [f for f in os.listdir(RUNTIME) if f != f.strip()]
print("REMAINING EDGE-SPACE FILES:", bad if bad else "none")
print("TOTAL FILES NOW:", len(os.listdir(RUNTIME)))
