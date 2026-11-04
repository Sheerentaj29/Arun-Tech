#!/usr/bin/env python3
"""
Verify client-to-logo mapping.

For every client name in the SQLite DB, and for every example name from
the user's spec, print the normalized key + resolved logo file + whether
the file exists on disk. Also flags any unmapped client (placeholder used).
"""
import json
import os
import re
import sqlite3
import sys

DB_PATH = "/home/z/my-project/db/custom.db"
LOGO_DIR = "/home/z/my-project/storage/logos/clients"
MAPPING_JSON = "/home/z/my-project/storage/logos/client_logo_mapping.json"


def normalize_client_name(name: str) -> str:
    """Mirror of src/lib/client-logo-mapping.ts:normalizeClientName()."""
    if not name:
        return ""
    s = name.lower().strip()
    s = re.sub(r"\s+", " ", s)
    s = re.sub(r"[&/\\,.()'\"!\-;:]+", " ", s)
    s = re.sub(r"\s+", " ", s)
    return s.strip()


def load_map() -> dict:
    with open(MAPPING_JSON, "r", encoding="utf-8") as fh:
        raw = json.load(fh)
    # Strip the _comment key if present.
    return {k: v for k, v in raw.items() if not k.startswith("_")}


def list_client_names_from_db() -> list:
    conn = sqlite3.connect(DB_PATH)
    try:
        cur = conn.cursor()
        cur.execute("SELECT name FROM Client ORDER BY name COLLATE NOCASE;")
        return [r[0] for r in cur.fetchall()]
    finally:
        conn.close()


def list_logo_files_on_disk() -> set:
    return set(os.listdir(LOGO_DIR))


def main() -> int:
    mapping = load_map()
    disk_files = list_logo_files_on_disk()

    # ── Sanity check 1: every value in the map must exist on disk. ──
    print("=" * 78)
    print("Sanity 1 — every mapped logo file exists on disk")
    print("=" * 78)
    missing_files = []
    for key, fname in sorted(mapping.items()):
        ok = fname in disk_files
        flag = "OK " if ok else "!! "
        print(f"  {flag} {key!r:<55} -> {fname}")
        if not ok:
            missing_files.append((key, fname))
    if missing_files:
        print(f"\n  MISSING {len(missing_files)} file(s).")
        return 1
    print(f"\n  All {len(mapping)} mapped files exist on disk.\n")

    # ── Sanity check 1b: every map key must equal its own normalized form. ──
    # If a key is not already normalized, it will never match a real client
    # name (because resolveClientLogo normalizes the input first).
    print("=" * 78)
    print("Sanity 1b — every map key is already in normalized form")
    print("=" * 78)
    bad_keys = []
    for key in sorted(mapping.keys()):
        norm = normalize_client_name(key)
        # The key itself is treated as already-normalized. If re-normalizing
        # it changes it, the key was authored wrong.
        if key != norm:
            bad_keys.append((key, norm))
            print(f"  !!  authored:  {key!r}")
            print(f"      should be: {norm!r}")
    if bad_keys:
        print(f"\n  {len(bad_keys)} key(s) are not in normalized form — FIX THEM.")
        return 1
    print(f"  All {len(mapping)} map keys are already normalized.\n")

    # ── Sanity check 2: every logo file on disk is referenced (or orphan). ──
    print("=" * 78)
    print("Sanity 2 — logo files on disk (orphans are reported, not errors)")
    print("=" * 78)
    referenced = set(mapping.values())
    for f in sorted(disk_files):
        flag = "ref" if f in referenced else "orphan"
        print(f"  [{flag}] {f}")
    print()

    # ── Sanity check 3: every DB client name resolves correctly. ──
    print("=" * 78)
    print("Sanity 3 — every DB client resolves to its correct logo (or null)")
    print("=" * 78)
    db_names = list_client_names_from_db()
    print(f"  ({len(db_names)} clients in DB)\n")
    unresolved_db = []
    for name in db_names:
        key = normalize_client_name(name)
        fname = mapping.get(key)
        if fname:
            print(f"  OK   {name!r:<60} -> {fname}")
        else:
            print(f"  --   {name!r:<60} -> <placeholder>")
            unresolved_db.append(name)
    print(f"\n  {len(db_names) - len(unresolved_db)} mapped, "
          f"{len(unresolved_db)} intentionally use placeholder.\n")

    # ── Sanity check 4: user's example names resolve correctly. ──
    print("=" * 78)
    print("Sanity 4 — user's example names resolve correctly")
    print("=" * 78)
    user_examples = [
        "Aruntech Industrial Services Private Limited",
        "Kothari Petrochemicals",
        "L&T",
        "PCBL Chemical",
        "Pidilite",
        "Raj Petro",
        "Raftaar Terminals Pvt. Ltd.",
        "Thirumalai Chemicals Ltd",
        "TUV India",
        "TATA",
        "TQ Cert",
        "Vaalco Engineers",
        "Valspar",
        "Vedanta Aluminium",
        "Jotun",
    ]
    for name in user_examples:
        key = normalize_client_name(name)
        fname = mapping.get(key)
        if fname:
            print(f"  OK   {name!r:<48} -> {fname}")
        else:
            print(f"  --   {name!r:<48} -> <no exact match; placeholder shown>")
    print()
    return 0


if __name__ == "__main__":
    sys.exit(main())
