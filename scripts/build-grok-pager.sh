#!/bin/sh
# Build xai-grok-pager and optionally package a GitHub Release .br asset.
#
# Env:
#   PLATFORM_KEY  install-pager key (default: host uname →
#                 darwin-arm64|darwin-x64|linux-x64|linux-arm64|win32-x64)
#   CARGO_TARGET  rustc target triple (optional; enables cross-compile when toolchain present)
#   PACKAGE_BR=1  also write bin/xai-grok-pager-${PLATFORM_KEY}.br (default 1)
#   INSTALL_HOME=1  also stamp into ~/.sisu/bin (default 1)
#
# Cross builds (linux-*, darwin-x64 on arm64 Mac) need matching rustup targets / linkers.
# Windows is native MSVC on windows-latest (xai-grok-pager.exe).
# Do not invent placeholder .br files — omit the asset until a real binary exists.
set -eu
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export PATH="${HOME}/.cargo/bin:/opt/homebrew/bin:/usr/local/bin:${PATH}"
export PROTOC="${PROTOC:-${HOMEBREW_PREFIX:-/opt/homebrew}/bin/protoc}"
if [ ! -x "$PROTOC" ] && [ ! -f "$PROTOC" ]; then
  PROTOC="$(command -v protoc || command -v protoc.exe || true)"
fi
export PROTOC

host_platform_key() {
  os="$(uname -s | tr '[:upper:]' '[:lower:]')"
  arch="$(uname -m)"
  case "$os" in
    darwin) os=darwin ;;
    linux) os=linux ;;
    mingw*|msys*|cygwin*|windows_nt*) os=win32 ;;
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
  darwin-arm64|darwin-x64|linux-x64|linux-arm64|win32-x64) ;;
  *)
    echo "unsupported PLATFORM_KEY=$PLATFORM_KEY (want darwin-arm64|darwin-x64|linux-x64|linux-arm64|win32-x64)" >&2
    exit 1
    ;;
esac

BIN_EXT=""
case "$PLATFORM_KEY" in
  win32-*) BIN_EXT=".exe" ;;
esac

if [ -x "$ROOT/scripts/apply-sisu-grok-overlay.sh" ]; then
  "$ROOT/scripts/apply-sisu-grok-overlay.sh"
elif [ -d "$ROOT/overlays/grok-build" ] && [ -d "$ROOT/vendor/grok-build" ]; then
  find "$ROOT/overlays/grok-build" -type f | while IFS= read -r src; do
    rel="${src#"$ROOT/overlays/grok-build"/}"
    mkdir -p "$ROOT/vendor/grok-build/$(dirname "$rel")"
    cp "$src" "$ROOT/vendor/grok-build/$rel"
  done
fi

if [ -n "$BIN_EXT" ]; then
  # grok-build ships a unix dotslash wrapper at bin/protoc (Win32 error 193).
  rm -f "$ROOT/vendor/grok-build/bin/protoc"
  # xai-proto-build emit_rerun_if_changed uses --dependency_out=/dev/stdout
  # and --descriptor_set_out=/dev/null. Windows protoc cannot open those.
  # Skip the cargo:rerun walk on Windows; prost-build still compiles.
  proto_rs="$ROOT/vendor/grok-build/crates/build/xai-proto-build/src/lib.rs"
  node -e '
    const fs = require("fs");
    const file = process.argv[1];
    const src = fs.readFileSync(file, "utf8");
    if (src.includes("SiSu win32-x64: skip emit_rerun_if_changed")) process.exit(0);
    const needle = "        let includes = Vec::from_iter(includes);\n";
    const insert =
      needle +
      "        // SiSu win32-x64: skip emit_rerun_if_changed (/dev/stdout is not a file).\n" +
      "        if cfg!(windows) {\n" +
      "            return Ok(());\n" +
      "        }\n";
    if (!src.includes(needle)) {
      console.error("build-grok-pager: missing xai-proto-build patch point");
      process.exit(1);
    }
    fs.writeFileSync(file, src.replace(needle, insert));
  ' "$proto_rs"
  proto_bin="$(command -v protoc.exe || command -v protoc || true)"
  if [ -z "$proto_bin" ]; then
    echo "build-grok-pager: protoc not on PATH" >&2
    exit 1
  fi
  if command -v cygpath >/dev/null 2>&1; then
    PROTOC="$(cygpath -w "$proto_bin")"
  else
    PROTOC="$proto_bin"
  fi
  export PROTOC
  echo "using PROTOC=$PROTOC"
fi

cd "$ROOT/vendor/grok-build"
if [ -n "${CARGO_TARGET:-}" ]; then
  cargo build -p xai-grok-pager-bin --release --target "$CARGO_TARGET"
  BIN_SRC="target/${CARGO_TARGET}/release/xai-grok-pager${BIN_EXT}"
else
  cargo build -p xai-grok-pager-bin --release
  BIN_SRC="target/release/xai-grok-pager${BIN_EXT}"
fi

if [ ! -f "$BIN_SRC" ]; then
  echo "build-grok-pager: missing $BIN_SRC" >&2
  exit 1
fi

mkdir -p "$ROOT/bin"
cp "$BIN_SRC" "$ROOT/bin/xai-grok-pager${BIN_EXT}"
chmod +x "$ROOT/bin/xai-grok-pager${BIN_EXT}" 2>/dev/null || true
echo "installed $ROOT/bin/xai-grok-pager${BIN_EXT} (platform ${PLATFORM_KEY})"

# Windows Node cannot require() Git-bash paths like /d/a/.../package.json.
cd "$ROOT"
VERSION="$(node -p "require('./package.json').version")"

if [ "$PACKAGE_BR" = "1" ]; then
  BR_OUT="bin/xai-grok-pager-${PLATFORM_KEY}.br"
  node -e "
    const fs = require('fs');
    const zlib = require('zlib');
    const src = process.argv[1];
    const dest = process.argv[2];
    const raw = fs.readFileSync(src);
    fs.writeFileSync(dest, zlib.brotliCompressSync(raw, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11 } }));
  " "bin/xai-grok-pager${BIN_EXT}" "$BR_OUT"
  echo "packaged ${ROOT}/${BR_OUT}"
fi

if [ "$INSTALL_HOME" = "1" ]; then
  DEST="${SISU_HOME:-$HOME/.sisu}/bin/xai-grok-pager${BIN_EXT}"
  mkdir -p "$(dirname "$DEST")"
  cp "$ROOT/bin/xai-grok-pager${BIN_EXT}" "$DEST"
  chmod +x "$DEST" 2>/dev/null || true
  printf '%s\n' "$VERSION" > "${DEST}.version"
  echo "installed ${DEST} (stamp ${VERSION})"
fi
