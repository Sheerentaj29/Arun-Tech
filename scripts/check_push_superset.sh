#!/bin/bash
# Compare GitHub HEAD file list against the outer working tree (the code to be pushed)
set -u
cd /home/z/my-project
git -C Arun-Tech ls-tree -r --name-only HEAD | sort > /tmp/gh_files.txt

echo "=== Full list of GitHub-tracked files MISSING from outer working tree ==="
while IFS= read -r f; do
  [ -e "$f" ] || echo "$f"
done < /tmp/gh_files.txt > /tmp/missing.txt
wc -l /tmp/missing.txt
cat /tmp/missing.txt

echo
echo "=== Logo set comparison (normalize leading space) ==="
cd /home/z/my-project
git -C Arun-Tech ls-tree -r --name-only HEAD -- storage/logos/clients | sed 's|^storage/logos/clients/||; s/^ //' | sort > /tmp/gh_logos.txt
ls storage/logos/clients | sort > /tmp/outer_logos.txt
echo "--- in GitHub but not in outer (normalized):"
comm -23 /tmp/gh_logos.txt /tmp/outer_logos.txt
echo "--- in outer but not in GitHub (normalized):"
comm -13 /tmp/gh_logos.txt /tmp/outer_logos.txt

echo
echo "=== Do the cleaned-name logos in outer match GitHub content byte-for-byte? ==="
cd /home/z/my-project
match=0; diffn=0; missn=0
git -C Arun-Tech ls-tree -r --name-only HEAD -- storage/logos/clients | while IFS= read -r f; do
  base="${f#storage/logos/clients/}"
  clean="${base# }"
  gh_hash=$(git -C Arun-Tech rev-parse "HEAD:$f" 2>/dev/null | cut -c1-8)
  if [ -f "storage/logos/clients/$clean" ]; then
    outer_hash=$(git hash-object "storage/logos/clients/$clean" | cut -c1-8)
    if [ "$gh_hash" = "$outer_hash" ]; then echo "SAME  $clean"; else echo "DIFF  $clean (gh=$gh_hash outer=$outer_hash)"; fi
  else
    echo "MISS  $clean"
  fi
done | sort | uniq -c | awk '{print $1, $2}' | sort | uniq -c
echo "detail:"
git -C Arun-Tech ls-tree -r --name-only HEAD -- storage/logos/clients | while IFS= read -r f; do
  base="${f#storage/logos/clients/}"
  clean="${base# }"
  gh_hash=$(git -C Arun-Tech rev-parse "HEAD:$f" 2>/dev/null | cut -c1-8)
  if [ -f "storage/logos/clients/$clean" ]; then
    outer_hash=$(git hash-object "storage/logos/clients/$clean" | cut -c1-8)
    if [ "$gh_hash" != "$outer_hash" ]; then echo "DIFF  $clean"; fi
  else
    echo "MISS  $clean"
  fi
done | head -20
