#!/usr/bin/env python3
"""Remove PIPELINE_UT as a standalone inspection type while keeping Weld Scan intact.
Marker-based surgical edits with verification. No schema/data changes."""
import sys, re

BASE = "/home/z/my-project/src"
results = []

def edit(path, desc, fn):
    p = f"{BASE}/{path}"
    src = open(p, encoding="utf-8").read()
    new, count = fn(src)
    if count == 0:
        results.append((path, desc, "FAIL: marker not found"))
        return False
    open(p, "w", encoding="utf-8").write(new)
    results.append((path, desc, f"OK ({count} edit(s))"))
    return True

def cut(src, start_marker, end_marker, replacement, include_end=True):
    """Replace [start..end] (end inclusive if include_end) with replacement."""
    i = src.find(start_marker)
    assert i != -1, f"start not found: {start_marker[:60]}"
    j = src.find(end_marker, i)
    assert j != -1, f"end not found: {end_marker[:60]}"
    end = j + len(end_marker) if include_end else j
    return src[:i] + replacement + src[end:], 1

# ── 1. store.ts: union member ──
edit("lib/store.ts", "remove PIPELINE_UT from union",
     lambda s: (s.replace('  | "PIPELINE_WELD_SCAN"\n  | "PIPELINE_UT"\n', '  | "PIPELINE_WELD_SCAN"\n', 1), 1 if '  | "PIPELINE_UT"\n' not in s.replace('  | "PIPELINE_WELD_SCAN"\n  | "PIPELINE_UT"\n', '  | "PIPELINE_WELD_SCAN"\n', 1) else 1))

# ── 2. POST route whitelist ──
edit("app/api/pipeline-inspections/route.ts", "remove PIPELINE_UT from whitelist",
     lambda s: (s.replace('        "PIPELINE_WELD_SCAN",\n        "PIPELINE_UT",\n', '        "PIPELINE_WELD_SCAN",\n', 1), 1))

# ── 3. Type selector: remove UT card + Waves import ──
def fix_selector(s):
    s2, c1 = cut(s,
        '  {\n    type: "PIPELINE_UT",',
        '    accent: "border-blue-500 bg-blue-50 hover:bg-blue-100",\n  },\n',
        "")
    # remove Waves import (only used by UT card)
    s2, c2 = (s2.replace("Waves, ", "", 1), 2) if "Waves, " in s2 else (s2.replace(", Waves", "", 1), 2) if ", Waves" in s2 else (s2, 1)
    return s2, 2
edit("components/views/pipeline-report-type-selector-view.tsx", "remove UT card + Waves import", fix_selector)

# ── 4. Form view ──
def fix_form(s):
    n = 0
    # 4a. TYPE_META entry
    s, c = cut(s,
        '  PIPELINE_UT: {\n    title: "ULTRASONIC TEST REPORT",',
        '    step2Label: "UT Details",\n    accent: "border-blue-500 text-blue-700",\n  },\n',
        "")
    n += c
    # 4b. UT step-2 block (start marker .. before WS comment)
    start = '{/* ═══ STEP 2 (UT): ULTRASONIC TEST REPORT ═══ */}'
    end = '{/* ═══ STEP 2 (WELD SCAN): FULL UT/WELD SCAN REPORT ═══ */}'
    i = s.find(start); assert i != -1, "UT step2 start not found"
    j = s.find(end, i); assert j != -1, "WS step2 marker not found"
    s = s[:i] + s[j:]
    n += 1
    # 4c. WS step-2 comment + heading renames
    s = s.replace('{/* ═══ STEP 2 (WELD SCAN): FULL UT/WELD SCAN REPORT ═══ */}',
                  '{/* ═══ STEP 2 (WELD SCAN): FULL WELD SCAN REPORT ═══ */}', 1); n += 1
    s = s.replace('{/* 1. UT INSTRUMENT DETAILS */}', '{/* 1. INSTRUMENT DETAILS */}', 1); n += 1
    s = s.replace('<CardTitle className="text-base">UT Instrument Details</CardTitle>',
                  '<CardTitle className="text-base">Instrument Details</CardTitle>', 1); n += 1
    # 4d. workflow comment
    s = s.replace('// For Weld Scan, MPT, and UT now have their own Step 2 content.',
                  '// For Weld Scan and MPT, their own Step 2 content.', 1); n += 1
    # 4e. Waves import now unused (only the removed UT block used it)
    if "<Waves" not in s and "Waves," in s:
        s = s.replace("Waves, ", "", 1)
    elif "<Waves" not in s and ", Waves" in s:
        s = s.replace(", Waves", "", 1)
    return s, n
edit("components/views/pipeline-report-form-view.tsx", "remove UT meta+step2, rename WS headings", fix_form)

# ── 5. Detail view ──
def fix_detail(s):
    n = 0
    # 5a. union
    s = s.replace('  | "PIPELINE_WELD_SCAN"\n    | "PIPELINE_UT";', '  | "PIPELINE_WELD_SCAN";', 1); n += 1
    # 5b. TYPE_META entry
    s = s.replace('  PIPELINE_UT: {\n    label: "UT",\n    title: "ULTRASONIC TEST REPORT",\n    color: "border-blue-500 text-blue-700",\n  },\n', '', 1); n += 1
    # 5c. UT sections block
    start = '        {/* UT-specific sections — shown only for UT reports */}'
    end = '        {/* DPT-specific sections'
    i = s.find(start); assert i != -1, "detail UT block start not found"
    j = s.find(end, i); assert j != -1, "detail DPT marker not found"
    s = s[:i] + s[j:]
    n += 1
    return s, n
edit("components/views/pipeline-report-detail-view.tsx", "remove UT union/meta/sections", fix_detail)

# ── 6. PDF engine ──
def fix_pdf(s):
    n = 0
    # 6a. union
    s = s.replace('  | "PIPELINE_WELD_SCAN"\n  | "PIPELINE_UT";', '  | "PIPELINE_WELD_SCAN";', 1); n += 1
    # 6b. title map
    s = s.replace('  PIPELINE_UT:        "ULTRASONIC TEST REPORT",\n', '', 1); n += 1
    # 6c. getReportType whitelist
    s = s.replace('    v === "PIPELINE_UT" ||\n', '', 1); n += 1
    # 6d. remove UT branch (replace chain segment with WS opener)
    s, c = cut(s,
        '  } else if (reportType === "PIPELINE_UT") {',
        '  } else if (reportType === "PIPELINE_WELD_SCAN") {',
        '  } else if (reportType === "PIPELINE_WELD_SCAN") {')
    n += c
    # 6e. weld scan comment + heading renames
    s = s.replace('// ─── WELD SCAN / UT REPORT BODY ───', '// ─── WELD SCAN REPORT BODY ───', 1); n += 1
    s = s.replace('// Renders all 4 sections: UT Instrument Details, Test Probe Details,',
                  '// Renders all 4 sections: Instrument Details, Test Probe Details,', 1); n += 1
    s = s.replace('    // 1. UT Instrument Details', '    // 1. Instrument Details', 1); n += 1
    s = s.replace('      "UT Instrument Details",', '      "Instrument Details",', 1); n += 1
    return s, n
edit("lib/pdf/pipeline-report.ts", "remove UT type/branch, rename WS headings", fix_pdf)

print("\n=== EDIT RESULTS ===")
ok = True
for path, desc, res in results:
    print(f"{res:20} {path:55} {desc}")
    if "FAIL" in res: ok = False
sys.exit(0 if ok else 1)
