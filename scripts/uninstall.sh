#!/usr/bin/env bash
# Remove the Loader row and the package dependency from a DSH profile.
set -euo pipefail
PROFILE="${1:-web}"
PATCH="${DSH_HOME:-$HOME/.dsh}/profiles/${PROFILE}/cordis.patch.yml"

python3 - "$PATCH" <<'PY'
import re
import sys
from pathlib import Path
path = Path(sys.argv[1])
if not path.exists():
    print("patch: absent, nothing to remove")
    raise SystemExit(0)
text = path.read_text()
# Drop a whole `- insert:` block when dutang is its only item, otherwise drop
# only the dutang item and its indented continuation lines.
blocks = re.split(r"(?m)^- ", text)
head = blocks[0]
kept = []
for block in blocks[1:]:
    if "id: dutang" not in block and "name: '@dutang/dsh-plugin-dutang'" not in block:
        kept.append(block)
        continue
    lines = block.splitlines()
    if not lines[0].startswith("insert:"):
        continue  # a row-shaped dutang entry; dropping it is enough
    items = []
    current = None
    for line in lines[1:]:
        if re.match(r"^    - ", line):
            if current is not None:
                items.append(current)
            current = [line]
        elif current is not None and line.startswith("      "):
            current.append(line)
        elif line.strip() == "":
            continue
    if current is not None:
        items.append(current)
    remaining = [item for item in items if "id: dutang" not in "\n".join(item)]
    if remaining:
        kept.append("insert:\n" + "\n".join("\n".join(item) for item in remaining))
path.write_text(head + "".join("- " + block for block in kept))
print(f"patch: removed dutang row from {path}")
PY

dsh plugin --profile "$PROFILE" remove '@dutang/dsh-plugin-dutang' || true
echo
echo "已从 profile ${PROFILE} 卸载；重启 dsh web 生效。"
