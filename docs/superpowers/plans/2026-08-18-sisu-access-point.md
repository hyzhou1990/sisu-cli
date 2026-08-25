# SiSu Access Point Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `sisu` a real SiSu access point: open the TUI and get a SiSu account, SiSu models, and a SiSu-billed turn — never grok.com / api.x.ai / Grok 4.6.

**Architecture:** Node `sisu` is the host (login, health probe, env contract, update). The vendored grok-build pager is the local engine. Cloud is only `https://www.sisu.chat/api/runtime/v1`. Ship B-lite first (overwrite `XAI_API_KEY` with the SiSu JWT, isolate `GROK_HOME`, pin URLs); ship B-full (`SISU_TOKEN`, unset `XAI_API_KEY`) in the same npm as the access-point pager.

**Tech Stack:** FastAPI (`wulabllm` + `wulabllm-deploy` copy), Node 20 / TypeScript / Jest (`sisu-cli`), Rust grok-build pager (`sisu-cli/vendor/grok-build`, gitignored; ship via GitHub Release `.br`).

**Spec:** `sisu-cli/docs/sisu-access-point-design.md`

## Global Constraints

- Command stays `sisu`. Do not rename crates (`xai-grok-*`).
- Cloud wire is messages + tools; never `task_category: coding` `/api/chat/send`.
- Identity is `~/.sisu/auth.json` (0700/0600), shared with Desktop. Pager child must **not** inherit `SISU_HOME`.
- Do not unset `XAI_API_KEY` until the pager credential-seam table is live (same npm as Task 3).
- Empty `GROK_CLI_CHAT_PROXY_BASE_URL` is **not** a disable (falls back to `cli-chat-proxy.grok.com`). Pin it to the SiSu runtime.
- Do not set `GROK_DEFAULT_MODEL`. Access-point `first_or_fallback` must error, never `grok-4.6`.
- Changelog slot stays empty (`GROK_CHANGELOG_OFFLINE=1` + cache purge). Quota bar is **not** in Tasks 1–4.
- Apache-2.0 grok-build NOTICE/LICENSE stays. Do not land convert-a.
- Mirror every backend change into `wulabllm-deploy/backend/` in the same task.

## File map

| Path | Responsibility |
| --- | --- |
| `wulabllm/backend/app/routers/cli_runtime.py` | `/health`, quota 402, header→`client*` |
| `wulabllm/backend/app/services/cli_runtime.py` | `complete_model_round` (already bills after provider) |
| `wulabllm/backend/tests/unit/test_cli_runtime.py` | Router + helper unit tests |
| `wulabllm/scripts/runtime/backend-contract.sh` | Optional inspect of `/api/runtime/health` (do not replace `/api/health`) |
| `sisu-cli/src/runtime/launch.ts` | `sisuGrokBuildEnv`, probe, migrate, purge changelog |
| `sisu-cli/src/tui.ts` | Login-first, probe-fail → Node TUI, spawn with contract |
| `sisu-cli/src/store.ts` | Engine / `SISU_AUTH_PATH` helpers |
| `sisu-cli/vendor/grok-build/.../sisu_boot.rs` | Stop remapping homes / injecting JWT when access-point |
| `sisu-cli/vendor/grok-build/.../sisu_access_point.rs` | `enforce()` + `active()` |
| `sisu-cli/vendor/grok-build/.../xai-grok-home` | `GROK_HOME` wins when both set |
| `sisu-cli/vendor/grok-build/.../xai-grok-shell` | credentials, fallback, `store_api_key` path, stamps |
| `sisu-cli/vendor/grok-build/.../welcome/mod.rs` | Badge / login copy |

---

### Task 1: Production runtime contract (`/health`, 402, header stamps)

**Files:**
- Modify: `wulabllm/backend/app/routers/cli_runtime.py`
- Modify: `wulabllm-deploy/backend/app/routers/cli_runtime.py` (same patch)
- Modify: `wulabllm/backend/tests/unit/test_cli_runtime.py`
- Modify: `wulabllm-deploy/backend/tests/unit/test_cli_runtime.py` (same tests)
- Test: those two test files

**Interfaces:**
- Consumes: `check_user_quota_available(session, user) -> tuple[bool, str]` from `app.services.budget`; `normalize_complete_request`; existing `complete` / `openai_chat_completions` / `openai_list_models`.
- Produces: `GET /api/runtime/health` → `{ "ok": true, "complete": true, "models": true }` with **no** `Depends(get_current_user)`. `require_runtime_quota(session, user)` helper used by both POST routes. Header copy: `x-sisu-client` / `x-sisu-client-version` / `x-sisu-client-request-id` → `client` / `client_version` / `client_request_id` when the body omits them.

- [ ] **Step 1: Write the failing tests**

Append to `wulabllm/backend/tests/unit/test_cli_runtime.py`:

```python
from fastapi import FastAPI
from fastapi.testclient import TestClient
from app.routers.cli_runtime import router as runtime_router


def _client() -> TestClient:
    app = FastAPI()
    app.include_router(runtime_router, prefix="/api")
    return TestClient(app)


def test_runtime_health_is_unauthenticated():
    response = _client().get("/api/runtime/health")
    assert response.status_code == 200
    body = response.json()
    assert body["ok"] is True
    assert body["complete"] is True
    assert body["models"] is True


def test_runtime_models_without_token_is_401_not_404():
    response = _client().get("/api/runtime/v1/models")
    assert response.status_code == 401
    assert response.status_code != 404
```

Add quota + header tests that call a small extracted helper (they will fail until the helper exists):

```python
import pytest
from unittest.mock import AsyncMock
from fastapi import HTTPException
from app.routers import cli_runtime


@pytest.mark.asyncio
async def test_require_runtime_quota_raises_402_with_existing_detail_and_code(monkeypatch):
    async def fake_check(session, user):
        return False, "余额不足，请充值"

    monkeypatch.setattr(
        "app.services.budget.check_user_quota_available",
        fake_check,
    )
    with pytest.raises(HTTPException) as caught:
        await cli_runtime.require_runtime_quota(object(), object())
    assert caught.value.status_code == 402
    detail = caught.value.detail
    assert isinstance(detail, dict)
    assert detail["code"] == "quota_exhausted"
    assert detail["message"] == "余额不足，请充值"


def test_apply_sisu_client_headers_fills_missing_body_fields():
    class _Headers(dict):
        def get(self, key, default=None):
            return super().get(key.lower(), default)

    headers = _Headers({
        "x-sisu-client": "tui",
        "x-sisu-client-version": "0.2.2",
        "x-sisu-client-request-id": "req-1",
    })
    body = cli_runtime.apply_sisu_client_headers({"model": "kimi-k2.5"}, headers)
    assert body["client"] == "tui"
    assert body["client_version"] == "0.2.2"
    assert body["client_request_id"] == "req-1"


def test_apply_sisu_client_headers_does_not_overwrite_body():
    body = cli_runtime.apply_sisu_client_headers(
        {"client": "cli", "client_version": "body", "client_request_id": "b1"},
        {"get": lambda *a, **k: "hdr"},
    )
    assert body["client"] == "cli"
    assert body["client_version"] == "body"
    assert body["client_request_id"] == "b1"
```

- [ ] **Step 2: Run tests to verify they fail**

Run (from `wulabllm/backend`, using the repo's existing pytest env):

```bash
cd /Users/steve/Desktop/SiSu-claude/wulabllm/backend
python -m pytest tests/unit/test_cli_runtime.py::test_runtime_health_is_unauthenticated tests/unit/test_cli_runtime.py::test_require_runtime_quota_raises_402_with_existing_detail_and_code -q
```

Expected: FAIL (404 on health, `require_runtime_quota` missing).

- [ ] **Step 3: Implement the minimal router helpers**

In `cli_runtime.py`, add (keep existing routes):

```python
from fastapi import Request, status
from app.services.budget import check_user_quota_available


@router.get("/health")
async def runtime_health():
    return {"ok": True, "complete": True, "models": True}


async def require_runtime_quota(session: AsyncSession, user: User) -> None:
    ok, quota_msg = await check_user_quota_available(session, user)
    if not ok:
        raise HTTPException(
            status_code=status.HTTP_402_PAYMENT_REQUIRED,
            detail={"message": quota_msg, "code": "quota_exhausted"},
        )


def apply_sisu_client_headers(payload: dict[str, Any], headers: Any) -> dict[str, Any]:
    out = dict(payload)
    mapping = (
        ("client", "x-sisu-client"),
        ("client_version", "x-sisu-client-version"),
        ("client_request_id", "x-sisu-client-request-id"),
    )
    for field, header in mapping:
        if out.get(field):
            continue
        value = headers.get(header) if headers is not None else None
        if value:
            out[field] = value
    return out
```

Call `await require_runtime_quota(session, current_user)` at the top of `complete` and `openai_chat_completions` **before** `complete_model_round`. In `openai_chat_completions`, inject `Request` and run `payload = apply_sisu_client_headers(payload, request.headers)` before `_require_complete_body`.

Copy the same file into `wulabllm-deploy/backend/app/routers/cli_runtime.py`.

- [ ] **Step 4: Run the tests and make sure they pass**

```bash
cd /Users/steve/Desktop/SiSu-claude/wulabllm/backend
python -m pytest tests/unit/test_cli_runtime.py -q
```

Expected: PASS. Then copy the new tests into `wulabllm-deploy/backend/tests/unit/test_cli_runtime.py` and run that copy if its venv exists.

- [ ] **Step 5: Prod merge gate (manual, do not skip)**

```bash
curl -sS -o /tmp/sisu-rt-health.json -w '%{http_code}' https://www.sisu.chat/api/runtime/health
echo
curl -sS -o /tmp/sisu-rt-models.json -w '%{http_code}' https://www.sisu.chat/api/runtime/v1/models
echo
```

Expected after deploy: health **200** + JSON `ok: true`; models **401** (not 404). Do **not** start Task 2 npm publish until this is green. If the tree is not yet deployed, finish the code+tests in this task and leave a note in the commit body: `runtime health not live on www.sisu.chat yet`.

- [ ] **Step 6: Commit**

```bash
git add wulabllm/backend/app/routers/cli_runtime.py \
        wulabllm/backend/tests/unit/test_cli_runtime.py \
        wulabllm-deploy/backend/app/routers/cli_runtime.py \
        wulabllm-deploy/backend/tests/unit/test_cli_runtime.py
git commit -m "feat: ship /api/runtime/health and quota 402 on complete paths"
```

(Commit in whichever repo actually tracks those trees; `sisu-cli` does not.)

---

### Task 2: Host B-lite contract (safe with the 0.2.2 pager)

**Files:**
- Modify: `sisu-cli/src/runtime/launch.ts`
- Modify: `sisu-cli/src/runtime/launch.test.ts`
- Modify: `sisu-cli/src/store.ts`
- Modify: `sisu-cli/src/tui.ts`
- Modify: `sisu-cli/src/tui.test.ts`
- Test: `sisu-cli/src/runtime/launch.test.ts`, `sisu-cli/src/tui.test.ts`

**Interfaces:**
- Consumes: `readAuth()`, `getSisuHome()`, `DEFAULT_API_BASE`, `webLoginCommand`, `findGrokBuildBinary()`.
- Produces:
  - `sisuEngineHome(): string` → `path.join(getSisuHome(), 'engine')`
  - `sisuAuthPath(): string` → `path.join(getSisuHome(), 'auth.json')`
  - `sisuGrokBuildEnv(): NodeJS.ProcessEnv` as in the spec (B-lite): **no** `SISU_HOME` on the child; `GROK_HOME=engine`; overwrite `XAI_API_KEY` with `auth.json.token`; pin `GROK_CLI_CHAT_PROXY_BASE_URL` to runtime (non-empty); `GROK_CHANGELOG_OFFLINE=1`; do **not** set `SISU_TOKEN` or `GROK_DEFAULT_MODEL`.
  - `class RuntimeUnavailable extends Error`
  - `assertRuntimeAvailable(http, apiBase): Promise<void>` — `GET {apiBase}/api/runtime/health`, throw `RuntimeUnavailable` on network / non-2xx / missing `ok`.
  - `migrateGrokScratchToEngine(home): void`
  - `purgeChangelogCache(home, engine): void`
  - `writeSisuGrokConfig()` writes `engine/config.toml` (not top-level `~/.sisu/config.toml`).

- [ ] **Step 1: Write the failing host-contract tests**

Add to `sisu-cli/src/runtime/launch.test.ts` (keep existing tests; update the old `GROK_HOME` expectation when you implement):

```ts
it('B-lite contract: no SISU_HOME on child, engine home, overwritten XAI_API_KEY', () => {
  const previous = {
    home: process.env.SISU_HOME,
    xai: process.env.XAI_API_KEY,
    grok: process.env.GROK_HOME,
    code: process.env.GROK_CODE_XAI_API_KEY,
    def: process.env.GROK_DEFAULT_MODEL,
  }
  process.env.XAI_API_KEY = 'sk-xai-from-shell'
  process.env.GROK_CODE_XAI_API_KEY = 'legacy'
  process.env.GROK_DEFAULT_MODEL = 'grok-4.6'
  const home = makeHome()
  try {
    const env = sisuGrokBuildEnv()
    expect(env.SISU_HOME).toBeUndefined()
    expect(env.SISU_ACCESS_POINT).toBe('1')
    expect(env.GROK_HOME).toBe(path.join(home, 'engine'))
    expect(env.GROK_AUTH_PATH).toBe(path.join(home, 'engine', 'auth.json'))
    expect(env.SISU_AUTH_PATH).toBe(path.join(home, 'auth.json'))
    expect(env.XAI_API_KEY).toBe('jwt')
    expect(env.XAI_API_KEY).not.toBe('sk-xai-from-shell')
    expect(env.GROK_CODE_XAI_API_KEY).toBeUndefined()
    expect(env.GROK_DEFAULT_MODEL).toBeUndefined()
    expect(env.GROK_CLI_CHAT_PROXY_BASE_URL).toBe('https://www.sisu.chat/api/runtime/v1')
    expect(env.GROK_CLI_CHAT_PROXY_BASE_URL).not.toBe('')
    expect(env.GROK_MODELS_LIST_URL).toBe('https://www.sisu.chat/api/runtime/v1/models')
    expect(env.GROK_CHANGELOG_OFFLINE).toBe('1')
    expect(env.SISU_TOKEN).toBeUndefined()
    expect(fs.existsSync(path.join(home, 'auth.json'))).toBe(true)
    expect(JSON.parse(fs.readFileSync(path.join(home, 'auth.json'), 'utf8')).token).toBe('jwt')
  } finally {
    process.env.SISU_HOME = previous.home
    process.env.XAI_API_KEY = previous.xai
    process.env.GROK_HOME = previous.grok
    process.env.GROK_CODE_XAI_API_KEY = previous.code
    process.env.GROK_DEFAULT_MODEL = previous.def
    fs.rmSync(home, { recursive: true, force: true })
  }
})

it('assertRuntimeAvailable throws RuntimeUnavailable on 404', async () => {
  const http = jest.fn().mockResolvedValue({ ok: false, status: 404, json: async () => ({}) })
  await expect(assertRuntimeAvailable(http, 'https://www.sisu.chat')).rejects.toBeInstanceOf(RuntimeUnavailable)
})

it('assertRuntimeAvailable resolves on {ok:true}', async () => {
  const http = jest.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ ok: true, complete: true, models: true }),
  })
  await expect(assertRuntimeAvailable(http, 'https://www.sisu.chat')).resolves.toBeUndefined()
  expect(http).toHaveBeenCalledWith('https://www.sisu.chat/api/runtime/health', expect.anything())
})

it('migrateGrokScratchToEngine moves sessions and leaves SiSu auth.json', () => {
  const home = makeHome()
  fs.mkdirSync(path.join(home, 'sessions'))
  fs.writeFileSync(path.join(home, 'sessions', 'a.json'), '{}')
  fs.writeFileSync(path.join(home, 'CHANGELOG.md'), 'xai notes')
  try {
    migrateGrokScratchToEngine(home)
    purgeChangelogCache(home, path.join(home, 'engine'))
    expect(fs.existsSync(path.join(home, 'engine', 'sessions', 'a.json'))).toBe(true)
    expect(fs.existsSync(path.join(home, 'sessions'))).toBe(false)
    expect(fs.existsSync(path.join(home, 'CHANGELOG.md'))).toBe(false)
    expect(JSON.parse(fs.readFileSync(path.join(home, 'auth.json'), 'utf8')).token).toBe('jwt')
  } finally {
    fs.rmSync(home, { recursive: true, force: true })
  }
})
```

Change `tui.test.ts` “enters the pager logged out”:

```ts
it('does not spawn the grok pager when logged out; starts SiSu login instead', async () => {
  const { io } = scriptedIo([])
  const webLogin = jest.fn().mockResolvedValue('ada@sisu.chat')
  const pager = jest.fn().mockResolvedValue(0)
  const auth = jest.fn()
    .mockReturnValueOnce(null)
    .mockReturnValue({ token: 'jwt', email: 'ada@sisu.chat', user_id: 'u1', api_base: 'https://www.sisu.chat' })
  await runTui(io, { auth, webLogin, pager, animate: false, color: false, columns: 80 })
  expect(webLogin).toHaveBeenCalled()
})
```

Add:

```ts
it('falls back to Node TUI when runtime health fails and does not spawn pager', async () => {
  const { io, written } = scriptedIo(['/quit'])
  const pager = jest.fn()
  const grokBin = jest.fn() // if you inject findBinary, otherwise mock http
  await runTui(io, {
    auth: () => ({ token: 'jwt', email: 'a@b.c', user_id: '1', api_base: 'https://www.sisu.chat' }),
    http: jest.fn().mockResolvedValue({ ok: false, status: 404, json: async () => ({}) }),
    pager,
    animate: false,
    color: false,
    columns: 80,
  })
  expect(pager).not.toHaveBeenCalled()
  expect(written.join('')).toMatch(/SiSu runtime/i)
})
```

(`runTui` must grow an optional `http` / probe hook if it does not already take one — add `probe?: typeof assertRuntimeAvailable` on `TuiDeps`.)

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /Users/steve/Desktop/SiSu-claude/sisu-cli
npm test -- --runInBand src/runtime/launch.test.ts src/tui.test.ts
```

Expected: FAIL (`SISU_HOME` still set, `XAI_API_KEY` still shell-wins, `assertRuntimeAvailable` missing).

- [ ] **Step 3: Implement `sisuGrokBuildEnv` B-lite + helpers**

Replace `sisuGrokBuildEnv` in `launch.ts` with the spec sketch (B-lite). Implement:

```ts
export class RuntimeUnavailable extends Error {
  constructor(message = 'SiSu runtime is not available') {
    super(message)
    this.name = 'RuntimeUnavailable'
  }
}

export async function assertRuntimeAvailable(
  http: HttpClient,
  apiBase: string,
): Promise<void> {
  const url = `${apiBase.replace(/\/+$/, '')}/api/runtime/health`
  let response: { ok: boolean; status: number; json: () => Promise<unknown> }
  try {
    response = await http(url, { headers: { Accept: 'application/json' } })
  } catch (error) {
    throw new RuntimeUnavailable(error instanceof Error ? error.message : String(error))
  }
  if (!response.ok) throw new RuntimeUnavailable(`health ${response.status}`)
  const body = (await response.json().catch(() => null)) as { ok?: boolean } | null
  if (!body || body.ok !== true) throw new RuntimeUnavailable('health body missing ok')
}
```

`migrateGrokScratchToEngine`: move top-level `sessions`, `worktrees`, `hooks`, `logs` into `engine/` if present. Do **not** move `auth.json`, `session.json`, `bin`, `workspace-paths.json`. `purgeChangelogCache`: unlink `CHANGELOG*` under `home` and `engine`. `writeSisuGrokConfig` writes `path.join(engine, 'config.toml')`.

`runTui`:
1. If `!auth()` → `webLoginCommand`, then re-read auth. Still none → print login failure, return 1. Do **not** spawn pager.
2. `assertRuntimeAvailable`. On `RuntimeUnavailable` → write the no-xAI banner (SiSu runtime missing, will not talk to grok.com) and continue into the **Node** TUI path. Do **not** spawn, do **not** `return 1`.
3. On success + binary + TTY → `migrateGrokScratchToEngine`, `purgeChangelogCache`, `writeSisuGrokConfig`, spawn with `sisuGrokBuildEnv()` (no `SISU_HOME`).

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd /Users/steve/Desktop/SiSu-claude/sisu-cli
npm test -- --runInBand src/runtime/launch.test.ts src/tui.test.ts src/runtime/identity.test.ts src/main.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/steve/Desktop/SiSu-claude/sisu-cli
git add src/runtime/launch.ts src/runtime/launch.test.ts src/store.ts src/tui.ts src/tui.test.ts
git commit -m "feat: B-lite host contract isolates engine home and probes /health"
```

Do **not** npm-publish this task alone if it would also unset `XAI_API_KEY`. B-lite keeps the JWT in `XAI_API_KEY`, so it is safe with the 0.2.2 pager.

---

### Task 3: Pager access-point gate + B-full in the same npm

**Files:**
- Create: `sisu-cli/vendor/grok-build/crates/codegen/xai-grok-pager-bin/src/sisu_access_point.rs`
- Modify: `sisu-cli/vendor/grok-build/crates/codegen/xai-grok-pager-bin/src/sisu_boot.rs`
- Modify: `sisu-cli/vendor/grok-build/crates/codegen/xai-grok-pager-bin/src/main.rs` (call `sisu_access_point::enforce()` after `sisu_boot::apply()`)
- Modify: `sisu-cli/vendor/grok-build/crates/codegen/xai-grok-home/src/lib.rs`
- Modify: grok-build `resolve_default_model` `first_or_fallback` (search `fn first_or_fallback` under `xai-grok-shell`)
- Modify: `store_api_key` / `read_api_key` in `xai-grok-shell/src/auth/storage.rs` to honor `GROK_AUTH_PATH`
- Modify: `sisu-cli/src/runtime/launch.ts` B-full branch (`SISU_TOKEN`, unset `XAI_API_KEY`) **only after** the pager stamp check
- Modify: `sisu-cli/scripts/install-pager.js` stamp already exists; refuse spawn of pager whose `.version` < this release
- Test: Rust unit tests next to each change; `sisu-cli/src/runtime/launch.test.ts` B-full; `sisu-cli/src/runtime/identity.test.ts` static checks

**Interfaces:**
- Consumes: `SISU_ACCESS_POINT=1`, `GROK_XAI_API_BASE_URL`, `GROK_MODELS_LIST_URL`, `SISU_TOKEN` (B-full), `SISU_AUTH_PATH`.
- Produces:
  - `sisu_access_point::active() -> bool`
  - `sisu_access_point::enforce()` — missing flag → eprint `run \`sisu\`` and `exit(2)`; URL must contain `/api/runtime/v1` and must not contain `api.x.ai` / `grok.com`; unset `GROK_CODE_XAI_API_KEY`; **do not** self-apply from `~/.sisu/auth.json`.
  - `resolve_grok_home`: if `GROK_HOME` is non-empty it **wins** over `SISU_HOME`.
  - `first_or_fallback` when `active()`: return error, never `crate::models::default_model()`.
  - B-full: `fetch_models_blocking` / `resolve_credentials` use `SISU_TOKEN` as a session bearer **without** going through `has_xai_api_key_env()`.
  - `sampling_config_for_model`: `extra_headers` gets `x-sisu-client` + `x-sisu-client-version` only. `SamplerConfig::header_injector` adds a fresh `x-sisu-client-request-id` on every `post()`.

- [ ] **Step 1: Write failing Rust tests**

In `xai-grok-home` tests:

```rust
#[test]
fn grok_home_wins_when_both_set() {
    // drive resolve_grok_home_from if it is pub(crate); otherwise test via a test-only wrapper
    let grok = OsStr::new("/tmp/engine");
    let sisu = OsStr::new("/tmp/sisu");
    // After the patch, GROK_HOME must win.
}
```

In `sisu_access_point.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn runtime_url_must_be_sisu() {
        assert!(is_sisu_runtime_url("https://www.sisu.chat/api/runtime/v1"));
        assert!(!is_sisu_runtime_url("https://api.x.ai/v1"));
        assert!(!is_sisu_runtime_url("https://cli-chat-proxy.grok.com/v1"));
    }
}
```

In the model-resolution module, add:

```rust
#[test]
fn access_point_first_or_fallback_does_not_yield_grok_46() {
    // with sisu_access_point::active() true and empty catalog, first_or_fallback is Err
    // and the error string does not contain "grok-4.6"
}
```

Host test (B-full, only when `SISU_ACCESS_POINT_BFULL=1` or pager stamp ≥ this version):

```ts
it('B-full unsets XAI_API_KEY and sets SISU_TOKEN once pager stamp matches', () => {
  // after implement: env.XAI_API_KEY undefined, env.SISU_TOKEN === 'jwt'
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /Users/steve/Desktop/SiSu-claude/sisu-cli/vendor/grok-build
cargo test -p xai-grok-home --lib grok_home_wins
cargo test -p xai-grok-pager-bin sisu_access_point
```

Expected: FAIL (module / assertion missing).

- [ ] **Step 3: Implement `enforce`, home win, no grok-4.6 fallback, seam table**

`sisu_boot::apply`: if `SISU_ACCESS_POINT=1`, **do not** set `GROK_HOME` from `~/.sisu`, **do not** write `XAI_API_KEY` from `auth.json`. Leave telemetry-off only if unset.

`sisu_access_point.rs`:

```rust
pub fn active() -> bool {
    std::env::var("SISU_ACCESS_POINT").ok().as_deref() == Some("1")
}

pub fn is_sisu_runtime_url(url: &str) -> bool {
    let lower = url.to_ascii_lowercase();
    lower.contains("/api/runtime/v1")
        && !lower.contains("api.x.ai")
        && !lower.contains("grok.com")
}

pub fn enforce() {
    if !active() {
        eprintln!("run `sisu` — this binary is the SiSu local engine, not a grok.com client");
        std::process::exit(2);
    }
    let base = std::env::var("GROK_XAI_API_BASE_URL").unwrap_or_default();
    if !is_sisu_runtime_url(&base) {
        eprintln!("sisu: refusing to start — GROK_XAI_API_BASE_URL is not a SiSu runtime");
        std::process::exit(2);
    }
    if std::env::var_os("GROK_MODELS_LIST_URL").is_none() {
        eprintln!("sisu: refusing to start — GROK_MODELS_LIST_URL missing");
        std::process::exit(2);
    }
    unsafe {
        std::env::remove_var("GROK_CODE_XAI_API_KEY");
    }
}
```

`resolve_grok_home`:

```rust
pub fn resolve_grok_home() -> Option<PathBuf> {
    let grok = std::env::var_os("GROK_HOME").filter(|v| !v.is_empty());
    if grok.is_some() {
        return resolve_grok_home_from(grok.as_deref(), dirs::home_dir().as_deref());
    }
    let sisu = std::env::var_os("SISU_HOME").filter(|v| !v.is_empty());
    resolve_grok_home_from(sisu.as_deref(), dirs::home_dir().as_deref())
}
```

`store_api_key` / `read_api_key`: if `GROK_AUTH_PATH` is set, use that path; never `~/.sisu/auth.json`.

`first_or_fallback`: if `sisu_access_point::active()`, `return Err(...)`.

Credential seam (B-full, same npm):
- `has_xai_api_key_env` stays false when only `SISU_TOKEN` is set.
- `fetch_models_blocking` / `resolve_credentials` send `Authorization: Bearer $SISU_TOKEN`.
- `should_advertise_xai_api_key` false when `active()`.
- Skip `GET {base}/api-key` when `active()`.
- Force welcome `is_api_key_auth = false` when `active()`.

Stamps: in `sampling_config_for_model`, put only `x-sisu-client` / `x-sisu-client-version` in `extra_headers`. Set `header_injector` to insert a new UUID `x-sisu-client-request-id` on each `post()`.

Host B-full in `sisuGrokBuildEnv` (same commit as the new binary): `delete env.XAI_API_KEY`; `env.SISU_TOKEN = auth?.token`. `runTui` refuses to spawn if `~/.sisu/bin/xai-grok-pager.version` is older than this package version.

Rebuild: `sh sisu-cli/scripts/build-grok-pager.sh`, copy to `~/.sisu/bin`, write `.version`.

- [ ] **Step 4: Run tests**

```bash
cd /Users/steve/Desktop/SiSu-claude/sisu-cli/vendor/grok-build
cargo test -p xai-grok-home --lib
cargo test -p xai-grok-pager --lib first_or_fallback
cd /Users/steve/Desktop/SiSu-claude/sisu-cli
npm test -- --runInBand src/runtime/launch.test.ts src/runtime/identity.test.ts
```

Expected: PASS. Manual: `SISU_ACCESS_POINT=1` missing → pager `--help` still works? **No** — `enforce()` runs at start. Dev: run via `sisu` so the host sets the flag. Direct `./xai-grok-pager --help` exits 2. That is intended.

- [ ] **Step 5: Commit + release the stamped pager**

```bash
# vendor/ is gitignored — commit host-side stamp/refusal + any tracked rust if you vendor a patch file
cd /Users/steve/Desktop/SiSu-claude/sisu-cli
git add src/runtime/launch.ts src/runtime/launch.test.ts src/runtime/identity.test.ts src/tui.ts
git commit -m "feat: access-point pager gate and B-full SISU_TOKEN"
```

Rebuild `.br`, GitHub Release, npm bump (e.g. 0.3.0). Task 2a and 3 must not publish an npm that unsets `XAI_API_KEY` without this binary.

**Merge-blocking:** SiSu catalog + billed turn + no `api.x.ai` + no `grok-4.6`.

---

### Task 4: Welcome identity chrome

**Files:**
- Modify: `sisu-cli/vendor/grok-build/crates/codegen/xai-grok-pager/src/views/welcome/mod.rs` (`render_version_badge`, login label)
- Modify: pager login / logout dispatch (search `run_cli_login`, `Logout`)
- Modify: `sisu-cli/src/tui.ts` — if child exits **10**, run `webLoginCommand` and respawn
- Test: welcome unit tests that already assert `!contains("Grok Build")`; add badge test; `tui.test.ts` exit-10 loop

**Interfaces:**
- Consumes: `SISU_ACCOUNT_EMAIL`, `SISU_ACCOUNT_PLAN`, `SISU_AUTH_PATH`, `sisu_access_point::active()`.
- Produces: badge `{email} · {plan}` never `Logged in with API key`; `/login` and welcome `l` print “exit and run `sisu login`” or `std::process::exit(10)`; `/logout` unlinks `SISU_AUTH_PATH` (SiSu `auth.json`), not grok credentials.

- [ ] **Step 1: Write failing tests**

Welcome test: with `SISU_ACCOUNT_EMAIL=ada@sisu.chat` and `active()`, rendered badge contains `ada@sisu.chat` and does not contain `Logged in with API key`.

`tui.test.ts`:

```ts
it('respawns after pager exit code 10 by running SiSu login', async () => {
  const webLogin = jest.fn().mockResolvedValue('ada@sisu.chat')
  // inject a spawn that first exits 10, then 0 — or a test double on spawnPager
})
```

- [ ] **Step 2: Run to see FAIL**

```bash
cd /Users/steve/Desktop/SiSu-claude/sisu-cli/vendor/grok-build
cargo test -p xai-grok-pager --lib welcome -- --test-threads=1
```

- [ ] **Step 3: Implement badge + login handoff + logout unlink**

When `active()`: force `is_api_key_auth = false` on both the env-key path **and** session-meta `auth_mode == "apikey"`. Login command: no grok OAuth. Logout: `std::fs::remove_file(SISU_AUTH_PATH)`. Host: `child.exit === 10` → `webLoginCommand` → spawn again.

- [ ] **Step 4: Tests PASS**
- [ ] **Step 5: Commit** `fix: welcome shows SiSu account; login is sisu login`

**Merge-blocking:** email/plan badge, no “Logged in with API key”.

---

### Task 5: One catalog — `/api/runtime/v1/models` + `session.json`

**Files:**
- Modify: `sisu-cli/src/runtime/models.ts` (`fetchModelCatalog` URL)
- Modify: `sisu-cli/src/runtime/models.test.ts`
- Modify: pager `/model` writer to merge-write `~/.sisu/session.json` `last_model` via `SISU_AUTH_PATH`’s sibling (host should pass `SISU_SESSION_PATH` or derive `dirname(SISU_AUTH_PATH)/session.json`)
- Test: `models.test.ts`; pager model-setting test if one exists

**Interfaces:**
- Consumes: `GET {api}/api/runtime/v1/models` OpenAI-shaped `{ data: [{ id, name, owned_by }], default_model }`.
- Produces: `fetchModelCatalog` returns the same `CatalogModel[]`. Selection order: `last_model` if still in catalog, else catalog `default_model`, else first row. **No** `GROK_DEFAULT_MODEL`.

- [ ] **Step 1: Write failing catalog test**

```ts
it('fetchModelCatalog uses /api/runtime/v1/models', async () => {
  const http = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      data: [{ id: 'kimi-k2.5', name: 'Kimi K2.5', owned_by: 'sisu' }],
      default_model: 'kimi-k2.5',
    }),
  })
  const { models, defaultModel } = await fetchModelCatalog(http)
  expect(http.mock.calls[0][0]).toMatch(/\/api\/runtime\/v1\/models$/)
  expect(http.mock.calls[0][0]).not.toMatch(/\/api\/chat\/models/)
  expect(models[0].name).toBe('kimi-k2.5')
  expect(defaultModel).toBe('kimi-k2.5')
})
```

- [ ] **Step 2: Run FAIL**
- [ ] **Step 3: Switch `models.ts` and parse `data[]` / `id` fallback to `name`**
- [ ] **Step 4: Tests PASS** (`src/runtime/models.test.ts` + adapter/loop still green)
- [ ] **Step 5: Commit** `feat: host and pager share /api/runtime/v1/models`

---

### Task 6: 402 is SiSu quota, not SuperGrok

**Files:**
- Modify: `sisu-cli/vendor/grok-build/crates/codegen/xai-grok-pager/src/app/dispatch/billing.rs`
- Modify: Node error mapping in `sisu-cli/src/runtime/adapter.ts` / commands if 402 text mentions SuperGrok
- Test: existing billing unit tests under `dispatch/tests/billing.rs`

**Interfaces:**
- Consumes: HTTP 402 with `detail.message` + `detail.code === "quota_exhausted"` (Task 1).
- Produces: when `sisu_access_point::active()`, every `https://grok.com/supergrok` URL becomes `https://www.sisu.chat`; copy says SiSu 充值 / 配额, never SuperGrok.

- [ ] **Step 1: Write failing test** asserting access-point billing strings contain `sisu.chat` and not `supergrok`.
- [ ] **Step 2: Run FAIL**
- [ ] **Step 3: Gate `UPSELL_URL_*` and the three user-facing strings in `billing.rs`**
- [ ] **Step 4: Tests PASS.** Also record two mock ChatCompletions posts and assert distinct `x-sisu-client-request-id`.
- [ ] **Step 5: Commit** `fix: 402 maps to SiSu quota, not SuperGrok`

---

### Task 7: Empty changelog + `sisu update`

**Files:**
- Modify: `sisu-cli/src/main.ts` (add `update` command)
- Modify: `sisu-cli/src/main.test.ts`
- Modify: `sisu-cli/scripts/install-pager.js` (already version-stamps; `sisu update` calls `installPager({ force: true })`)
- Modify: pager `Command::Update` / `xai-grok-update` early return when `active()`
- Test: `src/main.test.ts`, `scripts/install-pager.test.ts`

**Interfaces:**
- Consumes: `installPager({ force: true })`.
- Produces: `sisu update` reinstalls the stamped pager from the GitHub Release for `package.json` version. Welcome changelog slot empty (already `GROK_CHANGELOG_OFFLINE=1` from Task 2). `Command::Update` prints `run sisu update`.

- [ ] **Step 1: Failing test**

```ts
it('runCli update invokes pager install with force', async () => {
  // inject installPager or assert stdout includes "pager" after a stub
})
```

- [ ] **Step 2: Run FAIL**
- [ ] **Step 3: Implement `update` in `runCli`; pager Update command prints the same**
- [ ] **Step 4: Tests PASS**
- [ ] **Step 5: Commit** `feat: sisu update reinstalls the stamped pager`

**Merge-blocking:** empty changelog, `sisu update` exists.

---

### Task 8: Remaining pager platforms

**Files:**
- Modify: `sisu-cli/scripts/install-pager.js` `SUPPORTED`
- Modify: `sisu-cli/scripts/build-grok-pager.sh` or CI workflow
- Modify: `sisu-cli/scripts/install-pager.test.ts`

**Interfaces:**
- Consumes: Task 3 access-point binary (not the 0.2.2 skin).
- Produces: Release assets `xai-grok-pager-{linux-x64,linux-arm64,darwin-x64}.br`. `SUPPORTED` includes those keys. Windows later.

- [ ] **Step 1: Extend `SUPPORTED` test** to expect `linux-x64` etc. (will fail until you add them).
- [ ] **Step 2: Run FAIL**
- [ ] **Step 3: Add keys + CI build jobs + upload `.br`**
- [ ] **Step 4: `npm test -- scripts/install-pager.test.ts` PASS**
- [ ] **Step 5: Commit** `feat: ship linux and darwin-x64 access-point pagers`

---

### Task 9: Twice-launch shipped-path acceptance

**Files:**
- Create: `sisu-cli/src/runtime/access-point.test.ts`
- Modify: none of the product code unless a test finds a hole
- Test: that new file

**Interfaces:**
- Consumes: Tasks 2–6 (not 7).
- Produces: a mock HTTP server covering `GET /api/runtime/health`, `GET /api/runtime/v1/models`, `POST /api/runtime/v1/chat/completions`.

- [ ] **Step 1: Write the acceptance test**

```ts
it('host contract twice: SiSu account, no SISU_HOME on child, no grok-4.6 default', () => {
  // writeAuth → sisuGrokBuildEnv() twice
  // assert SISU_ACCESS_POINT=1, no SISU_HOME, no GROK_DEFAULT_MODEL
  // proxy URL non-empty and not grok.com
  // XAI_API_KEY is the jwt (B-lite) or SISU_TOKEN is the jwt (B-full)
})

it('probe 404 does not spawn pager', async () => {
  // runTui with health 404 → pager not called
})
```

If `findGrokBuildBinary()` returns a path, optionally spawn `--version`/`--help` only if `SISU_ACCESS_POINT=1` is set; without the flag expect exit 2.

- [ ] **Step 2: Run**

```bash
cd /Users/steve/Desktop/SiSu-claude/sisu-cli
npm test -- --runInBand src/runtime/access-point.test.ts
```

Expected: PASS (or FAIL if a prior task drifted — fix the product, not the test).

- [ ] **Step 3: Commit** `test: twice-launch SiSu access-point contract`

---

## Self-review

**Spec coverage**
- Identity / no grok OAuth / logout → Tasks 2, 3, 4
- Catalog + no grok-4.6 → Tasks 3, 5
- Inference + billing 402 → Tasks 1, 3, 6
- Local tools stay local → unchanged; Task 9 does not move them
- Chrome changelog empty + update → Task 7 (user-decided empty)
- Quota bar → explicitly **out** (user-decided later)
- Deploy health gate → Task 1
- Install platforms → Task 8
- XAI_API_KEY shell-wins → Task 2 overwrite
- `SISU_HOME` vs `GROK_HOME` → Task 2 omit + Task 3 home-wins
- Empty proxy → Task 2 pin
- Header stamps per POST → Task 3 `header_injector`

**No placeholders** in task steps. Types match: `RuntimeUnavailable`, `assertRuntimeAvailable`, `sisu_access_point::active`, `require_runtime_quota`, `apply_sisu_client_headers`.

**First increment that proves the product:** Tasks 1–3. Do not start Task 4 until `sisu` against prod (or a mock) shows a SiSu model, not Grok 4.6.
