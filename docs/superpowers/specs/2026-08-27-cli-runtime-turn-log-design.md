# C increment: per-user realtime CLI turn log on SiSu runtime

| Field | Value |
| --- | --- |
| **Title** | Record each billed CLI round as an append-only, per-user turn on the key server |
| **Author** | SiSu engineering |
| **Date** | 2026-08-27 |
| **Status** | Draft |
| **Repos** | `wulabllm` (`/tmp/wulabllm-work`) primary; `sisu-cli` (`/tmp/sisu-cli-work`) host/pager unchanged for C1 |

---

## Problem

North star wants a **remote full conversation record** for later analysis and training. Today `/api/runtime` already persists billed ChatCompletions into a merged `source=cli` Conversation (`persist_cli_round`): unique user/assistant/tool rows, private, Prime-list only.

That merge **cannot reconstruct “what the model saw on turn N.”** After grok-build compaction, the next request’s `messages` is the compacted window. The merged table still has pre-compact lines, but not the per-turn snapshot. Recap and local-only ACP never hit this path.

The recorder must be the **key/billing server** (SiSu `/api/runtime`, JWT user), in real time, as each complete happens. Not Kimi. Not a later upload of `GROK_HOME/sessions`.

## Goal

On every billed CLI complete (`POST /api/runtime/complete` and `POST /api/runtime/v1/chat/completions`), append one **turn** owned by the authenticated `user_id`, containing the exact request `messages` plus the assistant output for that round.

Hard success:

1. Two sequential completes for the same JWT user and `x-sisu-conversation-id` produce **two** turn rows. Turn 2 may have a compacted `messages` array that omits turn 1’s user text; **both** snapshots are stored in full.
2. Turns are keyed by `user_id`. A second JWT user who sends the same `x-sisu-conversation-id` does **not** read or append the first user’s turns (existing “occupied key → new conversation” behavior remains; turns follow the conversation that `persist_cli_round` returned).
3. `record_user_llm_usage` metadata still must not contain transcript text (existing `test_complete_usage_metadata_excludes_transcript_text`).
4. Web chat conversation list still hides `source=cli`. No change to web send/`/api/chat/send`.
5. Existing `persist_cli_round` merge (Conversation + Message + ConversationToolEvent) still runs; this increment **adds** snapshots, it does not replace the merge.

## Non-goals

- Uploading `GROK_HOME/sessions`, `updates.jsonl`, or compaction checkpoint files from disk
- Changing web chat UI or catalog
- Overlaying `sampler_turn.rs` / `notification.rs` or any new stock grok-build file **>80 lines**
- Recap / ACP permission / subagent internals on the pager (C2; see below)
- Export pipeline to training jobs, mixing users into one corpus, or npm/pager retag
- Muxi, quota bar, crate rename

## Architecture

SiSu runtime already sits on every grok-build ChatCompletions. `complete_model_round` already calls `persist_cli_round`. After that call succeeds, persist an append-only `CliRuntimeTurn`:

| Column | Meaning |
| --- | --- |
| `user_id` | JWT user. Required. Never null. |
| `conversation_id` | The cli Conversation `persist_cli_round` returned for this user |
| `kind` | `"turn"` for billed completes |
| `client_request_id` | `x-sisu-client-request-id` / body `client_request_id` when present |
| `product_id` | SiSu product id (`sisu-lite` / `sisu-pro` / `sisu-ultra`) |
| `messages_json` | Exact `body["messages"]` for this HTTP round (list of dicts) |
| `assistant_text` | Model text this round (`""` on error persist) |
| `tool_calls_json` | Parsed tool_calls this round |
| `error` | Error string when the round failed before/during provider call |
| `truncated` | True only if the stored JSON was size-capped |
| `created_at` | Server time |

Idempotency: when `client_request_id` is non-empty, `(user_id, conversation_id, kind, client_request_id)` is unique. A retry with the same request id does not insert a second turn.

Size: store the full `messages` JSON unless encoded size exceeds **8 MiB**. Then set `truncated=true`, keep a prefix plus `sha256` in `payload_json`, and still store `assistant_text` / `tool_calls_json`. Do **not** reuse `ConversationProviderResponseCapture` (that path caps strings at 4000 chars; it is forensics, not a training corpus).

Isolation:

- `persist_cli_round` already refuses to attach a cli conversation owned by another user.
- Turns are only inserted with that conversation’s `user_id`.
- No list/get route in this increment. Analysis reads the table internally. Do not add a user-facing “dump my turns” API here.

Failure: if turn persist fails after a successful model call, **do not swallow** (same as current `persist_cli_round` failure). Billing `record_user_llm_usage` still runs only after persist succeeds, as today.

## C2 (not blocking C1)

Local events that never appear on ChatCompletions (compaction checkpoint `compacted_history`, truncated-full tool frames) cannot be invented by the key server. A later `POST /api/runtime/v1/transcript/events` may append `kind=compaction` / `kind=tool_result_full` rows to the same table, JWT-scoped. **This increment does not require the pager hook.** Do not overlay new giant stock files to emit them.

## Testing

- Unit: `persist_cli_turn` writes two snapshots for one user/conversation; second `messages` can omit first user text; both rows retain their own `messages_json`.
- Unit: same `client_request_id` does not duplicate.
- Unit: user B with the same conversation header does not receive user A’s turn rows.
- Integration: `complete_model_round` with a fake `call_raw` creates a turn whose `messages_json` equals the request messages and whose `assistant_text` equals the stub reply.
- Regression: existing `test_cli_transcript.py` persist/merge/usage-metadata tests still pass.

## Constraints

- FastAPI-only on `wulabllm`. Work in `/tmp/wulabllm-work` and `/tmp/sisu-cli-work` (Desktop TCC).
- Pin stays `77cd7eb`. No npm publish.
- CLI conversations remain `source=cli`, `is_private=True`.
- Fail-closed: no grok.com / api.x.ai JWT (unchanged B).
- Per-user records only. No global transcript bucket.

## Order

1. Model + `persist_cli_turn` + tests (TDD).
2. Call it from `complete_model_round` next to `persist_cli_round`.
3. Postgres `CREATE TABLE IF NOT EXISTS` migration (startup schema + one-shot script).
4. Stop. Do not start C2 pager upload in this increment.
