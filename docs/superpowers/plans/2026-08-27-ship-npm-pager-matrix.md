# Ship npm 0.3.5 and drop x64 from tag pager matrix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** npm `@stevezhou/sisu@0.3.5` with `xai-grok-pager-darwin-arm64.br` on the GitHub Release, then change tag pager-release so future `v*` tags never queue darwin-x64.

**Architecture:** Part 1 is operations on the already-pushed `v0.3.5` workflows (cancel stale pager runs, wait for the existing Publish gate). Part 2 is a `main` commit that shrinks `.github/workflows/pager-release.yml` to three tag platforms and moves darwin-x64 to an opt-in dispatch job. Publish still waits only for darwin-arm64.br.

**Tech Stack:** GitHub Actions (`gh`), npm registry `@stevezhou/sisu`, `sisu-cli` Node 20 / Jest, `scripts/install-pager.js` 404 skip.

**Spec:** `docs/superpowers/specs/2026-08-27-ship-npm-pager-matrix-design.md`

## Global Constraints

- Writable clone: `/tmp/sisu-cli-work`.
- Do **not** force-push `v0.3.5`. Do **not** `git tag -f`. New patch tag only if darwin-arm64 **fails** and pager must be rebuilt (then 0.3.6, not a rewritten 0.3.5).
- Do **not** upload a fake or empty `.br`. Do **not** skip the Publish wait-for-arm64 step to force npm out.
- Do **not** `gh run cancel` the **v0.3.5** pager-release workflow while darwin-arm64 or linux jobs are in_progress (that would kill the asset we need).
- Do **not** remove `darwin-x64` from `scripts/install-pager.js` `SUPPORTED` (404 still skips to Node TUI).
- Do **not** change pin, overlay, JWT, transcript, Muxi, or web chat.
- `npm view @stevezhou/sisu version` must become `0.3.5` before Part 2 is called “Part 1 done”. If Publish is still running, wait; do not start a second publish.
- Desktop TCC: git commands in `/tmp/sisu-cli-work`.

## File map

| Path | Responsibility |
| --- | --- |
| (none for Part 1) | `gh` against `hyzhou1990/sisu-cli` + npm |
| `.github/workflows/pager-release.yml` | Tag matrix 3 platforms; x64 dispatch-only job |
| `.github/workflows/publish.yml` | Unchanged (already waits for darwin-arm64.br) |
| `README.md` | Tag default platforms vs optional x64 |
| `scripts/install-pager.js` | Unchanged SUPPORTED |
| `scripts/install-pager.test.ts` | Unchanged: x64 still listed; 404 skip |

---

### Task 1: Cancel stale pager-release runs (not v0.3.5 in-flight)

**Files:** none (GitHub Actions only)

**Interfaces:**
- Consumes: `gh` authenticated to `hyzhou1990/sisu-cli`
- Produces: 0.3.2 / 0.3.3 / 0.3.4 pager-release runs cancelled if still queued; v0.3.5 pager-release left running

- [ ] **Step 1: List pager-release runs**

```bash
cd /tmp/sisu-cli-work
gh run list --repo hyzhou1990/sisu-cli --workflow "Pager release assets" --limit 20 \
  --json databaseId,status,conclusion,displayTitle,headBranch,event,url
```

Expected: JSON including older `v0.3.2` / `v0.3.3` / `v0.3.4` rows (often `queued`) and one `v0.3.5` row.

- [ ] **Step 2: Cancel only stale tags**

For each run whose `displayTitle` or `headBranch` contains `v0.3.2` or `v0.3.3` or `v0.3.4` (or the matching release commit subject) **and** `status` is `queued` or `in_progress` **and** it is **not** the v0.3.5 run:

```bash
gh run cancel --repo hyzhou1990/sisu-cli "$RUN_ID"
```

Do **not** cancel a run whose head is `v0.3.5` / display title is the 0.3.5 fix/release subject.

- [ ] **Step 3: Confirm**

```bash
gh run list --repo hyzhou1990/sisu-cli --workflow "Pager release assets" --limit 10 \
  --json databaseId,status,displayTitle,headBranch
```

Expected: v0.3.5 still `in_progress` or `queued` with jobs; 0.3.2–0.3.4 pager runs `cancelled` (or already completed).

- [ ] **Step 4: Commit nothing.** This task is operations only.

---

### Task 2: Wait until npm 0.3.5 and darwin-arm64.br exist

**Files:** none

**Interfaces:**
- Consumes: in-flight Publish `v0.3.5` and pager-release darwin-arm64 job
- Produces: hard success checks from the spec (or a recorded failure that stops Part 2 from claiming ship)

- [ ] **Step 1: Poll assets and npm (up to ~45 minutes)**

```bash
cd /tmp/sisu-cli-work
for i in $(seq 1 45); do
  ver=$(npm view @stevezhou/sisu version 2>/dev/null || true)
  code=$(curl -sI -o /dev/null -w '%{http_code}' \
    https://github.com/hyzhou1990/sisu-cli/releases/download/v0.3.5/xai-grok-pager-darwin-arm64.br)
  echo "t=${i} npm=${ver:-none} br=${code}"
  if [ "$ver" = "0.3.5" ] && [ "$code" = "200" ]; then
    echo SHIP_OK
    break
  fi
  sleep 60
done
gh run list --repo hyzhou1990/sisu-cli --limit 6
gh release view v0.3.5 --json tagName,assets --jq '{tag:.tagName, assets:[.assets[].name]}' || true
```

Expected happy path: `SHIP_OK`, npm `0.3.5`, HTTP 200 for the arm64 `.br`.

- [ ] **Step 2: Branch on outcome (do not invent a binary)**

- **SHIP_OK:** go to Step 3.
- **arm64 `.br` is 200 but npm still 0.3.4:** Publish may have timed out. Dispatch Publish only:

```bash
gh workflow run Publish --repo hyzhou1990/sisu-cli --ref v0.3.5
```

Wait until `npm view @stevezhou/sisu version` is `0.3.5`. Then Step 3.

- **darwin-arm64 job failed (cargo/red):** **stop**. Do not dispatch Publish. Do not start Task 3 as “0.3.5 shipped”. Record the job URL and failure tail. Next human/plan is 0.3.6 after a pager fix — out of this plan’s happy path.
- **45 minutes, no `.br`, arm64 still running:** wait one more 15-minute loop (`seq 1 15`). If still no `.br` and job failed → same stop as cargo fail. If still running past ~90 minutes total, record BLOCKED with the job URL; do not skip the gate.

- [ ] **Step 3: Local version proof (this machine already has a 0.3.5 stamp; still check npm tarball identity)**

```bash
npm view @stevezhou/sisu version
npm view @stevezhou/sisu dist-tags --json
curl -sI https://github.com/hyzhou1990/sisu-cli/releases/download/v0.3.5/xai-grok-pager-darwin-arm64.br | head -5
node -p "require('/tmp/sisu-cli-work/package.json').version"
```

Expected: npm `0.3.5`; curl `HTTP/2 200` (or `HTTP/1.1 200`); local package.json already `0.3.5`.

Optional (do not `npm install -g` over a working stamp unless you must):

```bash
# only if ~/.sisu/bin/xai-grok-pager.version is not 0.3.5
npm install -g @stevezhou/sisu@0.3.5
sisu --version   # twice; both contain 0.3.5 and 思溯
cat "$HOME/.sisu/bin/xai-grok-pager.version"
```

- [ ] **Step 4: Commit nothing.**

---

### Task 3: Tag matrix drops darwin-x64; x64 is dispatch-only

**Files:**
- Modify: `.github/workflows/pager-release.yml` (replace whole file as below)
- Modify: `README.md` line 16 (install paragraph)
- Test: `scripts/install-pager.test.ts` (run unchanged)

**Interfaces:**
- Consumes: Part 1 ship may still be in flight; this commit must **not** retag `v0.3.5`
- Produces: tag `v*` builds only darwin-arm64 + linux-x64 + linux-arm64; `workflow_dispatch` with `platforms` containing `darwin-x64` runs macos-13

- [ ] **Step 1: RED — document the current matrix still has x64 on tag**

```bash
cd /tmp/sisu-cli-work
rg -n "darwin-x64" .github/workflows/pager-release.yml
npx jest --runInBand scripts/install-pager.test.ts
```

Expected: `rg` shows `darwin-x64` inside `matrix.include` (today’s bug). Jest **passes** (x64 remains SUPPORTED). The “red” for this task is the YAML still listing x64 on the tag matrix — do not change Jest expectations to fail.

- [ ] **Step 2: Replace `.github/workflows/pager-release.yml` with this file**

```yaml
name: Pager release assets

# Tag v* builds darwin-arm64 + linux only.
# darwin-x64 is dispatch-only (macos-13); missing asset → install-pager 404 → Node TUI.
# vendor/grok-build is gitignored — this job fetches the pin then applies overlays.
# Do not upload placeholder binaries.

on:
  workflow_dispatch:
    inputs:
      platforms:
        description: 'Comma-separated PLATFORM_KEY values'
        required: false
        default: 'darwin-arm64,linux-x64,linux-arm64'
  push:
    tags:
      - 'v*'

permissions:
  contents: write

jobs:
  build-pager:
    name: pager ${{ matrix.platform }}
    strategy:
      fail-fast: false
      matrix:
        include:
          - platform: darwin-arm64
            os: macos-14
            cargo_target: ''
          - platform: linux-x64
            os: ubuntu-latest
            cargo_target: ''
          - platform: linux-arm64
            os: ubuntu-24.04-arm
            cargo_target: ''
    runs-on: ${{ matrix.os }}
    timeout-minutes: 180
    steps:
      - uses: actions/checkout@v6

      - name: Fetch pinned grok-build and apply SiSu overlay
        run: |
          set -euo pipefail
          sh scripts/fetch-grok-build.sh
          test -f vendor/grok-build/crates/codegen/xai-grok-pager-bin/src/sisu_access_point.rs
          test -f vendor/grok-build/crates/codegen/xai-grok-shell/src/sisu_access_point.rs

      - uses: actions/setup-node@v6
        with:
          node-version: '20'

      - name: Install Rust
        uses: dtolnay/rust-toolchain@stable

      - name: Install protoc
        run: |
          set -euo pipefail
          if command -v brew >/dev/null 2>&1; then
            brew install protobuf
          else
            sudo apt-get update
            sudo apt-get install -y protobuf-compiler
          fi

      - name: Build and package .br
        env:
          PLATFORM_KEY: ${{ matrix.platform }}
          CARGO_TARGET: ${{ matrix.cargo_target }}
          INSTALL_HOME: '0'
          PACKAGE_BR: '1'
        run: |
          set -euo pipefail
          if [ -z "${CARGO_TARGET}" ]; then unset CARGO_TARGET; fi
          sh scripts/build-grok-pager.sh
          test -f "bin/xai-grok-pager-${PLATFORM_KEY}.br"

      - name: Upload release asset
        if: startsWith(github.ref, 'refs/tags/v')
        uses: softprops/action-gh-release@v2
        with:
          files: bin/xai-grok-pager-${{ matrix.platform }}.br
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}

  build-pager-x64:
    name: pager darwin-x64
    if: github.event_name == 'workflow_dispatch' && contains(github.event.inputs.platforms, 'darwin-x64')
    runs-on: macos-13
    timeout-minutes: 180
    steps:
      - uses: actions/checkout@v6

      - name: Fetch pinned grok-build and apply SiSu overlay
        run: |
          set -euo pipefail
          sh scripts/fetch-grok-build.sh
          test -f vendor/grok-build/crates/codegen/xai-grok-pager-bin/src/sisu_access_point.rs
          test -f vendor/grok-build/crates/codegen/xai-grok-shell/src/sisu_access_point.rs

      - uses: actions/setup-node@v6
        with:
          node-version: '20'

      - name: Install Rust
        uses: dtolnay/rust-toolchain@stable

      - name: Install protoc
        run: |
          set -euo pipefail
          brew install protobuf

      - name: Build and package .br
        env:
          PLATFORM_KEY: darwin-x64
          INSTALL_HOME: '0'
          PACKAGE_BR: '1'
        run: |
          set -euo pipefail
          sh scripts/build-grok-pager.sh
          test -f bin/xai-grok-pager-darwin-x64.br

      - name: Upload release asset
        if: startsWith(github.ref, 'refs/tags/v')
        uses: softprops/action-gh-release@v2
        with:
          files: bin/xai-grok-pager-darwin-x64.br
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

- [ ] **Step 3: README install paragraph**

Replace line 16 in `README.md` with:

```
`npm install -g` is a small JS package. postinstall fetches the stamped SiSu TUI pager for **this package version** into `~/.sisu/bin` when a prebuilt exists. GitHub Release tags ship `darwin-arm64`, `linux-x64`, and `linux-arm64`. `darwin-x64` is opt-in (`workflow_dispatch` with `platforms` containing `darwin-x64`) and often missing; platforms without a binary, or a missing GitHub Release asset, keep the Node TUI.
```

- [ ] **Step 4: GREEN checks**

```bash
cd /tmp/sisu-cli-work
# tag default matrix must not include x64
rg -n "platform: darwin-x64" .github/workflows/pager-release.yml
# expected: only under build-pager-x64 job / PLATFORM_KEY, NOT under build-pager matrix.include
python3 - <<'PY'
from pathlib import Path
text = Path(".github/workflows/pager-release.yml").read_text()
assert "default: 'darwin-arm64,linux-x64,linux-arm64'" in text
assert "darwin-x64,linux-x64" not in text  # old dispatch default gone
# matrix.include block before build-pager-x64 must not list darwin-x64
head, _, tail = text.partition("build-pager-x64:")
assert "platform: darwin-x64" not in head
assert "build-pager-x64:" in text
assert "contains(github.event.inputs.platforms, 'darwin-x64')" in tail
print("yaml_ok")
PY
npx jest --runInBand scripts/install-pager.test.ts
```

Expected: `yaml_ok`; Jest pass (still lists darwin-x64 in SUPPORTED; 404 skip test still uses darwin-x64).

Confirm Publish YAML still waits for arm64 (do not edit it):

```bash
rg -n "xai-grok-pager-darwin-arm64.br" .github/workflows/publish.yml
```

Expected: the wait loop still present.

- [ ] **Step 5: Commit (no tag)**

```bash
cd /tmp/sisu-cli-work
git add .github/workflows/pager-release.yml README.md
git commit -m "ci: tag pager matrix drops darwin-x64"
```

Do **not** `git tag`. Do **not** `git push --tags`.

---

### Task 4: Push Part 2 to origin/main

**Files:** none new; push Task 3 commit (and the spec/plan commits if still unpushed)

**Interfaces:**
- Consumes: Task 3 commit on `main`
- Produces: `origin/main` contains the YAML change; `v0.3.5` still points at `51891b6` (or the 0.3.5 ship commit), **not** this YAML commit

- [ ] **Step 1: Verify tag did not move**

```bash
cd /tmp/sisu-cli-work
git fetch origin --tags
git rev-parse v0.3.5^{}
git merge-base --is-ancestor 51891b670658127da6b1223186da5a973658173b v0.3.5^{} && echo tag_still_on_035_line
git log -3 --oneline
```

Expected: `v0.3.5` is **not** HEAD if Task 3 committed after it. Tag stays on the 0.3.5 ship commit.

- [ ] **Step 2: Push main only**

```bash
git pull --ff-only origin main
git push origin main
git status -sb
```

Expected: `main...origin/main` in sync. `git ls-remote --tags origin v0.3.5` still the same object as Step 1.

- [ ] **Step 3: Do not dispatch pager-release** unless a later tag exists. This YAML is for the **next** `v*`.

---

## Spec coverage

| Spec section | Task |
| --- | --- |
| Cancel 0.3.2–0.3.4 queued pager | Task 1 |
| Do not cancel v0.3.5 arm64/linux | Task 1 + Global Constraints |
| npm 0.3.5 + arm64.br 200 | Task 2 |
| Publish timeout → dispatch Publish if .br exists | Task 2 Step 2 |
| arm64 cargo fail → no npm, no fake .br | Task 2 Step 2 |
| Tag matrix 3 platforms | Task 3 |
| x64 dispatch-only job | Task 3 |
| dispatch default without x64 | Task 3 |
| SUPPORTED still has darwin-x64 | Task 3 Jest |
| Publish wait unchanged | Task 3 Step 4 |
| README tag vs opt-in x64 | Task 3 |
| Part 2 does not retag 0.3.5 | Task 4 |
| Non-goals (pin, overlay, Windows, Muxi) | Global Constraints |

## Placeholder scan

No TBD. Stale GitHub run IDs are **not** hardcoded; Task 1 lists then cancels by tag/title. Task 2 poll loop has explicit stop conditions.
