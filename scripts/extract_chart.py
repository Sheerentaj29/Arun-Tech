#!/usr/bin/env python3
"""Parse the ANSI B36.10/36.19 pipe chart PDF into clean JSON.
Segmentation by x-range: NPS <50 | DN 50-75 | OD 75-115 | schedules >=125,
then schedule cells mapped to the nearest header column by x."""
import pdfplumber, json, re

PDF = "/tmp/charts/chart.pdf"

HEADER = [
    ("SCH 5S", 133), ("SCH 10S", 158), ("SCH 10", 184), ("SCH 20", 210),
    ("SCH 30", 235), ("SCH 40S", 260), ("SCH STD", 285), ("SCH 40", 313),
    ("SCH 60", 339), ("SCH 80S", 363), ("SCH XS", 390), ("SCH 80", 416),
    ("SCH 100", 440), ("SCH 120", 465), ("SCH 140", 491), ("SCH 160", 517),
    ("SCH XXS", 543),
]

def clean(v: str):
    v = v.strip().replace(",", ".")
    v = re.sub(r"^[ilI](?=\d)", "1", v)          # OCR: i6.66 -> 16.66
    if not re.match(r"^\d+(\.\d+)?$", v):
        return None
    return f"{float(v):g}"

with pdfplumber.open(PDF) as pdf:
    words = pdf.pages[0].extract_words(x_tolerance=1.5, y_tolerance=2)

rows = {}
for w in words:
    y = round(w["top"], 0)
    rows.setdefault(y, []).append(w)

size_re = re.compile(r"^(\d+)$|^(\d+)/(\d+)$|^(\d+) (\d+)/(\d+)$")
table = OrderedDict if False else {}
order = []
for y in sorted(rows.keys()):
    if y < 145:
        continue
    ws = sorted(rows[y], key=lambda w: w["x0"])
    if not ws:
        continue
    nps_parts = [w["text"] for w in ws if w["x1"] < 50]
    nps = " ".join(nps_parts)
    if not size_re.match(nps) and not re.match(r"^\d+ \d+/\d+$", nps):
        continue
    dn_parts = [w["text"] for w in ws if 50 <= w["x0"] < 75]
    od_parts = [w["text"] for w in ws if 75 <= w["x0"] < 115]
    sched_words = [w for w in ws if w["x0"] >= 125]
    dn = dn_parts[0] if dn_parts else ""
    od = clean(od_parts[0]) if od_parts else ""
    sched = {}
    for w in sched_words:
        x = w["x0"]
        name, hx = min(HEADER, key=lambda t: abs(t[1] - x))
        if abs(hx - x) > 13:
            print(f"  !! {nps}: '{w['text']}'@{int(x)} ambiguous (nearest {name}@{hx})")
            continue
        v = clean(w["text"])
        if v is None:
            print(f"  !! {nps}: unparsed '{w['text']}' near {name}")
            continue
        if name in sched and sched[name] != v:
            print(f"  !! {nps}: duplicate {name}: {sched[name]} vs {v}")
        sched[name] = v
    table[nps] = {"dn": dn, "od": od, "sched": sched}
    order.append(nps)

print(f"parsed {len(table)} rows: {order}")
with open("/tmp/charts/parsed.json", "w") as f:
    json.dump(table, f, indent=1)

for nps in ["1/4", "1/2", "3/4", "1", "1 1/4", "1 1/2", "2", "2 1/2", "3", "4",
            "6", "8", "10", "12", "14", "16", "20", "24", "30", "48"]:
    r = table.get(nps)
    if not r:
        print(nps, "MISSING"); continue
    print(f"NPS {nps} DN{r['dn']} OD{r['od']}: " +
          " ".join(f"{k.split()[1]}={v}" for k, v in r["sched"].items()))
