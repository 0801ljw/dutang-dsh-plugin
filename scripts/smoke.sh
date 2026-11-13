#!/usr/bin/env bash
# End-to-end smoke: boot a throwaway DSH profile, then verify the /dutang
# auth gate, authenticated panel, and health route.
set -euo pipefail
PROFILE="dutang-smoke-$$"
BASE="${DSH_HOME:-$HOME/.dsh}/profiles"
PORT="${DUTANG_SMOKE_PORT:-49996}"

cleanup() {
  if [[ -n "${PID:-}" ]]; then kill "$PID" 2>/dev/null || true; fi
  rm -rf "$BASE/$PROFILE"
}
trap cleanup EXIT

cp -R "$BASE/web" "$BASE/$PROFILE"
LOG="$(mktemp -t dutang-smoke)"
dsh --profile "$PROFILE" --no-open --port "$PORT" >"$LOG" 2>&1 &
PID=$!

URL=""
for _ in $(seq 1 60); do
  URL="$(grep -oE 'http://127\.0\.0\.1:[0-9]+/\?token=[A-Za-z0-9_-]+' "$LOG" | tail -1 || true)"
  [[ -n "$URL" ]] && break
  sleep 1
done
if [[ -z "$URL" ]]; then
  echo "FAIL: DSH did not print a URL"; tail -20 "$LOG"; exit 1
fi

ROOT="${URL%%/\?token=*}"
JAR="$(mktemp -t dutang-cookies)"
CODE="$(curl -s -o /dev/null -w '%{http_code}' "$ROOT/dutang/")"
[[ "$CODE" == "401" ]] && echo "PASS unauthenticated /dutang -> 401" || { echo "FAIL: unauthenticated -> $CODE"; exit 1; }

curl -s -L -c "$JAR" "$URL" -o /dev/null
CODE="$(curl -s -b "$JAR" -o /dev/null -w '%{http_code}' "$ROOT/dutang/")"
[[ "$CODE" == "200" ]] && echo "PASS authenticated /dutang -> 200" || { echo "FAIL: authenticated -> $CODE"; exit 1; }

HEALTH="$(curl -s -b "$JAR" "$ROOT/dutang/health")"
echo "$HEALTH" | grep -q '"ok"' && echo "PASS /dutang/health -> $HEALTH" || { echo "FAIL: health -> $HEALTH"; exit 1; }

echo "SMOKE OK"
