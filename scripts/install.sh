#!/usr/bin/env bash
# Install this local plugin into a DSH profile and add its Loader row.
set -euo pipefail
PROFILE="${1:-web}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PATCH="${DSH_HOME:-$HOME/.dsh}/profiles/${PROFILE}/cordis.patch.yml"

dsh plugin --profile "$PROFILE" add "file:$ROOT"

python3 - "$PATCH" <<'PY'
import sys
from pathlib import Path
path = Path(sys.argv[1])
text = path.read_text() if path.exists() else ""
if "@dutang/dsh-plugin-dutang" in text:
    print("patch: dutang row already present")
    raise SystemExit(0)
if text.strip() == "[]":
    text = ""
if text and not text.endswith("\n"):
    text += "\n"
text += """
# 都堂 · 三省六部可信执行台：侧栏面板 + 工具 + /dutang 同源代理
- insert:
    - id: dutang
      name: '@dutang/dsh-plugin-dutang'
      config:
        upstream: http://127.0.0.1:18793
        token: !!js process.env.DUTANG_TOKEN
"""
path.write_text(text)
print(f"patch: wrote {path}")
PY

echo
echo "已安装到 profile: ${PROFILE}"
echo "启动 DSH 前设置 DUTANG_TOKEN，然后重启 dsh web 生效。"
