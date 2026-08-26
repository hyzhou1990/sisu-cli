# Absorb a grok-build pin upgrade without losing SiSu control

| Field | Value |
| --- | --- |
| **Title** | Probe, thin, then land a grok-build pin newer than 1.0.5 |
| **Author** | SiSu engineering |
| **Date** | 2026-08-26 |
| **Status** | Draft |
| **Audience** | `sisu-cli` maintainers |
| **Repo** | `sisu-cli` (`/tmp/sisu-cli-work` writable clone; Desktop TCC may block `.git`) |

---

## Problem

SiSu’s north star is: **grok-build remains the harness; SiSu owns login, billed inference, and the user-facing entry (`sisu`)**, so later grok-build releases can be absorbed by moving the pin and replaying a thin overlay.

Today that absorbability is unproven. The pager is pinned at grok-build **1.0.5** (`d71f6e0c1f5acc5469e503e192fe14824e6f8c90`, 2026-08-17). Overlay files include whole-stock copies (`agent_ops.rs`, `config.rs`, `error_display.rs`, `app_view_tests.rs`, `dispatch/tests/mod.rs`) added to compile or to satisfy contracts. A pin jump against that surface will either fail like the 1.0.5 E0308 incident, or make the overlay fatter and the next jump worse.

Upstream `main` has moved (example at design time: `77cd7eb`, 2026-08-25). The jump from 1.0.5 to that HEAD is a real upgrade, not a no-op.

## Goal

Land `vendor/grok-build.pin` on a grok-build commit **strictly after** `d71f6e0c…`, with the overlay still enforcing the SiSu host contract, without adding new whole-file copies of stock crates to make it compile.

## Non-goals

- Muxi / local Kimi, DeepSeek/GLM catalog slots
- Quota bar / SuperGrok-replacement chrome
- Completing CLI transcript for compaction/recap/local ACP events
- Renaming `xai-grok-*` crates or the clap bin name
- Windows pager
- Web chat catalog
- Shipping a pin jump that only compiles by overlaying another multi-thousand-line stock file

## Current contract (must survive the jump)

These are already shipped on 0.3.4. The new pin must keep them:

1. User-facing command is `sisu`. Identity is `~/.sisu`. Direct pager without `SISU_ACCESS_POINT=1` exits 2 and tells the user to run `sisu`.
2. Host sets `SISU_TOKEN` (B-full) and pins `GROK_XAI_API_BASE_URL` / `GROK_MODELS_LIST_URL` to `…/api/runtime/v1`. Empty catalog in access-point mode does not resolve to bundled grok-4.6.
3. Billed chat and auxiliary pager HTTP send the SiSu JWT, not a leftover grok AuthStore token, and do not target grok.com / api.x.ai.
4. Billed 401 maps to host login (exit 10 / `sisu login` copy). 402 maps to SiSu quota copy and `https://www.sisu.chat`, not grok.com.

## Approach

Two phases. Phase 1 does not ship. Phase 2 is the only user-visible release.

### Phase 1 — Probe (no npm tag)

In an isolated tree (not `main` stamp, not `~/.sisu/bin`):

1. Fetch grok-build at **probe pin** = `origin/main` HEAD at probe start. Record the exact commit in the probe log. Do not use a floating `main` after that.
2. Apply **today’s** overlay (`overlays/grok-build/` as of 0.3.4) with `scripts/apply-sisu-grok-overlay.sh`. Do not thin first.
3. `cargo build -p xai-grok-pager-bin --release` (or `scripts/build-grok-pager.sh` with `INSTALL_HOME=0`).
4. Write `docs/superpowers/specs/2026-08-26-grok-pin-upgrade-probe.md` listing:
   - compile errors by crate and file
   - overlay files that failed as 3-way conflicts vs the new stock
   - contract tests that cannot even compile
5. Classify each overlay path:

   | Class | Rule |
   | --- | --- |
   | **Seam** | Keep. Small SiSu-only modules (`sisu_access_point.rs`, pager-bin gate, catalog pin, JWT header helper). |
   | **Must-thin** | Stock file copied whole only to change a few call sites (e.g. `agent_ops.rs` `sampling_config()` Result). Replace with a seam in a SiSu module plus the smallest stock edit, or drop if the new pin already has a compatible type. |
   | **Keep-whole** | Allowed only if the file is already SiSu chrome (welcome logo/mobius) or a <200-line gate, and the probe diff is still localized. |
   | **Do-not-grow** | Never add a new whole-file overlay of a stock source that was not in MANIFEST at 0.3.4, except a <80-line call-site patch if cargo cannot see a seam. If the probe needs a new multi-kLOC stock copy, **stop Phase 2** and report the blocker. |

Phase 1 success: the classified list exists and cargo either compiled or failed with a recorded error list. Phase 1 does not require a green billed turn.

### Phase 2 — Thin then land

1. On pin 1.0.5 (current), apply only the **Must-thin** edits from the probe list so the overlay is smaller or equal in MANIFEST whole-stock files.
2. Point `vendor/grok-build.pin` at the **probe pin commit** (same hash as Phase 1, not a newer `main`).
3. Fetch + apply overlay + build pager for the current host.
4. Keep host Node contract tests (Jest) unchanged except pin metadata if any.
5. Stamp `~/.sisu/bin` and cut a package version only after verification below.

If Phase 2 compile still requires a new whole-stock overlay of `agent_ops.rs`-scale, do not ship. Re-open the seam design; do not “just copy the file.”

## Overlay thinning rules (normative)

- Prefer `sisu_access_point::*` helpers (`access_point_authorization`, `session_token_auth_gate` early-return, `billed_turn_copy`) over duplicating stock functions.
- A stock call site that only needs `Result` / JWT / exit-10 should call a helper, not live in a forked 4000-line file.
- `MANIFEST` is the overlay API. After Phase 2, the count of overlay paths that are copies of pre-existing grok-build sources (not new `sisu_*` files) must be **≤ the 0.3.4 count**, unless the extra paths are new `sisu_*` modules.

0.3.4 MANIFEST whole-stock copies that are thinning candidates (not an exhaustive must-thin list — probe decides):

- `crates/codegen/xai-grok-shell/src/agent/mvp_agent/agent_ops.rs`
- `crates/codegen/xai-grok-shell/src/agent/config.rs` / `config_tests.rs`
- `crates/codegen/xai-grok-pager/src/app/error_display.rs`
- `crates/codegen/xai-grok-pager/src/app/app_view_tests.rs`
- `crates/codegen/xai-grok-pager/src/app/dispatch/tests/mod.rs`

Seams that must remain:

- `sisu_access_point.rs` (shell + pager-bin)
- `sisu_boot.rs` / pager-bin `enforce`
- models empty-catalog Result
- remote client Authorization when access-point
- welcome/mobius chrome (SiSu-only assets)

## Verification

### Phase 1

- Probe log names the exact grok-build commit.
- Overlay apply either succeeded or listed missing/conflicting paths.
- Full compiler log saved. Pass = compile **or** a complete error list (no silent skip).

### Phase 2 (gating, same bar as 0.3.4 production login)

1. `vendor/grok-build.pin` `commit=` is not `d71f6e0c1f5acc5469e503e192fe14824e6f8c90`.
2. Overlayed pager `--help` with `SISU_ACCESS_POINT=1` + host URLs + `SISU_TOKEN` exits 0 and mentions SiSu.
3. Same binary without `SISU_ACCESS_POINT` exits 2 and mentions `sisu`.
4. Jest: catalog fail-closed, host env has `SISU_ACCESS_POINT=1` and no `GROK_DEFAULT_MODEL`, stamp/version reporter still matches package version.
5. Overlay/cargo tests still cover: access-point auxiliary HTTP uses `SISU_TOKEN`; 401 copy is `sisu login`; 402 URL is sisu.chat; empty catalog does not yield grok-4.6.
6. Optional but preferred: one billed `POST /api/runtime/v1/chat/completions` from the overlayed pager or a mocked capture showing `Authorization: Bearer <SISU_TOKEN>` (not a grok AuthStore JWT).

Headless `--help` plus the billed-header proof is enough. Do not require a played interactive TUI session.

## Risks

- Probe pin `main` may move during the work; freeze hash at Phase 1 start.
- Desktop TCC blocks `.git` on `SiSu-claude`; implement in `/tmp/sisu-cli-work`.
- Native pager rebuild is slow; Phase 1 may be cargo-check-only if `--release` cannot finish, but Phase 2 land requires a real host binary.
- A pin that changes `sampling_config()` types again is expected; the fix must be a seam, not another full `agent_ops.rs` snapshot.

## Success

SiSu CLI on npm (or a local stamp of the same version) runs grok-build **newer than 1.0.5**, still logs in as SiSu, still bills through `/api/runtime`, and the overlay did not grow a new giant stock file to get there.
