# sisu

Official publish channel for the SiSu CLI npm package.

One login. Cloud quota. Local runtime. Auth lives in `~/.sisu`, shared with SiSu Desktop. SiSu cloud is device login, the runtime catalog (`GET /api/runtime/v1/models`), and billed completions (`POST /api/runtime/v1/chat/completions`). Workspace tools stay on the machine. Sessions are local under `~/.sisu/sessions`.

## Install

macOS / Linux / WSL:

```bash
curl -fsSL https://www.sisu.chat/install.sh | bash
sisu login
sisu
```

Windows PowerShell:

```powershell
irm https://www.sisu.chat/install.ps1 | iex
sisu login
sisu
```

Windows CMD:

```bat
curl -fsSL https://www.sisu.chat/install.cmd -o install.cmd && install.cmd && del install.cmd
```

The installer does **not** apt/brew/winget a system Node. If `node` ≥ 20 is already on PATH, it uses that. Otherwise it unpacks official Node 22 into `~/.sisu/node` (user-local, no sudo) and `npm install -g --prefix ~/.sisu @stevezhou/sisu`. Unix gets `~/.sisu/bin` plus a `~/.local/bin/sisu` link; Windows adds `~/.sisu` to the user PATH.

Already have Node 20+ and prefer npm:

```bash
npm install -g @stevezhou/sisu
```

Postinstall also puts `sisu` on a PATH users actually have: `~/.local/bin` on Unix, `%LOCALAPPDATA%\sisu\bin` on Windows (wrappers that call npm's `sisu.cmd`, plus a Git Bash `sisu`). If this shell still cannot see the command, it prints `export PATH=...` (Unix) or `set PATH=` / `$env:Path` (Windows). `npm install -g` is a small JS package. It also fetches the stamped SiSu TUI pager for **this package version** into `~/.sisu/bin` when a prebuilt exists. GitHub Release tags ship `darwin-arm64`, `linux-x64`, and `linux-arm64`. `darwin-x64` is opt-in (`workflow_dispatch` with `platforms` containing `darwin-x64`) and often missing; platforms without a binary, or a missing GitHub Release asset, keep the Node TUI.

`npx sisu` works without a global install.

`sisu update` reinstalls that stamped pager for the installed CLI version. It is not a grok-style background auto-updater.

## Login

```bash
sisu login
sisu login --code <grant>
sisu login --email you@example.com --password '…'
sisu login --token <jwt>
sisu status
```

Default API is `https://www.sisu.chat`. Override with `--api` or `SISU_API_BASE`.

## Commands

```
sisu                 interactive TUI (SiSu pager when stamped; otherwise Node TUI)
sisu update          reinstall the stamped pager for this CLI version
sisu models          list GET /api/runtime/v1/models (SiSu-Lite / Pro / Ultra)
sisu open <dir> --project <id>
sisu exec "<prompt>"
sisu -p "<prompt>"
sisu history
sisu logout
```

## Publish

1. Add repository secret `NPM_TOKEN` (npm automation token with publish rights to `sisu`).
2. Tag a release and push:

```bash
git tag v0.1.0
git push origin v0.1.0
```

The `Publish` workflow runs tests, packs, and `npm publish --access public`.
