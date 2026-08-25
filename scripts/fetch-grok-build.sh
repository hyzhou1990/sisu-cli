#!/bin/sh
# Fetch the pinned public grok-build tree and apply the tracked SiSu overlay.
set -eu
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PIN="$ROOT/vendor/grok-build.pin"
VENDOR="$ROOT/vendor/grok-build"

repo=""
commit=""
while IFS='=' read -r key value || [ -n "$key" ]; do
  case "$key" in
    ''|\#*) continue ;;
    repo) repo=$value ;;
    commit) commit=$value ;;
  esac
done < "$PIN"

if [ -z "$repo" ] || [ -z "$commit" ]; then
  echo "fetch-grok-build: vendor/grok-build.pin missing repo/commit" >&2
  exit 1
fi

mkdir -p "$ROOT/vendor"
if [ ! -d "$VENDOR/.git" ]; then
  rm -rf "$VENDOR"
  git clone --filter=blob:none "$repo" "$VENDOR"
fi
git -C "$VENDOR" fetch --depth=1 origin "$commit"
git -C "$VENDOR" checkout --force --detach "$commit"
sh "$ROOT/scripts/apply-sisu-grok-overlay.sh"
