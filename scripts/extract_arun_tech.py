#!/usr/bin/env python3
"""Extract everything from the Arun-Tech repo clone into download/ outputs."""
import os, re, subprocess, datetime

REPO = "/home/z/my-project/Arun-Tech"
OUT = "/home/z/my-project/download/Arun-Tech-extraction"
os.makedirs(OUT, exist_ok=True)

def run(cmd, **kw):
    return subprocess.run(cmd, shell=True, capture_output=True, text=True, cwd=REPO, **kw).stdout

# ---------- collect tracked files ----------
tracked = run("git ls-files").strip().split("\n")
tracked = [f for f in tracked if f.strip()]

def build_tree(files):
    """Render an ASCII tree from a flat file list."""
    root = {}
    for f in sorted(files):
        parts = f.split("/")
        node = root
        for i, p in enumerate(parts[:-1]):
            node = node.setdefault(p + "/", {})
        node.setdefault(parts[-1], None)  # file

    lines = ["Arun-Tech/"]
    def walk(node, prefix, dir_path):
        dirs = sorted(k for k in node if k.endswith("/"))
        files_k = sorted(k for k in node if not k.endswith("/"))
        entries = dirs + files_k
        for i, name in enumerate(entries):
            last = (i == len(entries) - 1)
            branch = "`-- " if last else "|-- "
            child = node[name]
            if isinstance(child, dict):
                n_files = count_files(child)
                lines.append(f"{prefix}{branch}{name}  ({n_files} files)")
                walk(child, prefix + ("    " if last else "|   "), dir_path + name)
            else:
                size = os.path.getsize(os.path.join(REPO, dir_path + name)) if os.path.exists(os.path.join(REPO, dir_path + name)) else 0
                lines.append(f"{prefix}{branch}{name}  [{fmt_size(size)}]")
    def count_files(node):
        n = 0
        for k, v in node.items():
            n += count_files(v) if isinstance(v, dict) else 1
        return n
    def fmt_size(b):
        if b >= 1024*1024: return f"{b/1024/1024:.1f} MB"
        if b >= 1024: return f"{b/1024:.0f} KB"
        return f"{b} B"
    walk(root, "", "")
    return lines

# ---------- 1. FILE_TREE.txt ----------
tree_lines = build_tree(tracked)
with open(f"{OUT}/01_FILE_TREE.txt", "w") as fh:
    fh.write("Arun-Tech repository - FULL FILE TREE (all %d tracked files)\n" % len(tracked))
    fh.write("Source: https://github.com/Sheerentaj29/Arun-Tech.git  |  branch: main\n")
    fh.write("Generated: %s\n\n" % datetime.datetime.now().strftime("%Y-%m-%d %H:%M"))
    fh.write("\n".join(tree_lines) + "\n")

# ---------- 2. REPO_STATS.txt ----------
ext_counts = {}
for f in tracked:
    ext = os.path.splitext(f)[1].lower() or "(none)"
    ext_counts[ext] = ext_counts.get(ext, 0) + 1
loc_ts = run("git ls-files '*.ts' '*.tsx' | xargs wc -l 2>/dev/null | tail -1").strip().split()[0]
stats = []
stats.append("ARUN-TECH REPOSITORY EXTRACTION - STATS")
stats.append("=" * 60)
stats.append("Repo URL        : https://github.com/Sheerentaj29/Arun-Tech.git")
stats.append("Default branch  : main")
stats.append("Total commits   : %s" % run("git rev-list --count HEAD").strip())
stats.append("Tracked files   : %d" % len(tracked))
stats.append("Repo size       : 168 MB (incl. .git 78 MB)")
stats.append("Working tree    : ~90 MB (storage 48 MB, db/staging-pg 32 MB, upload 6 MB, code ~3 MB)")
stats.append("TS/TSX lines    : %s" % loc_ts)
stats.append("Last commit     : %s" % run("git log -1 --format='%ad  %s'").strip())
stats.append("")
stats.append("FILES BY EXTENSION")
stats.append("-" * 60)
for ext, n in sorted(ext_counts.items(), key=lambda x: -x[1]):
    stats.append(f"  {ext:<12} {n:>5}")
stats.append("")
stats.append("API ROUTES (57 total)")
stats.append("-" * 60)
routes = run("git ls-files 'src/app/api/**/route.ts'").strip().split("\n")
for r in sorted(routes):
    stats.append("  /" + r.replace("src/app/api/", "").replace("/route.ts", ""))
stats.append("")
stats.append("PRISMA MODELS (18)")
stats.append("-" * 60)
schema = open(f"{REPO}/prisma/schema.prisma").read()
for m in re.findall(r"^model (\w+)", schema, re.M):
    stats.append("  model " + m)
stats.append("")
stats.append("BUSINESS VIEW COMPONENTS (17)")
stats.append("-" * 60)
views = run("ls src/components/views/").strip().split("\n")
for v in views:
    stats.append("  " + v)
stats.append("")
stats.append("TOP-LEVEL DIRECTORIES / SIZES")
stats.append("-" * 60)
stats.append(run("du -sh .git db storage upload src prisma scripts docs tests examples mini-services public tool-results .zscripts 2>/dev/null").rstrip())
with open(f"{OUT}/02_REPO_STATS.txt", "w") as fh:
    fh.write("\n".join(stats) + "\n")

# ---------- 3. COMMITS.txt ----------
log = run("git log --format='%h | %ad | %s' --date=format:'%Y-%m-%d %H:%M'")
with open(f"{OUT}/03_COMMIT_HISTORY.txt", "w") as fh:
    fh.write("ARUN-TECH - FULL COMMIT HISTORY (61 commits, branch: main)\n")
    fh.write("=" * 60 + "\n")
    fh.write("hash | date | message\n\n")
    fh.write(log)

# ---------- 4. KEY_FILES.txt (configs, .env redacted) ----------
key_files = [
    "package.json", "next.config.ts", "tsconfig.json", "tailwind.config.ts",
    "postcss.config.mjs", "components.json", "eslint.config.mjs",
    "Caddyfile", ".gitignore", "public/robots.txt", "docs/restore-procedure.md",
]
chunks = ["ARUN-TECH - KEY CONFIGURATION & DOC FILE CONTENTS", "=" * 60, ""]
for kf in key_files:
    path = os.path.join(REPO, kf)
    if not os.path.exists(path):
        continue
    chunks.append("-" * 60)
    chunks.append(f"FILE: {kf}")
    chunks.append("-" * 60)
    chunks.append(open(path).read())
    chunks.append("")
# .env with values redacted
chunks.append("-" * 60)
chunks.append("FILE: .env  (VALUES REDACTED FOR SECURITY)")
chunks.append("-" * 60)
chunks.append(re.sub(r"=(.*)", "= [REDACTED]", open(f"{REPO}/.env").read()))
with open(f"{OUT}/04_KEY_FILE_CONTENTS.txt", "w") as fh:
    fh.write("\n".join(chunks) + "\n")

# ---------- 5. DATABASE_SCHEMA.txt ----------
chunks = ["ARUN-TECH - DATABASE SCHEMA (Prisma) + SQL MIGRATIONS", "=" * 60, ""]
chunks.append("FILE: prisma/schema.prisma")
chunks.append("-" * 60)
chunks.append(open(f"{REPO}/prisma/schema.prisma").read())
for mig in ["prisma/migrations/0001_initial_schema.sql", "prisma/migrations/0002_immutable_approved_revisions.sql"]:
    p = os.path.join(REPO, mig)
    if os.path.exists(p):
        chunks.append("")
        chunks.append(f"FILE: {mig}")
        chunks.append("-" * 60)
        chunks.append(open(p).read())
with open(f"{OUT}/05_DATABASE_SCHEMA.txt", "w") as fh:
    fh.write("\n".join(chunks) + "\n")

# ---------- 6. WORKLOG copy ----------
src_wl = open(f"{REPO}/worklog.md").read()
with open(f"{OUT}/06_PROJECT_WORKLOG.md", "w") as fh:
    fh.write(src_wl)

print("Extraction outputs written to", OUT)
for f in sorted(os.listdir(OUT)):
    print("  ", f, os.path.getsize(os.path.join(OUT, f)), "bytes")
