#!/bin/sh
set -eu
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export PATH="${HOME}/.cargo/bin:/opt/homebrew/bin:${PATH}"
export PROTOC="${PROTOC:-/opt/homebrew/bin/protoc}"
OVERLAY="$ROOT/overlays/grok-build"
VENDOR="$ROOT/vendor/grok-build"
if [ -d "$OVERLAY" ]; then
  find "$OVERLAY" -type f | while IFS= read -r src; do
    rel="${src#"$OVERLAY"/}"
    mkdir -p "$VENDOR/$(dirname "$rel")"
    cp "$src" "$VENDOR/$rel"
  done
fi
cd "$VENDOR"
cargo build -p xai-grok-pager-bin --release
mkdir -p "$ROOT/bin"
cp target/release/xai-grok-pager "$ROOT/bin/xai-grok-pager"
chmod +x "$ROOT/bin/xai-grok-pager"
echo "installed $ROOT/bin/xai-grok-pager"
