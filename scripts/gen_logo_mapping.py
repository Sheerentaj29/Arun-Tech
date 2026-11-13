#!/usr/bin/env python3
"""Match DB client names to logo files and generate TS mapping lines."""
import os, re, json

LOGO_DIR = "/home/z/my-project/Arun-Tech/storage/logos/clients"

def norm(name: str) -> str:
    """Replicate normalizeClientName() from src/lib/client-logo-mapping.ts"""
    if not name:
        return ""
    s = name.lower().strip()
    s = re.sub(r'\s+', ' ', s)
    s = re.sub(r"[&/\\,.()'\"!\-;:]+", ' ', s)
    s = re.sub(r'\s+', ' ', s).strip()
    return s

# Existing 5 mappings already in the TS file
EXISTING = {
    "aarti industries ltd": "Aarti Industries Ltd.png",
    "atul ltd": "Atul Ltd.png",
    "bharat petroleum corporation ltd": "Bharat Petroleum Corporation Ltd.png",
    "blue star limited": "Blue Star Limited.png",
    "chemplast sanmar limited": "Chemplast Sanmar Limited.png",
}

# Read DB clients
import sqlite3
conn = sqlite3.connect('/home/z/my-project/db/custom.db')
cur = conn.cursor()
cur.execute("SELECT name FROM Client ORDER BY name COLLATE NOCASE")
clients = [r[0] for r in cur.fetchall()]

# Logo files (strip leading/trailing spaces for display but keep EXACT filename)
files = sorted(os.listdir(LOGO_DIR))
file_by_norm = {}
for f in files:
    base = f.strip()
    stem = os.path.splitext(base)[0]   # drop extension before normalizing
    key = norm(stem)
    file_by_norm.setdefault(key, base)  # first wins alphabetically

exact, manual, unmatched_files = [], [], []
matched_files = set()
for c in clients:
    key = norm(c)
    if key in EXISTING:
        continue  # already mapped
    if key in file_by_norm:
        exact.append((c, file_by_norm[key]))
        matched_files.add(file_by_norm[key])
    else:
        manual.append(c)

for f in files:
    if f not in matched_files and f.strip() not in matched_files and f.strip() != "Arun Tech.jpg":
        if norm(f.strip()) not in {norm(c) for c in clients}:
            unmatched_files.append(f)

print("=== EXACT MATCHES (new entries to add) ===")
for c, f in exact:
    print(f'  "{norm(c)}": "{f}",')

print("\n=== CLIENTS WITHOUT EXACT FILE MATCH (need manual curation) ===")
for c in manual:
    print(f"  DB: {c!r}")

print("\n=== FILES WITHOUT EXACT CLIENT MATCH ===")
for f in unmatched_files:
    print(f"  FILE: {f!r}")
