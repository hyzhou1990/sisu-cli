#!/bin/sh
# Refresh overlays/grok-build from the working vendor tree.
set -eu
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VENDOR="$ROOT/vendor/grok-build"
MANIFEST="$ROOT/overlays/grok-build/MANIFEST"
OVERLAY="$ROOT/overlays/grok-build"

if [ ! -d "$VENDOR" ]; then
  echo "snapshot-sisu-grok-overlay: vendor/grok-build missing" >&2
  exit 1
fi

while IFS= read -r rel || [ -n "$rel" ]; do
  case "$rel" in
    ''|\#*) continue ;;
  esac
  src="$VENDOR/$rel"
  dest="$OVERLAY/$rel"
  if [ ! -f "$src" ]; then
    echo "snapshot-sisu-grok-overlay: missing vendor file $rel" >&2
    exit 1
  fi
  mkdir -p "$(dirname "$dest")"
  cp "$src" "$dest"
done < "$MANIFEST"
echo "snapshotted overlay from $VENDOR"
