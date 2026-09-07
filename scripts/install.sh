#!/usr/bin/env bash
# SiSu CLI installer. No sudo. Never installs a system Node via OS packages.
# macOS / Linux / WSL:
#   curl -fsSL https://www.sisu.chat/install.sh | bash
set -euo pipefail

SISU_NPM_PACKAGE="${SISU_NPM_PACKAGE:-@stevezhou/sisu}"
SISU_NODE_VERSION="${SISU_NODE_VERSION:-22.23.2}"
SISU_NODE_DIST="${SISU_NODE_DIST:-https://nodejs.org/dist}"
SISU_HOME="${SISU_HOME:-${HOME}/.sisu}"

log() { printf 'sisu: %s\n' "$*" >&2; }
die() { printf 'sisu: %s\n' "$*" >&2; exit 1; }

need_cmd() { command -v "$1" >/dev/null 2>&1; }

download() {
  local url="$1"
  local dest="$2"
  if need_cmd curl; then
    curl -fsSL "$url" -o "$dest"
  elif need_cmd wget; then
    wget -qO "$dest" "$url"
  else
    die "need curl or wget"
  fi
}

platform_key() {
  local os arch
  os="$(uname -s)"
  arch="$(uname -m)"
  case "$os" in
    Darwin)
      case "$arch" in
        arm64) printf 'darwin-arm64\n' ;;
        x86_64) printf 'darwin-x64\n' ;;
        *) die "unsupported macOS arch: $arch" ;;
      esac
      ;;
    Linux)
      case "$arch" in
        x86_64) printf 'linux-x64\n' ;;
        aarch64|arm64) printf 'linux-arm64\n' ;;
        *) die "unsupported Linux arch: $arch" ;;
      esac
      ;;
    MINGW*|MSYS*|CYGWIN*)
      die "on Windows use: irm https://www.sisu.chat/install.ps1 | iex"
      ;;
    *) die "unsupported OS: $os" ;;
  esac
}

node_major() {
  local bin="$1"
  "$bin" -p "process.versions.node.split('.')[0]" 2>/dev/null || printf '0\n'
}

usable_system_node() {
  local bin major
  bin="$(command -v node 2>/dev/null || true)"
  [ -n "$bin" ] || return 1
  major="$(node_major "$bin")"
  case "$major" in
    ''|*[!0-9]*) return 1 ;;
  esac
  [ "$major" -ge 20 ]
}

verify_sha256() {
  local dir="$1"
  local name="$2"
  if need_cmd shasum; then
    (cd "$dir" && grep "  ${name}\$" SHASUMS256.txt | shasum -a 256 -c -) >&2
  elif need_cmd sha256sum; then
    (cd "$dir" && grep "  ${name}\$" SHASUMS256.txt | sha256sum -c -) >&2
  else
    die "need shasum or sha256sum to verify Node"
  fi
}

install_private_node() {
  local key tarball url tmp
  key="$(platform_key)"
  tarball="node-v${SISU_NODE_VERSION}-${key}.tar.gz"
  url="${SISU_NODE_DIST}/v${SISU_NODE_VERSION}/${tarball}"
  tmp="$(mktemp -d "${TMPDIR:-/tmp}/sisu-node.XXXXXX")"
  log "installing Node ${SISU_NODE_VERSION} into ${SISU_HOME}/node (user-local, not system npm)"
  download "$url" "${tmp}/${tarball}"
  download "${SISU_NODE_DIST}/v${SISU_NODE_VERSION}/SHASUMS256.txt" "${tmp}/SHASUMS256.txt"
  verify_sha256 "$tmp" "$tarball"
  tar -xzf "${tmp}/${tarball}" -C "$tmp"
  mkdir -p "$SISU_HOME"
  rm -rf "${SISU_HOME}/node"
  mv "${tmp}/node-v${SISU_NODE_VERSION}-${key}" "${SISU_HOME}/node"
  rm -rf "$tmp"
  [ -x "${SISU_HOME}/node/bin/npm" ] || die "private Node is missing npm"
}

resolve_npm() {
  if [ -x "${SISU_HOME}/node/bin/npm" ]; then
    printf '%s\n' "${SISU_HOME}/node/bin/npm"
    return
  fi
  if usable_system_node && need_cmd npm; then
    command -v npm
    return
  fi
  install_private_node
  printf '%s\n' "${SISU_HOME}/node/bin/npm"
}

link_private_node_bins() {
  [ -x "${SISU_HOME}/node/bin/node" ] || return 0
  mkdir -p "${SISU_HOME}/bin"
  ln -sfn "${SISU_HOME}/node/bin/node" "${SISU_HOME}/bin/node"
  ln -sfn "${SISU_HOME}/node/bin/npm" "${SISU_HOME}/bin/npm"
}

ensure_user_path() {
  mkdir -p "${HOME}/.local/bin" "${SISU_HOME}/bin"
  if [ -e "${SISU_HOME}/bin/sisu" ] || [ -L "${SISU_HOME}/bin/sisu" ]; then
    ln -sfn "${SISU_HOME}/bin/sisu" "${HOME}/.local/bin/sisu"
  fi
  local block export_line rc
  export_line="export PATH=\"${SISU_HOME}/bin:${HOME}/.local/bin:\$PATH\""
  block="# sisu-cli
${export_line}
# sisu-cli end"
  for rc in "${HOME}/.zprofile" "${HOME}/.zshrc" "${HOME}/.bash_profile" "${HOME}/.bashrc"; do
    [ -f "$rc" ] || continue
    grep -q '# sisu-cli$' "$rc" 2>/dev/null && continue
    printf '\n%s\n' "$block" >> "$rc"
    log "added PATH to ${rc}"
  done
  if [ ! -f "${HOME}/.profile" ] || ! grep -q '# sisu-cli$' "${HOME}/.profile" 2>/dev/null; then
    printf '\n%s\n' "$block" >> "${HOME}/.profile"
    log "added PATH to ${HOME}/.profile"
  fi
  if [ ! -f "${HOME}/.zprofile" ] || ! grep -q '# sisu-cli$' "${HOME}/.zprofile" 2>/dev/null; then
    printf '\n%s\n' "$block" >> "${HOME}/.zprofile"
    log "added PATH to ${HOME}/.zprofile"
  fi
  case ":${PATH}:" in
    *":${SISU_HOME}/bin:"*|*:${HOME}/.local/bin:*) ;;
    *)
      log "if \`sisu\` is not found in this shell, run:"
      log "  ${export_line} && hash -r"
      ;;
  esac
}

main() {
  mkdir -p "$SISU_HOME"
  local npm
  npm="$(resolve_npm)"
  log "npm -> ${npm}"
  "$npm" install -g --prefix "$SISU_HOME" "$SISU_NPM_PACKAGE"
  link_private_node_bins
  ensure_user_path
  if [ -x "${SISU_HOME}/bin/sisu" ]; then
    log "command -> ${SISU_HOME}/bin/sisu"
  fi
  log "next: sisu login && sisu"
}

main "$@"
