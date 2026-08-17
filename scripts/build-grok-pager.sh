#!/bin/sh
set -eu
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export PATH="${HOME}/.cargo/bin:/opt/homebrew/bin:${PATH}"
export PROTOC="${PROTOC:-/opt/homebrew/bin/protoc}"
cd "$ROOT/vendor/grok-build"
cargo build -p xai-grok-pager-bin --release
mkdir -p "$ROOT/bin"
cp target/release/xai-grok-pager "$ROOT/bin/xai-grok-pager"
chmod +x "$ROOT/bin/xai-grok-pager"
echo "installed $ROOT/bin/xai-grok-pager"
