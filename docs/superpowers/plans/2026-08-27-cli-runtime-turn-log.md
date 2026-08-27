# CLI runtime per-user turn log Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Append one per-user `CliRuntimeTurn` on every billed CLI complete so later analysis can replay the exact `messages` the model saw that round.

**Architecture:** Keep `persist_cli_round` (merged Conversation). Add `CliRuntimeTurn` rows in `persist_cli_turn`, called from `complete_model_round` after the merge persist. JWT `user_id` owns every row. No pager overlay in this increment.

**Tech Stack:** FastAPI, SQLModel, pytest asyncio, sqlite test engine already used in `backend/tests/unit/test_cli_transcript.py`. Implement in `/tmp/wulabllm-work`.

## Global Constraints

- Work in `/tmp/wulabllm-work` (server) and `/tmp/sisu-cli-work` (docs only).
- FastAPI-only. Do not change web `/api/chat/send`.
- CLI conversations stay `source=cli`, `is_private=True`.
- Do not reuse `ConversationProviderResponseCapture` (4000-char cap).
- Do not overlay grok-build stock files. No npm. Pin unchanged.
- Per-user only: never insert a turn whose `user_id` differs from the conversation owner.
- `client_request_id` uniqueness applies only when the string is non-empty.
- Turn JSON size cap 8 MiB (`8 * 1024 * 1024` bytes UTF-8).
- Existing `test_cli_transcript.py` tests must stay green.

**Files:**

- Create: `/tmp/wulabllm-work/backend/app/models/cli_runtime.py` — `CliRuntimeTurn`
- Modify: `/tmp/wulabllm-work/backend/app/models/__init__.py` — export
- Modify: `/tmp/wulabllm-work/backend/app/services/cli_transcript.py` — `persist_cli_turn`
- Modify: `/tmp/wulabllm-work/backend/app/services/cli_runtime.py` — call persist
- Modify: `/tmp/wulabllm-work/backend/tests/unit/test_cli_transcript.py` — new tests
- Create: `/tmp/wulabllm-work/backend/migrations/add_cli_runtime_turns.py`
- Modify: `/tmp/wulabllm-work/backend/app/services/startup_schema_migrations.py` — `CREATE TABLE IF NOT EXISTS`
- Modify: `/tmp/wulabllm-work/backend/app/services/conversation_cleanup.py` — delete turns with conversation

---

### Task 1: CliRuntimeTurn model + persist_cli_turn (TDD)

**Files:**
- Create: `backend/app/models/cli_runtime.py`
- Modify: `backend/app/models/__init__.py`
- Modify: `backend/app/services/cli_transcript.py`
- Test: `backend/tests/unit/test_cli_transcript.py`

**Interfaces:**
- Consumes: `persist_cli_round` (existing) returns a Conversation with `.id` and `.user_id`
- Produces:
  - `class CliRuntimeTurn` table `cli_runtime_turns`
  - `async def persist_cli_turn(session, *, user_id, conversation_id, product_id, messages, text, tool_calls, error, client_request_id=None, kind="turn") -> CliRuntimeTurn | None`

- [ ] **Step 1: Write the failing tests** in `backend/tests/unit/test_cli_transcript.py` (same sqlite `db_session` fixture already in that file):

```python
from app.models import CliRuntimeTurn
from app.services.cli_transcript import persist_cli_turn
from sqlmodel import select

@pytest.mark.asyncio
async def test_persist_cli_turn_keeps_two_snapshots(db_session):
    user_id = "00000000-0000-0000-0000-000000000001"
    await _seed_user(db_session, user_id)
    conv = await persist_cli_round(
        db_session,
        user_id=user_id,
        conversation_key="11111111-1111-1111-1111-111111111111",
        product_id="sisu-pro",
        messages=[{"role": "user", "content": "open foo.py"}],
        text="reading",
        tool_calls=[],
        error=None,
    )
    t1 = await persist_cli_turn(
        db_session,
        user_id=user_id,
        conversation_id=conv.id,
        product_id="sisu-pro",
        messages=[{"role": "user", "content": "open foo.py"}],
        text="reading",
        tool_calls=[],
        error=None,
        client_request_id="req-1",
    )
    t2 = await persist_cli_turn(
        db_session,
        user_id=user_id,
        conversation_id=conv.id,
        product_id="sisu-pro",
        messages=[{"role": "user", "content": "summary of foo.py"}, {"role": "user", "content": "edit it"}],
        text="edited",
        tool_calls=[],
        error=None,
        client_request_id="req-2",
    )
    rows = list((await db_session.exec(select(CliRuntimeTurn).where(CliRuntimeTurn.conversation_id == conv.id))).all())
    assert len(rows) == 2
    assert t1.messages_json == [{"role": "user", "content": "open foo.py"}]
    assert t2.messages_json[0]["content"] == "summary of foo.py"
    assert "open foo.py" not in json.dumps(t2.messages_json)
    assert t1.user_id == conv.user_id == t2.user_id


@pytest.mark.asyncio
async def test_persist_cli_turn_same_request_id_does_not_duplicate(db_session):
    user_id = "00000000-0000-0000-0000-000000000001"
    await _seed_user(db_session, user_id)
    conv = await persist_cli_round(
        db_session, user_id=user_id,
        conversation_key="11111111-1111-1111-1111-111111111111",
        product_id="sisu-lite", messages=[{"role": "user", "content": "a"}],
        text="1", tool_calls=[], error=None,
    )
    a = await persist_cli_turn(
        db_session, user_id=user_id, conversation_id=conv.id, product_id="sisu-lite",
        messages=[{"role": "user", "content": "a"}], text="1", tool_calls=[], error=None,
        client_request_id="req-same",
    )
    b = await persist_cli_turn(
        db_session, user_id=user_id, conversation_id=conv.id, product_id="sisu-lite",
        messages=[{"role": "user", "content": "a"}], text="1", tool_calls=[], error=None,
        client_request_id="req-same",
    )
    rows = list((await db_session.exec(select(CliRuntimeTurn).where(CliRuntimeTurn.conversation_id == conv.id))).all())
    assert len(rows) == 1
    assert a.id == b.id


@pytest.mark.asyncio
async def test_persist_cli_turn_other_user_does_not_attach(db_session):
    a_id = "00000000-0000-0000-0000-000000000001"
    b_id = "00000000-0000-0000-0000-000000000002"
    await _seed_user(db_session, a_id)
    await _seed_user(db_session, b_id)
    key = "11111111-1111-1111-1111-111111111111"
    conv_a = await persist_cli_round(
        db_session, user_id=a_id, conversation_key=key, product_id="sisu-lite",
        messages=[{"role": "user", "content": "secret-a"}], text="ok", tool_calls=[], error=None,
    )
    await persist_cli_turn(
        db_session, user_id=a_id, conversation_id=conv_a.id, product_id="sisu-lite",
        messages=[{"role": "user", "content": "secret-a"}], text="ok", tool_calls=[], error=None,
        client_request_id="req-a",
    )
    conv_b = await persist_cli_round(
        db_session, user_id=b_id, conversation_key=key, product_id="sisu-lite",
        messages=[{"role": "user", "content": "from-b"}], text="ok", tool_calls=[], error=None,
    )
    await persist_cli_turn(
        db_session, user_id=b_id, conversation_id=conv_b.id, product_id="sisu-lite",
        messages=[{"role": "user", "content": "from-b"}], text="ok", tool_calls=[], error=None,
        client_request_id="req-b",
    )
    assert conv_a.id != conv_b.id
    rows_a = list((await db_session.exec(select(CliRuntimeTurn).where(CliRuntimeTurn.user_id == conv_a.user_id))).all())
    rows_b = list((await db_session.exec(select(CliRuntimeTurn).where(CliRuntimeTurn.user_id == conv_b.user_id))).all())
    assert len(rows_a) == 1 and rows_a[0].messages_json[0]["content"] == "secret-a"
    assert len(rows_b) == 1 and rows_b[0].messages_json[0]["content"] == "from-b"
    assert all(row.conversation_id != conv_a.id for row in rows_b)
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /tmp/wulabllm-work/backend && PYTHONPATH=. python -m pytest tests/unit/test_cli_transcript.py::test_persist_cli_turn_keeps_two_snapshots tests/unit/test_cli_transcript.py::test_persist_cli_turn_same_request_id_does_not_duplicate tests/unit/test_cli_transcript.py::test_persist_cli_turn_other_user_does_not_attach -q
```

Expected: FAIL (import `CliRuntimeTurn` / `persist_cli_turn` missing).

- [ ] **Step 3: Minimal implementation**

`backend/app/models/cli_runtime.py`:

```python
from app.models._base import (
    SQLModel, Field, Column, JSON, Text, Index, UniqueConstraint,
    UUID, uuid4, datetime, Optional, _utcnow,
)

class CliRuntimeTurn(SQLModel, table=True):
    __tablename__ = "cli_runtime_turns"
    id: UUID = Field(default_factory=uuid4, primary_key=True)
    user_id: UUID = Field(foreign_key="users.id", index=True)
    conversation_id: UUID = Field(foreign_key="conversations.id", ondelete="CASCADE", index=True)
    kind: str = Field(default="turn", max_length=32, index=True)
    client_request_id: Optional[str] = Field(default=None, max_length=128, index=True)
    product_id: str = Field(default="", max_length=64)
    messages_json: list = Field(default_factory=list, sa_column=Column(JSON, nullable=False))
    assistant_text: str = Field(default="", sa_column=Column(Text, nullable=False))
    tool_calls_json: list = Field(default_factory=list, sa_column=Column(JSON, nullable=False))
    error: Optional[str] = Field(default=None, sa_column=Column(Text, nullable=True))
    payload_json: dict = Field(default_factory=dict, sa_column=Column(JSON, nullable=False))
    truncated: bool = Field(default=False)
    created_at: datetime = Field(default_factory=_utcnow)
    __table_args__ = (
        Index("ix_cli_runtime_turns_user_conv_created", "user_id", "conversation_id", "created_at"),
        UniqueConstraint(
            "user_id", "conversation_id", "kind", "client_request_id",
            name="uq_cli_runtime_turns_request",
        ),
    )
```

Export from `backend/app/models/__init__.py`.

`persist_cli_turn` in `cli_transcript.py`: no-op if session has no `add`; require `user_id` UUID; load existing turn by unique key when `client_request_id` is non-empty and return it; otherwise `session.add(CliRuntimeTurn(...))`. If conversation owner `user_id` can be loaded and differs, raise `ValueError`. Cap `json.dumps(messages)` at 8 MiB.

- [ ] **Step 4: Re-run the three tests** — expected PASS.

- [ ] **Step 5: Commit** in `/tmp/wulabllm-work`:

```bash
git add backend/app/models/cli_runtime.py backend/app/models/__init__.py backend/app/services/cli_transcript.py backend/tests/unit/test_cli_transcript.py
git commit -m "feat(runtime): persist per-user CLI turn snapshots"
```

---

### Task 2: Wire complete_model_round

**Files:**
- Modify: `backend/app/services/cli_runtime.py` (`persist_round` inner function)
- Test: `backend/tests/unit/test_cli_transcript.py`

**Interfaces:**
- Consumes: `persist_cli_turn(...)` from Task 1; `body.get("client_request_id")`
- Produces: each successful or error `persist_round` also inserts a turn

- [ ] **Step 1: Failing test**

```python
@pytest.mark.asyncio
async def test_complete_model_round_writes_turn_snapshot(db_session, monkeypatch):
    user_id = "00000000-0000-0000-0000-000000000001"
    await _seed_user(db_session, user_id)
    rec = _Recorder()
    body = normalize_complete_request({
        "model": "sisu-lite",
        "messages": [{"role": "user", "content": "open foo.py"}],
        "client": "tui",
        "client_request_id": "req-turn-1",
    })
    await complete_model_round(
        body, session=db_session, user_id=user_id,
        call_raw=rec.call_raw, record_usage=rec.record_usage,
        conversation_key="11111111-1111-1111-1111-111111111111",
    )
    rows = list((await db_session.exec(select(CliRuntimeTurn))).all())
    assert len(rows) == 1
    assert rows[0].messages_json == [{"role": "user", "content": "open foo.py"}]
    assert rows[0].assistant_text == "ok"
    assert rows[0].client_request_id == "req-turn-1"
    assert str(rows[0].user_id) == user_id
```

- [ ] **Step 2: Run it** — expected FAIL (no turn row).

- [ ] **Step 3: In `persist_round` after `persist_cli_round` returns `conv`, call `persist_cli_turn` with `conversation_id=conv.id`, `client_request_id=body.get("client_request_id")`, same messages/text/tool_calls/error.**

- [ ] **Step 4: Re-run new test + `tests/unit/test_cli_transcript.py` + `tests/unit/test_cli_runtime.py` — expected PASS.

- [ ] **Step 5: Commit** `feat(runtime): write CLI turn log from complete_model_round`

---

### Task 3: Postgres table + conversation delete

**Files:**
- Create: `backend/migrations/add_cli_runtime_turns.py`
- Modify: `backend/app/services/startup_schema_migrations.py` (add `_ensure_cli_runtime_turns` called from `run_lifespan_schema_migrations`)
- Modify: `backend/app/services/conversation_cleanup.py`

**Interfaces:**
- Produces: `cli_runtime_turns` exists on Postgres; deleting a conversation deletes its turns.

- [ ] **Step 1: Write migration SQL `CREATE TABLE IF NOT EXISTS cli_runtime_turns (...)` matching the model, plus indexes. Add the same SQL in startup schema. Add `sql_delete(CliRuntimeTurn).where(CliRuntimeTurn.conversation_id.in_(conv_ids))` next to other conversation deletes.**

- [ ] **Step 2: `PYTHONPATH=. python -m pytest tests/unit/test_cli_transcript.py tests/unit/test_cli_runtime.py -q` still PASS.

- [ ] **Step 3: Commit** `feat(runtime): migrate cli_runtime_turns and cascade cleanup`

---

## Spec coverage

| Spec item | Task |
| --- | --- |
| Two snapshots, compacted second messages | Task 1 `test_persist_cli_turn_keeps_two_snapshots` |
| Per-user isolation | Task 1 `test_persist_cli_turn_other_user_does_not_attach` |
| complete() writes a turn | Task 2 |
| usage metadata excludes transcript | existing test, Task 2 regression |
| persist_cli_round still runs | Task 2 uses both |
| web chat unchanged | no files under chat routers |
| C2 pager hook | not in this plan (spec non-blocking) |
| 8 MiB cap | Task 1 implementation |
| idempotent client_request_id | Task 1 |
| Postgres table | Task 3 |
