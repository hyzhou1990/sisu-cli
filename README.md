# sisu

Official publish channel for the SiSu CLI npm package.

One login. Cloud quota. Local workspace. Auth lives in `~/.sisu`, shared with SiSu Desktop. Product development of the CLI still happens in the main SiSu repo; this repository is what `npm publish` and `npm install -g @stevezhou/sisu` use.

## Install

```bash
npm install -g @stevezhou/sisu
sisu --help
sisu login
```

Requires Node.js 20 or newer. `npx sisu` works without a global install.

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
sisu                 interactive TUI
sisu open <dir> --project <id>
sisu exec "<prompt>"
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
