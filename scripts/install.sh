#!/usr/bin/env bash
# SiSu CLI installer. No sudo. Never installs a system Node via OS packages.
# macOS / Linux / WSL:
#   curl -fsSL https://www.sisu.chat/install.sh | bash && export PATH="$HOME/.sisu/bin:$PATH"
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
  local show_progress="${3:-0}"
  if need_cmd curl; then
    if [ "$show_progress" = 1 ]; then
      curl -fL -# "$url" -o "$dest"
    else
      curl -fsSL "$url" -o "$dest"
    fi
  elif need_cmd wget; then
    if [ "$show_progress" = 1 ]; then
      wget --progress=bar:force -O "$dest" "$url"
    else
      wget -qO "$dest" "$url"
    fi
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
  log "downloading Node ${SISU_NODE_VERSION} (~30MB)"
  download "$url" "${tmp}/${tarball}" 1
  download "${SISU_NODE_DIST}/v${SISU_NODE_VERSION}/SHASUMS256.txt" "${tmp}/SHASUMS256.txt"
  log "verifying Node checksum"
  verify_sha256 "$tmp" "$tarball"
  log "extracting Node"
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

link_bin() {
  local src="$1"
  local name="$2"
  ln -sfn "$src" "${SISU_HOME}/bin/${name}"
  ln -sfn "$src" "${HOME}/.local/bin/${name}"
}

# curl|bash cannot export PATH into the parent shell. Put shims in a directory
# that is already on PATH (root AutoDL: /usr/local/bin) so `sisu` works now.
first_live_bin_dir() {
  local dir preferred
  for preferred in /opt/homebrew/bin /usr/local/bin; do
    if [ -d "$preferred" ] && [ -w "$preferred" ]; then
      case ":${PATH}:" in
        *":${preferred}:"*) printf '%s\n' "$preferred"; return 0 ;;
      esac
    fi
  done
  local IFS=':'
  for dir in $PATH; do
    [ -n "$dir" ] || continue
    case "$dir" in
      .|./.*|/sbin|/usr/sbin|/usr/local/sbin) continue ;;
    esac
    [ -d "$dir" ] && [ -w "$dir" ] || continue
    printf '%s\n' "$dir"
    return 0
  done
  return 1
}

ours_or_missing() {
  local dest="$1"
  if [ ! -e "$dest" ] && [ ! -L "$dest" ]; then
    return 0
  fi
  if [ -L "$dest" ]; then
    case "$(readlink "$dest" 2>/dev/null || true)" in
      "${SISU_HOME}"/*) return 0 ;;
    esac
  fi
  return 1
}

live_link() {
  local src="$1"
  local name="$2"
  local force="${3:-0}"
  local dir dest
  dir="$(first_live_bin_dir)" || return 1
  dest="${dir}/${name}"
  if [ "$force" != 1 ] && ! ours_or_missing "$dest"; then
    return 1
  fi
  ln -sfn "$src" "$dest"
  printf '%s\n' "$dest"
}

link_live_commands() {
  local dest
  [ -e "${SISU_HOME}/bin/sisu" ] || [ -L "${SISU_HOME}/bin/sisu" ] || return 0
  dest="$(live_link "${SISU_HOME}/bin/sisu" sisu 1)" || return 0
  LIVE_PATH_CMD="$dest"
  log "on PATH -> ${dest}"
  if [ -x "${SISU_HOME}/node/bin/node" ]; then
    live_link "${SISU_HOME}/node/bin/node" node 0 >/dev/null || true
    live_link "${SISU_HOME}/node/bin/npm" npm 0 >/dev/null || true
    if [ -x "${SISU_HOME}/node/bin/npx" ]; then
      live_link "${SISU_HOME}/node/bin/npx" npx 0 >/dev/null || true
    fi
    live_link "${SISU_HOME}/node/bin/npm" nmp 0 >/dev/null || true
  fi
}

link_private_node_bins() {
  [ -x "${SISU_HOME}/node/bin/node" ] || return 0
  mkdir -p "${SISU_HOME}/bin" "${HOME}/.local/bin"
  link_bin "${SISU_HOME}/node/bin/node" node
  link_bin "${SISU_HOME}/node/bin/npm" npm
  if [ -x "${SISU_HOME}/node/bin/npx" ]; then
    link_bin "${SISU_HOME}/node/bin/npx" npx
  fi
  # Common typo: nmp → npm
  link_bin "${SISU_HOME}/node/bin/npm" nmp
}

ensure_user_path() {
  mkdir -p "${HOME}/.local/bin" "${SISU_HOME}/bin"
  if [ -e "${SISU_HOME}/bin/sisu" ] || [ -L "${SISU_HOME}/bin/sisu" ]; then
    ln -sfn "${SISU_HOME}/bin/sisu" "${HOME}/.local/bin/sisu"
  fi
  local block export_line rc
  export_line="export PATH=\"${SISU_HOME}/bin:${SISU_HOME}/node/bin:${HOME}/.local/bin:\$PATH\""
  block="# sisu-cli
${export_line}
# sisu-cli end"
  for rc in "${HOME}/.zprofile" "${HOME}/.zshrc" "${HOME}/.bash_profile" "${HOME}/.bashrc"; do
    if [ ! -f "$rc" ]; then
      case "$rc" in
        "${HOME}/.zshrc"|"${HOME}/.zprofile") touch "$rc" ;;
        *) continue ;;
      esac
    fi
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
}

main() {
  mkdir -p "$SISU_HOME"
  log "installing ${SISU_NPM_PACKAGE} into ${SISU_HOME}"
  local npm
  npm="$(resolve_npm)"
  if [ -x "${SISU_HOME}/node/bin/node" ]; then
    export PATH="${SISU_HOME}/node/bin:${PATH}"
    export npm_config_scripts_prepend_node_path=true
  fi
  log "npm -> ${npm}"
  log "installing package (this may take a minute)"
  "$npm" install -g --prefix "$SISU_HOME" "$SISU_NPM_PACKAGE"
  link_private_node_bins
  link_live_commands
  ensure_user_path
  if [ -x "${SISU_HOME}/bin/sisu" ]; then
    log "command -> ${SISU_HOME}/bin/sisu"
  fi
  if [ -n "${LIVE_PATH_CMD:-}" ]; then
    log "next: sisu login && sisu"
  elif [ -x "${SISU_HOME}/bin/sisu" ]; then
    log "this shell: export PATH=\"${SISU_HOME}/bin:\$PATH\" && hash -r && sisu login"
  else
    log "next: sisu login && sisu"
  fi
}

if [ "${SISU_INSTALL_LIB:-}" != 1 ]; then
  main "$@"
fi
