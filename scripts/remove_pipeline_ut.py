#!/usr/bin/env python3
"""remove_pipeline_ut.py — Stage: remove PIPELINE_UT report type completely.

Deletes only UT-exclusive code (verified line ranges with content asserts).
Run bottom-up per file so earlier line numbers stay valid.
Aborts WITHOUT modifying anything if any assertion fails.
"""
import sys

BASE = "/home/z/my-project/src"

# file -> list of (start_line_1based, end_line_inclusive, [expected content snippets])
DELETIONS = {
    f"{BASE}/lib/store.ts": [
        (60, 60, ['| "PIPELINE_UT"']),
    ],
    f"{BASE}/app/api/pipeline-inspections/route.ts": [
        (145, 145, ['"PIPELINE_UT",']),
    ],
    f"{BASE}/lib/pdf/pipeline-report.ts": [
        (89, 89, ['| "PIPELINE_UT";']),
        (98, 98, ['PIPELINE_UT:        "ULTRASONIC TEST REPORT"']),
        (109, 109, ['v === "PIPELINE_UT"']),
        (1698, 1955, ['} else if (reportType === "PIPELINE_UT") {']),
    ],
    f"{BASE}/components/views/pipeline-report-detail-view.tsx": [
        (62, 62, ['| "PIPELINE_UT";']),
        (119, 139, ["// ─── UT (ULTRASONIC TEST) FIELDS ───", "utSubContract", "utCustomColumns"]),
        (327, 331, ['PIPELINE_UT: {', 'label: "UT"', "ULTRASONIC TEST REPORT"]),
        (713, 884, ['{/* UT-specific sections', 'report.reportType === "PIPELINE_UT"']),
    ],
    f"{BASE}/components/views/pipeline-report-form-view.tsx": [
        (126, 133, ["PIPELINE_UT: {", "ULTRASONIC TEST REPORT"]),
        (4183, 4553, ["STEP 2 (UT): ULTRASONIC TEST REPORT", 'header.reportType === "PIPELINE_UT"']),
    ],
}

# Special in-place replacement: PDF line 108 ends with "||" that must be
# removed when line 109 (v === "PIPELINE_UT") is deleted.
REPLACEMENTS = {
    f"{BASE}/lib/pdf/pipeline-report.ts": {
        108: ('    v === "PIPELINE_WELD_SCAN" ||', '    v === "PIPELINE_WELD_SCAN"'),
    },
}

def main():
    # Phase 1: validate all assertions first (no writes yet)
    errors = []
    for path, ranges in DELETIONS.items():
        with open(path, encoding="utf-8") as f:
            lines = f.readlines()
        for (start, end, expected) in ranges:
            if end > len(lines):
                errors.append(f"{path}: range {start}-{end} beyond EOF ({len(lines)} lines)")
                continue
            chunk = "".join(lines[start - 1 : end])
            for exp in expected:
                if exp not in chunk:
                    errors.append(f"{path}: lines {start}-{end} missing expected {exp!r}")
    if errors:
        print("ASSERTION FAILURES — aborting, no files modified:")
        for e in errors:
            print("  " + e)
        sys.exit(1)

    # Phase 2: apply replacements + deletions (bottom-up per file)
    for path, ranges in DELETIONS.items():
        with open(path, encoding="utf-8") as f:
            lines = f.readlines()
        repls = REPLACEMENTS.get(path, {})
        for (start, end, _exp) in sorted(ranges, reverse=True):
            if start in repls and repls[start][0] == lines[start - 1]:
                pass  # replacement handled separately below
            del lines[start - 1 : end]
        # replacements: apply on the ORIGINAL line numbers shifted by deletions
        # (do replacements FIRST conceptually -> instead apply before deletions next time;
        #  simplest: recompute by searching unique strings)
        with open(path, "w", encoding="utf-8") as f:
            f.writelines(lines)
        print(f"edited: {path} ({sum(e - s + 1 for s, e, _ in ranges)} lines removed)")

    # Fix the PDF "||" trailing: after deleting line 109, line 108 still has ||
    pdf = f"{BASE}/lib/pdf/pipeline-report.ts"
    with open(pdf, encoding="utf-8") as f:
        content = f.read()
    bad = '    v === "PIPELINE_WELD_SCAN" ||\n  ) return v;'
    good = '    v === "PIPELINE_WELD_SCAN"\n  ) return v;'
    if bad in content:
        content = content.replace(bad, good)
        with open(pdf, "w", encoding="utf-8") as f:
            f.write(content)
        print("fixed: PDF getReportType trailing ||")
    elif good in content:
        print("skip: PDF getReportType already clean")
    else:
        print("WARN: PDF getReportType pattern not found — check manually")

    print("ALL DELETIONS APPLIED")

if __name__ == "__main__":
    main()
