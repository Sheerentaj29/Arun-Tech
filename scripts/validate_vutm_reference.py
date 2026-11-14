#!/usr/bin/env python3
"""Validate the generated vessel-UT reference data file against the chart."""
import re, json, sys

SRC = "/home/z/my-project/src/lib/vessel-ut-reference.ts"
text = open(SRC).read()

H_LABELS = ["SCH 10","SCH 20","SCH 30","SCH STD","SCH 40","SCH 60","SCH 80",
            "SCH XS","SCH 100","SCH 120","SCH 140","SCH 160","SCH XXS"]
V_LABELS = ["SCH 5S","SCH 10S","SCH 40S","SCH 80S","SCH 160S","SCH XXS"]

# Extract H rows: H("nps", "dn", "od", { ... })
h_rows = re.findall(r'H\("([^"]+)", "([^"]+)", "([^"]+)", \{([^}]*)\}\)', text)
v_rows = re.findall(r'V\("([^"]+)", "([^"]+)", "([^"]+)", \{([^}]*)\}\)', text)

def parse_pairs(body):
    out = {}
    for m in re.finditer(r'"([^"]+)":\s*"([^"]+)"', body):
        out[m.group(1)] = m.group(2)
    return out

errors = []
H_EXPECTED = ["1/4","1/2","3/4","1","1 1/4","1 1/2","2","2 1/2","3","3 1/2","4","5","6","8",
              "10","12","14","16","18","20","22","24","26","28","30","32","34","36","38","40",
              "42","44","46","48"]
V_EXPECTED = [("3 mm","1/8"),("6 mm","1/4"),("10 mm","3/8"),("15 mm","1/2"),("20 mm","3/4"),
              ("25 mm","1"),("32 mm","1 1/4"),("40 mm","1 1/2"),("50 mm","2"),("65 mm","2 1/2"),
              ("80 mm","3"),("100 mm","4"),("125 mm","5"),("150 mm","6"),("200 mm","8"),
              ("250 mm","10"),("300 mm","12"),("350 mm","14"),("400 mm","16"),("450 mm","18"),
              ("500 mm","20"),("600 mm","24")]

h = [(nps,dn,od,parse_pairs(b)) for nps,dn,od,b in h_rows]
v = [(mm,inch,od,parse_pairs(b)) for mm,inch,od,b in v_rows]

if len(h) != 34: errors.append(f"H row count {len(h)} != 34 (user list: 1/4…48 incl. 3 1/2, no 1/8, no 3/8)")
if [r[0] for r in h] != H_EXPECTED:
    errors.append(f"H size order mismatch: {[r[0] for r in h]}")
if [ (r[0],r[1]) for r in v ] != V_EXPECTED:
    errors.append(f"V size order mismatch: {[(r[0],r[1]) for r in v]}")

for nps,dn,od,scheds in h:
    for k,val in scheds.items():
        if k not in H_LABELS: errors.append(f"H {nps}: bad label '{k}'")
        if not re.match(r"^\d+(\.\d+)?$", val): errors.append(f"H {nps} {k}: bad WT '{val}'")
for mm,inch,od,scheds in v:
    for k,val in scheds.items():
        if k not in V_LABELS: errors.append(f"V {mm}/{inch}: bad label '{k}'")
        if not re.match(r"^\d+(\.\d+)?$", val): errors.append(f"V {mm}/{inch} {k}: bad WT '{val}'")

# No 1/8 or 3/8 anywhere in H sizes
if any(r[0] in ("1/8","3/8") for r in h): errors.append("H contains 1/8 or 3/8!")

# Every H schedule label used at least once; same for V
used_h = set(k for _,_,_,s in h for k in s)
used_v = set(k for _,_,_,s in v for k in s)
for lbl in H_LABELS:
    if lbl not in used_h: errors.append(f"H label never used: {lbl}")
for lbl in V_LABELS:
    if lbl not in used_v: errors.append(f"V label never used: {lbl}")

# Spot values from the verified chart
spot_h = {("2","SCH 40"):"3.91", ("2","SCH STD"):"3.91", ("8","SCH 30"):"7.04",
          ("8","SCH 160"):"23.01", ("8","SCH XXS"):"22.23", ("12","SCH 40"):"10.31",
          ("12","SCH 30"):"8.38", ("14","SCH 10"):"6.35", ("22","SCH 60"):"22.23",
          ("24","SCH 160"):"59.54", ("48","SCH STD"):"9.53", ("48","SCH XS"):"12.7",
          ("40","SCH 40"):"12.7", ("40","SCH STD"):"9.53", ("34","SCH 40"):"17.48",
          ("1/4","SCH 40"):"2.24", ("1/4","SCH 80"):"3.02", ("1/2","SCH 160"):"4.78",
          ("6","SCH XXS"):"21.95", ("20","SCH 160"):"50.01"}
spot_v = {("1/8","SCH 10S"):"1.24", ("1/2","SCH 5S"):"1.65", ("1/2","SCH 80S"):"3.73",
          ("2","SCH 40S"):"3.91", ("8","SCH 160S"):"23.01", ("8","SCH XXS"):"22.23",
          ("12","SCH 40S"):"9.53", ("24","SCH 160S"):"59.54", ("3/8","SCH 40S"):"2.31",
          ("10","SCH 5S"):"3.4", ("16","SCH 80S"):"21.44"}
hmap = {r[0]: r[3] for r in h}
vmap = {r[1]: r[3] for r in v}
for (nps,k),exp in spot_h.items():
    got = hmap.get(nps,{}).get(k)
    if got != exp: errors.append(f"SPOT H {nps} {k}: {got} != {exp}")
for (inch,k),exp in spot_v.items():
    got = vmap.get(inch,{}).get(k)
    if got != exp: errors.append(f"SPOT V {inch} {k}: {got} != {exp}")

# OD checks
od_h = {r[0]: r[2] for r in h}
for nps,exp in {"2":"60.3","8":"219.1","12":"323.9","34":"864","48":"1219","22":"559"}.items():
    if od_h.get(nps) != exp: errors.append(f"OD H {nps}: {od_h.get(nps)} != {exp}")

# Weight must never appear as DATA (keys/values are already checked via
# the allowed-label lists; comments explaining the exclusion are fine).
data_text = " ".join(k + "=" + w for _,_,_,s in h + v for k, w in s.items())
for banned in ["Weight", "Kg/m", "kg/m"]:
    if banned in data_text: errors.append(f"forbidden token in DATA: {banned}")

# counts summary
h_sched_count = sum(len(s) for _,_,_,s in h)
v_sched_count = sum(len(s) for _,_,_,s in v)
print(f"H rows: {len(h)} (expect 33), combos: {h_sched_count}")
print(f"V rows: {len(v)} (expect 22), combos: {v_sched_count}")
if errors:
    print(f"\n{len(errors)} ERRORS:")
    for e in errors: print("  ✗", e)
    sys.exit(1)
print("\nAll validations passed ✓")
