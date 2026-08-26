# grok-build pin upgrade probe

- Frozen commit: `77cd7eb675ba911c225c3aaeeece3a20cbccc426`
- Base pin: `d71f6e0c1f5acc5469e503e192fe14824e6f8c90` (1.0.5)
- Apply exit: `0`
- cargo check exit: `101`
- cargo build --release exit: `skipped` (check non-zero)

`--offline` failed first (`loom` missing from the crates.io index). Rechecked once without `--offline`. `cargo check -p xai-grok-pager-bin --message-format=short` then compiled through deps and failed in `xai-grok-shell` (14 `error[E…]`). Pager crates were not type-checked because shell did not compile. Full log: `/tmp/sisu-pin-probe/cargo.log`.

## Apply

```
applied SiSu overlay onto /tmp/sisu-pin-probe/fake/vendor/grok-build
APPLY_EXIT:0
```

Overlay-stat (tracked only): 36 files changed, 1521 insertions(+), 1902 deletions(-). Four untracked SiSu-only files match MANIFEST seams (`sisu_access_point.rs` ×2, `sisu_boot.rs`, `welcome/mobius.rs`).

## Compiler errors

```
crates/codegen/xai-grok-shell/src/lib.rs:40:1: error[E0583]: file not found for module `terminal`
crates/codegen/xai-grok-shell/src/agent/mvp_agent/agent_ops.rs:2227:13: error[E0432]: unresolved import `xai_grok_tools::implementations::grok_build::deploy_app::AppBuilderDeployerConfig`: no `AppBuilderDeployerConfig` in `implementations::grok_build::deploy_app`
crates/codegen/xai-grok-shell/src/agent/subagent/handle_request.rs:976:12: error[E0433]: failed to resolve: could not find `waterfall` in the crate root: could not find `waterfall` in the crate root
crates/codegen/xai-grok-shell/src/agent/subagent/handle_request.rs:976:48: error[E0433]: failed to resolve: could not find `waterfall` in the crate root: could not find `waterfall` in the crate root
crates/codegen/xai-grok-shell/src/agent/subagent/handle_request.rs:1136:12: error[E0433]: failed to resolve: could not find `waterfall` in the crate root: could not find `waterfall` in the crate root
crates/codegen/xai-grok-shell/src/agent/subagent/handle_request.rs:1136:48: error[E0433]: failed to resolve: could not find `waterfall` in the crate root: could not find `waterfall` in the crate root
crates/codegen/xai-grok-shell/src/session/acp_session_impl/spawn.rs:1117:12: error[E0433]: failed to resolve: could not find `waterfall` in the crate root: could not find `waterfall` in the crate root
crates/codegen/xai-grok-shell/src/session/acp_session_impl/spawn.rs:1117:44: error[E0433]: failed to resolve: could not find `waterfall` in the crate root: could not find `waterfall` in the crate root
crates/codegen/xai-grok-shell/src/session/agent_rebuild.rs:347:16: error[E0433]: failed to resolve: could not find `waterfall` in the crate root: could not find `waterfall` in the crate root
crates/codegen/xai-grok-shell/src/session/agent_rebuild.rs:347:55: error[E0433]: failed to resolve: could not find `waterfall` in the crate root: could not find `waterfall` in the crate root
crates/codegen/xai-grok-shell/src/agent/mvp_agent/agent_ops.rs:2226:67: error[E0425]: cannot find type `AppBuilderDeployerConfig` in module `xai_grok_tools::implementations::grok_build::deploy_app`: not found in `xai_grok_tools::implementations::grok_build::deploy_app`
crates/codegen/xai-grok-shell/src/remote/client.rs:330:28: error[E0425]: cannot find function `with_extra_root_certificates` in crate `xai_grok_extra_ca`: not found in `xai_grok_extra_ca`
crates/codegen/xai-grok-shell/src/agent/subagent/mod.rs:474:31: error[E0603]: function `resolve_compaction_mode_from` is private: private function
crates/codegen/xai-grok-shell/src/agent/subagent/mod.rs:483:52: error[E0603]: function `resolve_compaction_detail_from` is private: private function
```

`could not compile xai-grok-shell (lib) due to 14 previous errors`.

Non-MANIFEST error *sites* (`handle_request.rs`, `spawn.rs`, `agent_rebuild.rs`, `subagent/mod.rs`) are collateral: overlayed `lib.rs` dropped `pub mod waterfall` and still has `pub mod terminal` (stock re-exports `xai_grok_shell_terminal`), and overlayed `config.rs` made `resolve_compaction_*_from` private. Restoring those MANIFEST files to stock plus the SiSu `mod sisu_access_point` line / JWT seams does **not** require copying those stock files.

Pager was not reached. Overlay snapshots still drop new-pin APIs that non-overlayed siblings call (`ModelsManager::display_name`, `attach_status_line`, `local_resume_selection`, `park_input_reader`, `alloc_picker_generation`, `cancel_latency`/`mode_switch`/`status_line` mods). Those overlay paths are already in the 0.3.4 MANIFEST.

## Classification

| MANIFEST path | Class | Why |
| --- | --- | --- |
| crates/codegen/xai-grok-home/src/lib.rs | Keep-whole | Localized `SISU_HOME` vs `GROK_HOME` resolver; still required and does not miss stock items. |
| crates/codegen/xai-grok-shell/src/sisu_access_point.rs | Seam | SiSu-only module (token, runtime URL pin, 401/402 copy, session-token gate). |
| crates/codegen/xai-grok-shell/src/lib.rs | Must-thin | 1.0.5 overlay declares `pub mod terminal` (E0583) and omits `waterfall`; keep stock re-exports plus `pub mod sisu_access_point`. |
| crates/codegen/xai-grok-shell/src/agent/auth_method.rs | Keep-whole | Access-point JWT must not wire grok AuthManager / grok.com methods; compiles as an additive patch. |
| crates/codegen/xai-grok-shell/src/agent/config.rs | Must-thin | 5.5kLOC snapshot makes `resolve_compaction_*_from` private (E0603 in stock subagent); keep JWT/`x-sisu-client` injector, restore stock visibility. |
| crates/codegen/xai-grok-shell/src/agent/config_tests.rs | Keep-whole | SiSu JWT and `x-sisu-client` header tests still required; do not enlarge this 7.6kLOC snapshot. |
| crates/codegen/xai-grok-shell/src/agent/models.rs | Must-thin | Overlay drops stock `display_name` (called by `status_line.rs`) and changes `sampling_config()` to `Result`; dual-method seam, not a new copy. |
| crates/codegen/xai-grok-shell/src/agent/models/resolution.rs | Keep-whole | Empty-catalog fail-closed (`Err`, never grok-4.6) is required contract and does not drop stock APIs. |
| crates/codegen/xai-grok-shell/src/agent/models/tests.rs | Keep-whole | Empty-catalog test asserts the error string does not contain grok-4.6. |
| crates/codegen/xai-grok-shell/src/agent/mvp_agent/agent_ops.rs | Must-thin | E0432/E0425 `AppBuilderDeployerConfig` path plus missing `attach_status_line` / `feedback_trace_offer`; drop whole-file overlay, keep Result handling in `models.rs`. |
| crates/codegen/xai-grok-shell/src/auth/api_key_probe.rs | Keep-whole | Access-point skips first-party grok probe; small additive patch. |
| crates/codegen/xai-grok-shell/src/auth/storage.rs | Keep-whole | Engine `auth.json` must not become SiSu identity; still required. |
| crates/codegen/xai-grok-shell/src/remote/client.rs | Must-thin | Overlay calls removed `with_extra_root_certificates` (E0425); restock `build_reqwest_client` and keep `access_point_authorization` JWT headers. |
| crates/codegen/xai-grok-shell/src/remote/client_tests.rs | Keep-whole | Settings HTTP must send `Bearer SISU_TOKEN`, not grok AuthStore. |
| crates/codegen/xai-grok-shell/src/session/acp_session_tests/auth_error_no_retry_tests.rs | Keep-whole | Access-point `x-sisu-client-request-id` reconstruct test still required. |
| crates/codegen/xai-grok-pager-bin/src/sisu_access_point.rs | Seam | SiSu-only pager-bin gate (`enforce`, exit 2 / host login). |
| crates/codegen/xai-grok-pager-bin/src/sisu_boot.rs | Seam | SiSu-only boot (telemetry off, no `~/.sisu` self-apply when access-point). |
| crates/codegen/xai-grok-pager-bin/src/main.rs | Keep-whole | Calls `sisu_boot`/`enforce`, SiSu `--help`/`update`/`login` copy; localized vs new pin. |
| crates/codegen/xai-grok-pager/src/app/cli.rs | Must-thin | 1.0.5 overlay drops `local_resume_selection` used by stock `session_startup.rs`; keep clap `name = "sisu"`. |
| crates/codegen/xai-grok-pager/src/app/mod.rs | Must-thin | Overlay omits stock `status_line` / `mode_switch` / `cancel_latency` modules that sibling files import; keep exit-10 / `sisu` command-name tests. |
| crates/codegen/xai-grok-pager/src/app/error_display.rs | Keep-whole | Billed 401 → `sisu login`, 402 → sisu.chat; no missing stock items in the probe diff. |
| crates/codegen/xai-grok-pager/src/app/event_loop.rs | Must-thin | 1.0.5 snapshot drops `park_input_reader` (called by stock `mode_switch.rs`); keep 401 intercept / `quit_for_sisu_login`. |
| crates/codegen/xai-grok-pager/src/app/effects/mod.rs | Keep-whole | Access-point logout unlinks `SISU_AUTH_PATH`; no dropped pub items vs stock. |
| crates/codegen/xai-grok-pager/src/app/app_view.rs | Must-thin | Overlay drops `alloc_picker_generation` and `PendingFeedbackTraceUpload` used by stock dispatch; keep `quit_for_sisu_login`. |
| crates/codegen/xai-grok-pager/src/app/app_view_tests.rs | Do-not-grow | Whole-stock test copy kept only to set `quit_for_sisu_login: false` on fixtures; must not grow. |
| crates/codegen/xai-grok-pager/src/app/acp_handler/settings.rs | Keep-whole | Access-point `is_api_key_auth` so settings HTTP uses SiSu JWT, not grok session. |
| crates/codegen/xai-grok-pager/src/app/dispatch/tests/mod.rs | Do-not-grow | Whole-stock test prelude kept only to add `quit_for_sisu_login: false`; must not grow. |
| crates/codegen/xai-grok-pager/src/app/dispatch/mod.rs | Must-thin | Overlay `mod notes` is private vs stock `pub(crate) mod notes` (used by `interactions.rs`); keep `SISU_LOGIN_EXIT_CODE` re-export. |
| crates/codegen/xai-grok-pager/src/app/dispatch/auth.rs | Keep-whole | Billed 401 sets `quit_for_sisu_login` / exit 10; additive SiSu intercept. |
| crates/codegen/xai-grok-pager/src/app/dispatch/billing.rs | Keep-whole | 402 / upsell copy and URL are sisu.chat, not grok.com. |
| crates/codegen/xai-grok-pager/src/app/dispatch/tests/auth.rs | Keep-whole | Tests that access-point 401 quits for `sisu login`. |
| crates/codegen/xai-grok-pager/src/app/dispatch/tests/billing.rs | Keep-whole | Tests that access-point billing strings/URLs are SiSu, not SuperGrok. |
| crates/codegen/xai-grok-pager/src/views/welcome/mod.rs | Keep-whole | SiSu welcome chrome / account badge; required identity, localized vs stock. |
| crates/codegen/xai-grok-pager/src/views/welcome/logo.rs | Keep-whole | Replaces grok logo with SiSu Möbius driver; chrome, not a stock API fork. |
| crates/codegen/xai-grok-pager/src/views/welcome/mobius.rs | Seam | SiSu-only Möbius splash (port of `src/mobius.ts`). |
| crates/codegen/xai-grok-pager/src/views/welcome/hero_box.rs | Keep-whole | One-line SiSu subtitle (`思有所溯 · 思溯 SiSu`). |
| crates/codegen/xai-grok-pager/src/views/tutorial.rs | Keep-whole | Tutorial copy names SiSu instead of grok. |
| crates/codegen/xai-grok-pager-minimal/src/welcome.rs | Keep-whole | Minimal welcome title is SiSu. |
| crates/codegen/xai-grok-pager-minimal/src/auth.rs | Keep-whole | Minimal workspace consent names SiSu. |
| crates/codegen/xai-grok-update/src/auto_update.rs | Keep-whole | Access-point prints `run sisu update` instead of grok self-update. |

## Phase 2 go / no-go

**Go.**

- Check did not compile, but every emitted `error[E…]` is in or caused by Must-thin files already on the 0.3.4 MANIFEST (`lib.rs`, `agent_ops.rs`, `config.rs`, `client.rs`).
- Predicted pager/shell follow-on failures (missing `display_name`, `park_input_reader`, `cancel_latency` mods, …) are the same class: restore stock on those MANIFEST paths and keep the SiSu seam.
- No new multi-kLOC stock copy outside 0.3.4 MANIFEST is required. Do not overlay `handle_request.rs`, `spawn.rs`, `agent_rebuild.rs`, `subagent/mod.rs`, `session_setup.rs`, or `mode_switch.rs`.

Default Task 4 path for `agent_ops.rs`: overlayed `models.rs` dual methods (`sampling_config()` + `sampling_config_result()`), delete whole-file `agent_ops.rs` from MANIFEST.
