# Thin remaining grok-build whole-file overlays into seams

| Field | Value |
| --- | --- |
| **Title** | D increment: drop fat stock overlays when the SiSu delta lives in a seam |
| **Author** | SiSu engineering |
| **Date** | 2026-08-27 |
| **Status** | Draft |
| **Repo** | `sisu-cli` (`/tmp/sisu-cli-work`) |

---

## Problem

Pin absorbability is proven once (`77cd7eb` / 1.0.10) but the overlay is still mostly whole-file restocks. Next grok-build jump will re-break `config.rs` (~5.6kLOC), `event_loop.rs` (~6.5kLOC), and test snapshots (`config_tests.rs` ~7.7k, `app_view_tests.rs` ~6.9k). That is not “change the pin and eat the upgrade.”

B also added three stock overlays (`credential_provider.rs`, `enrichment.rs`, `grok_auth_credentials.rs`) because leftover `/user` and `/feedback/config` stamp grok AuthStore there. D must not grow that surface further.

## Goal

Reduce the number of **pre-existing grok-build sources** copied in `overlays/grok-build/MANIFEST` (exclude `sisu_*` and `welcome/mobius.rs`) **and** reduce how many of those copies are **>2000 lines**, without losing the access-point contract.

Hard success:

1. MANIFEST whole-stock copy count **≤ 38** (today: 42 lines minus 4 seams `sisu_access_point`×2, `sisu_boot`, `mobius` = **38** wait: MANIFEST is 42 lines, seams = 4, whole-stock = 38). After D: whole-stock **≤ 37** (drop at least one stock overlay).
2. At least one overlay file that is currently **>2000 lines** is **gone from MANIFEST** (not merely shortened).
3. `cargo check -p xai-grok-pager-bin` still succeeds on pin `77cd7eb`.
4. Access-point contract tests still pass: empty catalog ≠ grok-4.6; settings + archive + `/user` + `/feedback/config` JWT; `api.x.ai` skip; 401/402 copy.

Soft success: `reconstruct_full_config` keeps `x-sisu-client-request-id` **without** adding `sampler_turn.rs` to MANIFEST (that file is 1582 lines and was never in 0.3.4 MANIFEST; overlaying it whole is forbidden).

## Non-goals

- C (full remote transcript)
- Jumping the grok-build pin again
- Overlaying `sampler_turn.rs`, `handle_request.rs`, `mode_switch.rs`, or any new stock file **>80 lines** that is not already in MANIFEST
- Deleting chrome overlays (welcome, Möbius, pager-bin `sisu_boot` / `enforce`)
- npm publish / retag

## Constraints

- Pin stays `77cd7eb675ba911c225c3aaeeece3a20cbccc426`.
- SiSu-only modules (`sisu_access_point.rs`, `sisu_boot.rs`, `mobius.rs`) may grow.
- Procedure for each candidate: remove from MANIFEST, restore stock file in vendor, `cargo check -p xai-grok-pager-bin`. If it fails, put the overlay back. Do not “fix compile” by copying a new giant stock file.
- Preferred seam: `sisu_access_point.rs` helpers, same pattern as `sampling_config()` / `sampling_config_result()` that let us drop `agent_ops.rs`.

## Candidates (try in this order)

| Overlay | Lines | Try |
| --- | --- | --- |
| `agent/config_tests.rs` | ~7664 | Move SiSu JWT/header tests into `sisu_access_point` / `models/tests` / `client_tests`; drop overlay. Stock tests vs overlayed `config.rs` may fail — if so, **keep**. |
| `app/event_loop.rs` | ~6491 | SiSu delta is `quit_for_sisu_login` plumbing and `is_api_key_auth = false`. 401 quit already lives in overlayed `dispatch/auth.rs`. Try drop; if stock event_loop misses the AppView field, **keep**. |
| `agent/config.rs` | ~5595 | Extract `SisuClientRequestIdInjector` + extra_headers stamping into `sisu_access_point`. Keep overlay only if stock `config.rs` cannot call that seam. Do **not** overlay `sampler_turn.rs`. |
| `app/app_view_tests.rs` | ~6857 | Do-not-grow. Drop only if stock fixtures compile with `quit_for_sisu_login` (they will not unless AppView has `Default`). Likely **keep**. |

Do not start with chrome (`welcome/mod.rs`, `pager-bin/main.rs`).

## Reconstruct injector (known hole)

Stock `reconstruct_full_config` sets `header_injector` to a local `TraceContextInjector` and drops `SisuClientRequestIdInjector`. Overlaying that 1582-line file is out of scope. If a **<80-line** new overlay cannot express the compose (it cannot: overlay is whole-file), leave the test `reconstruct_full_config_access_point_stamps_request_id` failing and do not block D success on it.

## Testing

- After each dropped MANIFEST row: `cargo check -p xai-grok-pager-bin`
- `cargo test -p xai-grok-shell --lib --offline access_point -- --test-threads=1 --skip reconstruct_full_config_access_point`
- Existing JWT tests: settings, archive, `/user`, `/feedback/config`, xai skip

## Order

1. Relocate SiSu-only tests out of `config_tests.rs`; try delete that overlay.
2. Try delete `event_loop.rs` overlay.
3. Extract config.rs SiSu header helpers into `sisu_access_point.rs`; keep or drop `config.rs` based on `cargo check`.
4. Stop when hard success (1)+(2)+(3)+(4) hold, even if later candidates stay.
