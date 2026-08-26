# sisu

Official publish channel for the SiSu CLI npm package.

One login. Cloud quota. Local runtime. Auth lives in `~/.sisu`, shared with SiSu Desktop. SiSu cloud is device login, the runtime catalog (`GET /api/runtime/v1/models`), and billed completions (`POST /api/runtime/v1/chat/completions`). Workspace tools stay on the machine. Sessions are local under `~/.sisu/sessions`.

## Install

```bash
npm install -g @stevezhou/sisu
sisu --help
sisu login
sisu
```

`npm install -g` is a small JS package. postinstall fetches the stamped SiSu TUI pager for **this package version** into `~/.sisu/bin` when a prebuilt exists (`darwin-arm64`, `linux-x64`, `linux-arm64`, `darwin-x64`). Platforms without a binary, or a missing GitHub Release asset, keep the Node TUI.

Requires Node.js 20 or newer. `npx sisu` works without a global install.

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
