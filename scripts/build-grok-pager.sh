#!/bin/sh
# Build xai-grok-pager and optionally package a GitHub Release .br asset.
#
# Env:
#   PLATFORM_KEY  install-pager key (default: host uname → darwin-arm64|darwin-x64|linux-x64|linux-arm64)
#   CARGO_TARGET  rustc target triple (optional; enables cross-compile when toolchain present)
#   PACKAGE_BR=1  also write bin/xai-grok-pager-${PLATFORM_KEY}.br (default 1)
#   INSTALL_HOME=1  also stamp into ~/.sisu/bin (default 1)
#
# Cross builds (linux-*, darwin-x64 on arm64 Mac) need matching rustup targets / linkers.
# Do not invent placeholder .br files — omit the asset until a real binary exists.
set -eu
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export PATH="${HOME}/.cargo/bin:/opt/homebrew/bin:/usr/local/bin:${PATH}"
export PROTOC="${PROTOC:-${HOMEBREW_PREFIX:-/opt/homebrew}/bin/protoc}"
if [ ! -x "$PROTOC" ]; then
  PROTOC="$(command -v protoc || true)"
fi
export PROTOC

host_platform_key() {
  os="$(uname -s | tr '[:upper:]' '[:lower:]')"
  arch="$(uname -m)"
  case "$os" in
    darwin) os=darwin ;;
    linux) os=linux ;;
    *) echo "unsupported host OS: $os" >&2; exit 1 ;;
  esac
  case "$arch" in
    arm64|aarch64) arch=arm64 ;;
    x86_64|amd64) arch=x64 ;;
    *) echo "unsupported host arch: $arch" >&2; exit 1 ;;
  esac
  printf '%s-%s\n' "$os" "$arch"
}

PLATFORM_KEY="${PLATFORM_KEY:-$(host_platform_key)}"
PACKAGE_BR="${PACKAGE_BR:-1}"
INSTALL_HOME="${INSTALL_HOME:-1}"

case "$PLATFORM_KEY" in
  darwin-arm64|darwin-x64|linux-x64|linux-arm64) ;;
  *)
    echo "unsupported PLATFORM_KEY=$PLATFORM_KEY (want darwin-arm64|darwin-x64|linux-x64|linux-arm64)" >&2
    exit 1
    ;;
esac

cd "$ROOT/vendor/grok-build"
if [ -n "${CARGO_TARGET:-}" ]; then
  cargo build -p xai-grok-pager-bin --release --target "$CARGO_TARGET"
  BIN_SRC="target/${CARGO_TARGET}/release/xai-grok-pager"
else
  cargo build -p xai-grok-pager-bin --release
  BIN_SRC="target/release/xai-grok-pager"
fi

mkdir -p "$ROOT/bin"
cp "$BIN_SRC" "$ROOT/bin/xai-grok-pager"
chmod +x "$ROOT/bin/xai-grok-pager"
echo "installed $ROOT/bin/xai-grok-pager (platform ${PLATFORM_KEY})"

VERSION="$(node -p "require('${ROOT}/package.json').version")"

if [ "$PACKAGE_BR" = "1" ]; then
  BR_OUT="$ROOT/bin/xai-grok-pager-${PLATFORM_KEY}.br"
  node -e "
    const fs = require('fs');
    const zlib = require('zlib');
    const src = process.argv[1];
    const dest = process.argv[2];
    const raw = fs.readFileSync(src);
    fs.writeFileSync(dest, zlib.brotliCompressSync(raw, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11 } }));
  " "$ROOT/bin/xai-grok-pager" "$BR_OUT"
  echo "packaged ${BR_OUT}"
fi

if [ "$INSTALL_HOME" = "1" ]; then
  DEST="${SISU_HOME:-$HOME/.sisu}/bin/xai-grok-pager"
  mkdir -p "$(dirname "$DEST")"
  cp "$ROOT/bin/xai-grok-pager" "$DEST"
  chmod +x "$DEST"
  printf '%s\n' "$VERSION" > "${DEST}.version"
  echo "installed ${DEST} (stamp ${VERSION})"
fi
