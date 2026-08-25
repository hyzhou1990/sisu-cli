#!/bin/sh
# Copy tracked SiSu grok-build overlays onto vendor/grok-build.
set -eu
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VENDOR="$ROOT/vendor/grok-build"
MANIFEST="$ROOT/overlays/grok-build/MANIFEST"
OVERLAY="$ROOT/overlays/grok-build"

if [ ! -d "$VENDOR" ]; then
  echo "apply-sisu-grok-overlay: vendor/grok-build missing" >&2
  exit 1
fi
if [ ! -f "$MANIFEST" ]; then
  echo "apply-sisu-grok-overlay: overlays/grok-build/MANIFEST missing" >&2
  exit 1
fi

while IFS= read -r rel || [ -n "$rel" ]; do
  case "$rel" in
    ''|\#*) continue ;;
  esac
  src="$OVERLAY/$rel"
  dest="$VENDOR/$rel"
  if [ ! -f "$src" ]; then
    echo "apply-sisu-grok-overlay: missing overlay $rel" >&2
    exit 1
  fi
  mkdir -p "$(dirname "$dest")"
  cp "$src" "$dest"
done < "$MANIFEST"
echo "applied SiSu overlay onto $VENDOR"
