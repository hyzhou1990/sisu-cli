# Absorb a grok-build pin upgrade — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move `vendor/grok-build.pin` past 1.0.5 (`d71f6e0c…`) so SiSu still owns login and billed inference, without adding a new multi-kLOC stock overlay to compile.

**Architecture:** Phase 1 probes today’s overlay on a frozen grok-build `main` commit in an isolated tree (no npm, no `~/.sisu` stamp). Phase 2 thins only the overlay paths the probe classifies as Must-thin, then lands that same commit on `sisu-cli` main.

**Tech Stack:** `sisu-cli` Node 20 / TypeScript / Jest; Rust grok-build pager (`vendor/grok-build`, gitignored); overlay `overlays/grok-build/` + `scripts/fetch-grok-build.sh` / `apply-sisu-grok-overlay.sh` / `build-grok-pager.sh`.

**Spec:** `docs/superpowers/specs/2026-08-26-grok-pin-upgrade-design.md`

## Global Constraints

- Writable clone: `/tmp/sisu-cli-work` (Desktop TCC blocks `.git`).
- Do not stamp `~/.sisu/bin` or publish npm in Phase 1.
- Probe pin is a **frozen full-40-char commit**, never a floating `main` after Task 1.
- After Phase 2, MANIFEST count of copies of pre-existing grok-build sources (paths that are not new `sisu_*` files) must be **≤ 0.3.4 count**. New `sisu_*` modules are allowed.
- Do **not** add a new whole-file overlay of a stock source that was absent from 0.3.4 MANIFEST, except a <80-line call-site file. If compile still needs `agent_ops.rs`-scale copy, **stop** and write the blocker into the probe doc; do not ship.
- Contract that must survive: `SISU_ACCESS_POINT=1`; no flag → exit 2 + `sisu`; empty catalog ≠ grok-4.6; auxiliary HTTP uses `SISU_TOKEN`; 401 → `sisu login` / exit 10; 402 → sisu.chat.
- Non-goals: Muxi, quota bar, full transcript, crate rename, Windows pager, web chat.
- Do not play an interactive TUI session.

## File map

| Path | Responsibility |
| --- | --- |
| `vendor/grok-build.pin` | `repo=` + `commit=` + `version=` consumed by `scripts/fetch-grok-build.sh` |
| `scripts/fetch-grok-build.sh` | clone/fetch pin, checkout, apply overlay |
| `scripts/apply-sisu-grok-overlay.sh` | copy MANIFEST paths onto vendor |
| `scripts/build-grok-pager.sh` | apply overlay + `cargo build -p xai-grok-pager-bin --release` |
| `overlays/grok-build/MANIFEST` | overlay API |
| `overlays/grok-build/crates/codegen/xai-grok-shell/src/sisu_access_point.rs` | seam: token, URLs, 401/402 copy, session-token gate |
| `docs/superpowers/specs/2026-08-26-grok-pin-upgrade-probe.md` | Phase 1 output (created in Task 3) |
| `src/runtime/launch.ts` + Jest | host contract (unchanged except pin metadata if needed) |

0.3.4 whole-stock overlay count (exclude `sisu_access_point.rs`, `sisu_boot.rs`, `welcome/mobius.rs`): treat MANIFEST lines minus those three names as the baseline N. After Phase 2, whole-stock copies ≤ N.

---

### Task 1: Freeze probe pin and isolated vendor tree

**Files:**
- Create: `/tmp/sisu-pin-probe/` (not git; throwaway)
- Read: `vendor/grok-build.pin`, `scripts/fetch-grok-build.sh`

**Interfaces:**
- Consumes: `https://github.com/xai-org/grok-build.git`
- Produces: `PROBE_COMMIT` 40-char hash ≠ `d71f6e0c1f5acc5469e503e192fe14824e6f8c90`; vendor checkout at that hash **without** overlay yet

- [ ] **Step 1: Resolve and freeze HEAD**

```bash
cd /tmp/sisu-cli-work
OLD=d71f6e0c1f5acc5469e503e192fe14824e6f8c90
git ls-remote https://github.com/xai-org/grok-build.git refs/heads/main
# PROBE_COMMIT=<full hash from ls-remote>
test "$PROBE_COMMIT" != "$OLD"
test ${#PROBE_COMMIT} -eq 40
printf '%s\n' "$PROBE_COMMIT" > /tmp/sisu-pin-probe/PROBE_COMMIT
```

Expected: file contains one 40-char hash different from 1.0.5.

- [ ] **Step 2: Fetch that commit into an isolated vendor (no overlay)**

```bash
mkdir -p /tmp/sisu-pin-probe
git clone --filter=blob:none https://github.com/xai-org/grok-build.git /tmp/sisu-pin-probe/grok-build
git -C /tmp/sisu-pin-probe/grok-build fetch --depth=1 origin "$PROBE_COMMIT"
git -C /tmp/sisu-pin-probe/grok-build checkout --force --detach "$PROBE_COMMIT"
git -C /tmp/sisu-pin-probe/grok-build rev-parse HEAD
test "$(git -C /tmp/sisu-pin-probe/grok-build rev-parse HEAD)" = "$PROBE_COMMIT"
test ! -f /tmp/sisu-pin-probe/grok-build/crates/codegen/xai-grok-shell/src/sisu_access_point.rs
```

- [ ] **Step 3: Commit nothing.** Probe tree is not part of sisu-cli. Record hash only in the shell / next task’s probe doc.

---

### Task 2: Apply 0.3.4 overlay onto the probe tree; record apply conflicts

**Files:**
- Read: `overlays/grok-build/MANIFEST`, `scripts/apply-sisu-grok-overlay.sh`
- Write: apply log (local `/tmp/sisu-pin-probe/apply.log`)

**Interfaces:**
- Consumes: overlay sources from `/tmp/sisu-cli-work/overlays/grok-build`
- Produces: overlay copied onto `/tmp/sisu-pin-probe/grok-build`, or a list of missing MANIFEST sources

- [ ] **Step 1: Apply overlay by pointing ROOT at a fake sisu-cli layout**

```bash
# apply script: ROOT/overlays + ROOT/vendor/grok-build
mkdir -p /tmp/sisu-pin-probe/fake
ln -sfn /tmp/sisu-cli-work/overlays /tmp/sisu-pin-probe/fake/overlays
ln -sfn /tmp/sisu-pin-probe/grok-build /tmp/sisu-pin-probe/fake/vendor/grok-build
mkdir -p /tmp/sisu-pin-probe/fake/scripts
cp /tmp/sisu-cli-work/scripts/apply-sisu-grok-overlay.sh /tmp/sisu-pin-probe/fake/scripts/
set +e
sh /tmp/sisu-pin-probe/fake/scripts/apply-sisu-grok-overlay.sh > /tmp/sisu-pin-probe/apply.log 2>&1
echo APPLY_EXIT:$? >> /tmp/sisu-pin-probe/apply.log
set -e
cat /tmp/sisu-pin-probe/apply.log
test -f /tmp/sisu-pin-probe/grok-build/crates/codegen/xai-grok-shell/src/sisu_access_point.rs
```

If apply exits non-zero because a MANIFEST dest parent is missing, record the path in apply.log; do **not** invent overlay files. Continue to Task 3 with whatever copied.

- [ ] **Step 2: Diff overlay vs new stock for thinning candidates**

For each MANIFEST path that exists in both overlay and the **pre-overlay** tree, you no longer have pre-overlay. Use git in probe vendor:

```bash
cd /tmp/sisu-pin-probe/grok-build
git diff --stat HEAD
# files that are only overlay additions (sisu_*): untracked or new
git status --short | head
```

Save `git diff --stat HEAD` into `/tmp/sisu-pin-probe/overlay-stat.txt`.

---

### Task 3: Compile probe; write classified probe doc

**Files:**
- Create: `docs/superpowers/specs/2026-08-26-grok-pin-upgrade-probe.md`
- Capture: `/tmp/sisu-pin-probe/cargo.log`

**Interfaces:**
- Consumes: overlayed `/tmp/sisu-pin-probe/grok-build`
- Produces: probe markdown with commit, APPLY_EXIT, cargo exit, error list, classification table

- [ ] **Step 1: cargo check (required). cargo build --release if check is green and time allows.**

```bash
export PATH="${HOME}/.cargo/bin:/opt/homebrew/bin:/usr/local/bin:${PATH}"
export PROTOC="${PROTOC:-/opt/homebrew/bin/protoc}"
cd /tmp/sisu-pin-probe/grok-build
set +e
cargo check -p xai-grok-pager-bin --offline --message-format=short > /tmp/sisu-pin-probe/cargo.log 2>&1
echo CARGO_CHECK:$? >> /tmp/sisu-pin-probe/cargo.log
set -e
# If check is 0:
# cargo build -p xai-grok-pager-bin --release >> /tmp/sisu-pin-probe/cargo.log 2>&1
rg -n "error\[E|could not compile|Finished" /tmp/sisu-pin-probe/cargo.log | head -80
```

If `--offline` fails for missing crates, drop `--offline` once. Do not skip the error list.

- [ ] **Step 2: Write the probe doc (this is the Task 3 deliverable)**

Create `/tmp/sisu-cli-work/docs/superpowers/specs/2026-08-26-grok-pin-upgrade-probe.md`:

```markdown
# grok-build pin upgrade probe

- Frozen commit: `<PROBE_COMMIT>`
- Base pin: `d71f6e0c1f5acc5469e503e192fe14824e6f8c90` (1.0.5)
- Apply exit: `<n>`
- cargo check exit: `<n>`
- cargo build --release exit: `<n or skipped>`

## Apply

<paste apply.log tail>

## Compiler errors

<paste every `error[E` line or "none">

## Classification

| MANIFEST path | Class | Why |
| --- | --- | --- |
| crates/codegen/xai-grok-shell/src/sisu_access_point.rs | Seam | SiSu-only |
| crates/codegen/xai-grok-shell/src/agent/mvp_agent/agent_ops.rs | Must-thin or Keep-whole | <one sentence from the probe> |
| ... every MANIFEST line ... | | |

## Phase 2 go / no-go

- Go: check compiled **or** failures are confined to Must-thin files already in 0.3.4 MANIFEST.
- No-go: need a new multi-kLOC stock copy not in 0.3.4 MANIFEST.
```

Fill **every** MANIFEST row. No empty Why.

- [ ] **Step 3: Commit the probe doc only**

```bash
cd /tmp/sisu-cli-work
git add docs/superpowers/specs/2026-08-26-grok-pin-upgrade-probe.md
git commit -m "docs: grok-build pin probe $(cat /tmp/sisu-pin-probe/PROBE_COMMIT | cut -c1-8)"
```

If the classification table says **No-go**, **stop the plan**. Do not start Task 4.

---

### Task 4: Thin Must-thin overlays on pin 1.0.5 (only if probe said Go)

**Files:**
- Modify: overlay paths listed as Must-thin in the probe doc (expected candidate: `overlays/grok-build/crates/codegen/xai-grok-shell/src/agent/mvp_agent/agent_ops.rs`)
- Modify: `overlays/grok-build/MANIFEST` (delete rows that are no longer copied)
- Modify: `overlays/grok-build/crates/codegen/xai-grok-shell/src/sisu_access_point.rs` if a new helper is required
- Test: existing `sisu_access_point` / `models` cargo tests + Jest

**Interfaces:**
- Consumes: `ModelsManager::sampling_config() -> Result<SamplingConfig, String>` (current 1.0.5 overlay)
- Produces: stock `with_models` still compiles after overlay apply; **agent_ops.rs removed from MANIFEST if it was Must-thin**

Do this work on **current pin 1.0.5** vendor (`/tmp/sisu-cli-work/vendor/grok-build`), not the probe tree.

If probe Must-thin list is empty (compile succeeded on new pin with today’s overlay): skip Steps 1–4, only re-count MANIFEST, commit “docs: probe compiled; no thin required”, go to Task 5.

- [ ] **Step 1: Failing test if thinning `sampling_config` call site**

If `agent_ops.rs` is Must-thin, add to `overlays/.../sisu_access_point.rs` tests (already `serial`):

```rust
#[test]
#[serial]
fn access_point_sampling_config_err_is_process_boundary_string() {
    let _ap = EnvGuard::set("SISU_ACCESS_POINT", "1");
    // Helper used by stock with_models: Err must remain a String, never grok-4.6.
    assert_eq!(
        crate::sisu_access_point::sampling_config_boundary_err("no SiSu model available")
            .contains("grok-4.6"),
        false
    );
}
```

If that helper does not exist yet, the test fails to compile — that is the red step.

- [ ] **Step 2: Run the test (expect fail / compile fail)**

```bash
cd /tmp/sisu-cli-work
sh scripts/apply-sisu-grok-overlay.sh
export PROTOC="${PROTOC:-/opt/homebrew/bin/protoc}"
cd vendor/grok-build
cargo test -p xai-grok-shell --lib --offline sampling_config_boundary_err -- --test-threads=1
```

Expected: FAIL (helper missing) if thinning that seam.

- [ ] **Step 3: Minimal seam; drop whole-file overlay**

Add to `sisu_access_point.rs`:

```rust
/// Stock `MvpAgent::with_models` maps catalog Result through this.
pub fn sampling_config_boundary_err(err: String) -> String {
    err
}
```

In **stock** `vendor/grok-build/.../agent_ops.rs` (1.0.5, **not** the overlay copy), after overlay apply the overlay currently **overwrites** agent_ops.rs. To thin:

1. Remove `crates/codegen/xai-grok-shell/src/agent/mvp_agent/agent_ops.rs` from `overlays/grok-build/MANIFEST`.
2. Delete `overlays/grok-build/crates/codegen/xai-grok-shell/src/agent/mvp_agent/agent_ops.rs`.
3. Re-fetch 1.0.5 stock `agent_ops.rs` via `git -C vendor/grok-build checkout -- crates/codegen/xai-grok-shell/src/agent/mvp_agent/agent_ops.rs` after a clean pin checkout **or** keep a one-line patch applied by a new <80-line overlay file `agent_ops_sisu.rs` **only if** you cannot hook `with_models` without it.

**Required end state if agent_ops was Must-thin:** `with_models` on stock 1.0.5 still handles `Result` **without** a 4885-line overlay. Preferred hook: add to overlayed `models.rs` a method that stock already calls — if stock still calls `sampling_config()` returning `SamplerConfig` on 1.0.5 **without** overlay, restoring stock `agent_ops` is correct **only if** overlayed `models.rs` keeps `fn sampling_config(&self) -> SamplerConfig` and fail-closes internally via `exit_on_config_error` **or** the new pin already returns `Result` and stock already handles it.

Decide using the probe:

- New pin stock `sampling_config()` is still `SamplerConfig` → keep overlayed `models.rs` Result **and** a <80-line patch file for the single `with_models` call, not the whole `agent_ops.rs`.
- New pin stock already uses `Result` and maps it → delete both overlay `models.rs` Result change **and** overlay `agent_ops.rs` if they become no-ops.

Create overlay patch file **only** if needed, example `overlays/grok-build/crates/codegen/xai-grok-shell/src/agent/mvp_agent/with_models_sisu.rs` is **not** valid unless `agent_ops.rs` includes it. The valid <80-line approach is: overlay **only** a `sed`-sized dedicated copy of `agent_ops.rs` is forbidden; instead change overlayed `models.rs`:

```rust
pub fn sampling_config(&self) -> SamplingConfig {
    match self.sampling_config_result() {
        Ok(cfg) => cfg,
        Err(e) => crate::agent::init::exit_on_config_error(e),
    }
}

pub fn sampling_config_result(&self) -> Result<SamplingConfig, String> {
    /* current Result body */
}
```

Stock `with_models` then compiles with `SamplerConfig`. Empty-catalog tests call `sampling_config_result()`. Update `overlays/.../models/tests.rs` empty-catalog test to `sampling_config_result()`.

This is the **default Must-thin for agent_ops** if probe still has E0308-class mismatch.

- [ ] **Step 4: Apply + cargo check -p xai-grok-pager-bin (1.0.5) + cargo test sisu_access_point + Jest**

```bash
cd /tmp/sisu-cli-work
sh scripts/fetch-grok-build.sh   # still 1.0.5 pin
test "$(git -C vendor/grok-build rev-parse HEAD)" = d71f6e0c1f5acc5469e503e192fe14824e6f8c90
export PROTOC="${PROTOC:-/opt/homebrew/bin/protoc}"
(cd vendor/grok-build && cargo check -p xai-grok-pager-bin)
(cd vendor/grok-build && cargo test -p xai-grok-shell --lib --offline sisu_access_point -- --test-threads=1)
npx jest --runInBand src/runtime/access-point.test.ts src/runtime/launch.test.ts
```

Expected: check 0, cargo tests pass, Jest pass. `grep agent_ops overlays/grok-build/MANIFEST` is empty if that was Must-thin.

- [ ] **Step 5: Commit**

```bash
git add overlays/grok-build
git commit -m "refactor: thin grok-build overlay before pin jump"
```

Repeat Step 1–5 **once per remaining Must-thin path** in the probe table (config.rs, error_display.rs, app_view_tests.rs, dispatch/tests/mod.rs): delete from MANIFEST if the new pin stock compiles without them; keep-whole if probe classified Keep-whole. Do not re-copy a dropped file.

---

### Task 5: Point pin at probe commit; fetch; build host pager

**Files:**
- Modify: `vendor/grok-build.pin`
- Produce: `bin/xai-grok-pager` via `scripts/build-grok-pager.sh` `INSTALL_HOME=0`

**Interfaces:**
- Consumes: `PROBE_COMMIT` from Task 1 / probe doc
- Produces: pin `commit=<PROBE_COMMIT>`; overlayed `target/release/xai-grok-pager`

- [ ] **Step 1: Write pin**

`vendor/grok-build.pin`:

```
# Public grok-build snapshot this access-point overlay is applied onto.
# vendor/grok-build/ stays gitignored; CI fetches this pin then copies overlays/grok-build/.
repo=https://github.com/xai-org/grok-build.git
commit=<PROBE_COMMIT>
version=<leave 1.0.5 if upstream version file unchanged; else the version string from that commit's xai-grok-version or Cargo.toml, recorded in the commit message>
```

`commit=` must not be `d71f6e0c1f5acc5469e503e192fe14824e6f8c90`.

- [ ] **Step 2: Fetch + apply**

```bash
cd /tmp/sisu-cli-work
sh scripts/fetch-grok-build.sh
test "$(git -C vendor/grok-build rev-parse HEAD)" = "$(grep '^commit=' vendor/grok-build.pin | cut -d= -f2)"
test -f vendor/grok-build/crates/codegen/xai-grok-shell/src/sisu_access_point.rs
```

- [ ] **Step 3: Build pager (required for land)**

```bash
export INSTALL_HOME=0 PACKAGE_BR=1
export PROTOC="${PROTOC:-/opt/homebrew/bin/protoc}"
sh scripts/build-grok-pager.sh
test -x bin/xai-grok-pager
```

If cargo fails with a type error in a **non-MANIFEST** stock file: implement a seam in an existing overlay module (<80 lines). If it needs a new multi-kLOC overlay, **stop**; update probe doc to No-go; do not bump npm.

- [ ] **Step 4: Commit pin + overlay + binary is gitignored**

```bash
git add vendor/grok-build.pin overlays/grok-build
git commit -m "chore: pin grok-build $(grep '^commit=' vendor/grok-build.pin | cut -c8-15)"
```

---

### Task 6: Contract verification, stamp, package version

**Files:**
- Modify: `package.json`, `package-lock.json` version → next patch (0.3.5 if still 0.3.4)
- Test: Jest, `node dist/main.js --help|--version`, pager `--help`

**Interfaces:**
- Consumes: `bin/xai-grok-pager` from Task 5; `formatCliReleaseStatus`; `sisuGrokBuildEnv`
- Produces: npm version whose pager stamp matches; GitHub tag only after tests

- [ ] **Step 1: Jest (must include access-point + launch + install URL version)**

```bash
cd /tmp/sisu-cli-work
npx tsc --noEmit
npx jest --runInBand
```

Expected: suite green. `sisuGrokBuildEnv` still has `SISU_ACCESS_POINT=1` and no `GROK_DEFAULT_MODEL`. Catalog fail-closed tests still pass.

- [ ] **Step 2: Host help/version twice**

```bash
npx tsc
node dist/main.js --version   # twice; both print package version + 思溯
node dist/main.js --help      # twice; sisu login, sisu update, /api/runtime/v1/models, not /api/chat/models
```

- [ ] **Step 3: Overlayed pager --help twice each (denied / allowed)**

```bash
BIN=bin/xai-grok-pager
env -u SISU_ACCESS_POINT "$BIN" --help   # exit 2, run `sisu`
# repeat
env SISU_ACCESS_POINT=1 \
  GROK_XAI_API_BASE_URL=https://www.sisu.chat/api/runtime/v1 \
  GROK_MODELS_LIST_URL=https://www.sisu.chat/api/runtime/v1/models \
  GROK_CLI_CHAT_PROXY_BASE_URL=https://www.sisu.chat/api/runtime/v1 \
  SISU_TOKEN=sisu-jwt-acceptance \
  "$BIN" --help   # exit 0, SiSu
# repeat
```

- [ ] **Step 4: cargo tests for seams**

```bash
cd vendor/grok-build
cargo test -p xai-grok-shell --lib --offline sisu_access_point -- --test-threads=1
cargo test -p xai-grok-pager --lib --offline access_point -- --test-threads=1
```

Expected: 401 copy contains `sisu login`; 402 contains `sisu.chat`; settings Authorization is `Bearer sisu-jwt` in the settings test.

- [ ] **Step 5: Optional billed-header proof (preferred)**

Reuse the ThreadingHTTPServer mock from 0.3.3: spawn `$BIN -p hello` with `SISU_ACCESS_POINT=1` and `SISU_TOKEN=sisu-jwt-mock` against loopback `/api/runtime/v1`. Assert POST `/chat/completions` (or `/responses`) `Authorization` prefix `Bearer sisu-jwt-mock`. Timeout-kill after 20s is OK if hits were logged.

- [ ] **Step 6: Stamp + version bump + release commit**

```bash
# package.json 0.3.5 (or +1 from current)
printf '%s\n' "$(node -p "require('./package.json').version")" > "$HOME/.sisu/bin/xai-grok-pager.version"
cp bin/xai-grok-pager "$HOME/.sisu/bin/xai-grok-pager"
git add package.json package-lock.json vendor/grok-build.pin overlays docs
git commit -m "release: absorb grok-build pin <short-hash>"
# tag vX.Y.Z and pager-release only after local Step 1–5 are green
```

Do not tag if Task 5 stopped on No-go.

---

## Spec coverage

| Spec section | Task |
| --- | --- |
| Freeze probe pin | Task 1 |
| Apply today’s overlay, no thin first | Task 2 |
| cargo log + classification table | Task 3 |
| Must-thin on 1.0.5; no new giant stock copy | Task 4 |
| Pin = probe commit; build pager | Task 5 |
| Phase 2 gating --help / Jest / 401/402 / JWT | Task 6 |
| Stop if new multi-kLOC overlay required | Task 3 no-go + Task 5 stop |
| Non-goals | Global Constraints |

## Placeholder scan

No TBD. Probe commit is filled at Task 1 runtime. Thinning of unknown files is a **repeatable procedure** in Task 4 keyed off the probe table, plus a **default seam** for the known `sampling_config` / `agent_ops` mismatch.
