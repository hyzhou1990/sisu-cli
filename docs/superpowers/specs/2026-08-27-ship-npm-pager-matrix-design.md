# Ship npm 0.3.5 and stop tagging darwin-x64

| Field | Value |
| --- | --- |
| **Title** | Outward install bar: darwin-arm64 pager + npm, x64 off the tag matrix |
| **Author** | SiSu engineering |
| **Date** | 2026-08-27 |
| **Status** | Draft |
| **Audience** | `sisu-cli` maintainers |
| **Repo** | `sisu-cli` (`/tmp/sisu-cli-work` writable clone) |

---

## Problem

「对外生产级」= 别人 `npm install -g @stevezhou/sisu` 能装到 **与 tag 同版本** 的包，并且 **darwin-arm64** 能从 GitHub Release 拉到匹配的 pager `.br`。

此刻（spec 起草时）：

- `origin/main` 与本地 tag `v0.3.5` 都在 `51891b6`
- npm `@stevezhou/sisu` 仍是 **0.3.4**
- GitHub Release `v0.3.5` 还不存在（没有 `.br`）
- `Publish` 已在等 `xai-grok-pager-darwin-arm64.br`（0.3.5 闸门，正确）
- `Pager release`：darwin-arm64 / linux-x64 / linux-arm64 在编；**darwin-x64 排队**
- 0.3.2–0.3.4 的 pager-release 在 macos-13 上排队十几小时，占 runner，且从未成为 npm 闸门

darwin-x64 编在 `macos-13` 上，不是产品闸门，却让「tag 默认四平台」看起来永远没做完。`install-pager.js` 对 404 已经跳过并退回 Node TUI，缺 x64 不会把安装打挂。

## Goal

1. **这一枪 (`v0.3.5`)**：npm 发布 **0.3.5**，Release 上至少有 `xai-grok-pager-darwin-arm64.br`。linux `.br` 有则更好，没有不挡 npm。
2. **以后每个 `v*` tag**：默认只编 **darwin-arm64、linux-x64、linux-arm64**。darwin-x64 只能 `workflow_dispatch` 显式点名，避免再占 macos-13。

Success（硬）：

- `npm view @stevezhou/sisu version` → `0.3.5`
- `https://github.com/hyzhou1990/sisu-cli/releases/download/v0.3.5/xai-grok-pager-darwin-arm64.br` 返回 200
- 干净 darwin-arm64 机 `npm install -g @stevezhou/sisu` 后 `~/.sisu/bin/xai-grok-pager.version` 为 `0.3.5`，`sisu --version` 含 `0.3.5` 与 思溯

Success（软）：同 tag 的 linux-x64 / linux-arm64 `.br` 也上传。缺一不失败。

Failure：darwin-arm64 编译失败或 Publish 等到超时仍无该 `.br` → **不准** 用假二进制或跳过闸门发 npm。

## Non-goals

- 让 darwin-x64 在 tag 上变绿（历史排队；不作为 0.3.5 闸门）
- Windows pager
- 改 `SUPPORTED` 去掉 darwin-x64（保留，404 仍 skip）
- 改 Pin、overlay、JWT、transcript、Muxi、web chat
- 重打 `v0.3.5` 除非 darwin-arm64 **失败** 且必须修 pager 才能发

## Contract that must survive

已在 0.3.5 树上、发 npm 不得破坏：

1. `SISU_ACCESS_POINT=1`；无 flag → exit 2 + `sisu`
2. Host 钉 `/api/runtime/v1`；空目录 ≠ grok-4.6
3. Billed POST 与 `/bundle/archive` 用 `SISU_TOKEN`；`Usage: sisu`
4. `GROK_CLI_CHAT_PROXY_BASE_URL` 缺省或指向 grok.com → 拒绝启动
5. Publish 在 tag 上 **必须先看到** `xai-grok-pager-darwin-arm64.br` 再 `npm publish`
6. 无 `.br` 的平台：postinstall 404 → Node TUI，进程不崩

## Approach

两段，同一份 spec。

### Part 1 — 这一枪（运维，尽量不改 0.3.5 已推提交）

`v0.3.5` 的 workflow 已按 tag 那份 YAML 跑，**改 `pager-release.yml` 不会改变这次 run 的矩阵**。

1. 取消仍 **queued** 的旧 pager-release：`v0.3.2`、`v0.3.3`、`v0.3.4`（只 cancel pager-release，不动已经 success 的 Publish/CI）。目的：给 macos runner 让路，不是补发旧 pager。
2. **不要** cancel `v0.3.5` 的 darwin-arm64 / linux-*。
3. `v0.3.5` 的 darwin-x64 若仍 queued：在 arm64 `.br` 已上传之后 **cancel 该 matrix job**，避免 workflow 永远 queued。`fail-fast: false`，cancel x64 不回滚已上传资产。
4. 盯到：Release 出现 `xai-grok-pager-darwin-arm64.br`，随后 Publish 走完 `npm publish`。
5. 若 Publish 超时（约 40 分钟无 `.br`）：先看 darwin-arm64 job 日志。编译失败 → 修 pager/CI 后 **新 patch tag**（0.3.6），不 force-push `v0.3.5`。仅闸门空转而资产其实已在 → `workflow_dispatch` Publish。
6. 验证：`npm view`、Release 资产 URL、本机若尚未 stamp 则 `npm install -g @stevezhou/sisu@0.3.5`（或等 postinstall）核对 `.version`。

### Part 2 — 以后每个 tag（改 YAML，下一 commit）

文件：`.github/workflows/pager-release.yml`

**Tag `v*` 与未点名 x64 的 dispatch，矩阵只有三行：**

| platform | os |
| --- | --- |
| darwin-arm64 | macos-14 |
| linux-x64 | ubuntu-latest |
| linux-arm64 | ubuntu-24.04-arm |

从 tag 默认 `matrix.include` **删除** darwin-x64 / macos-13。

**darwin-x64 单独 job** `pager darwin-x64`：

- `if: github.event_name == 'workflow_dispatch' && contains(github.event.inputs.platforms, 'darwin-x64')`
- `runs-on: macos-13`，其余步骤与现矩阵 job 相同（fetch pin、protoc、`PACKAGE_BR=1`、tag 时 `action-gh-release` 上传 `xai-grok-pager-darwin-x64.br`）
- 不在 `v*` push 上跑

`workflow_dispatch` 的 `platforms` 默认值改为 `darwin-arm64,linux-x64,linux-arm64`（不再默认带 x64）。只有输入字符串里显式出现 `darwin-x64` 才跑 x64 job。

**不动：**

- `Publish` 仍只等 `xai-grok-pager-darwin-arm64.br`
- `scripts/install-pager.js` `SUPPORTED` 仍含 `darwin-x64`（404 skip）
- README 把「tag 默认预编译」写成 darwin-arm64 + linux；darwin-x64 写「按需 dispatch，常缺则 Node TUI」

注释：pager-release 文件头「SUPPORTED keys」改为「tag 默认三平台；x64 仅 dispatch」。

## Error handling

| Event | Action |
| --- | --- |
| darwin-arm64 cargo 失败 | 不发 npm；修根因；0.3.6 |
| linux 失败、arm64 成功 | npm 仍发；该 linux key 404 → Node TUI |
| darwin-x64 queued / 失败 | 忽略；tag 成功不依赖它 |
| Publish 等到超时且无 `.br` | 不 `npm publish`；见 Part 1.5 |
| 假 `.br` / 空文件 | 禁止。现脚本已 `test -f` 且不上传 placeholder |

## Testing

- Jest：`install-pager.test.ts` 保持 darwin-x64 在 `SUPPORTED` 且 404 skip。不把 x64 改成 unsupported。
- 无新运行时单测覆盖 YAML。落地后用一次 **dry 读**：tag 路径的 `matrix.include` 不含 `darwin-x64`；dispatch job 的 `if` 含 `darwin-x64`。
- Part 1 验证命令（人工）：`npm view @stevezhou/sisu version`；`curl -sI` arm64 `.br` 为 200；本机 `sisu --version`。

## Order

1. Part 1 运维（cancel 旧 queued pager；盯 v0.3.5 资产与 npm）。可与 Part 2 并行写代码，但 **Part 2 的 commit 不参与 v0.3.5 tag**（tag 已指向 `51891b6`）。
2. Part 2 commit 进 `main`，随 **下一个** tag 生效。
3. 若必须在 0.3.5 发出前改 YAML：那只对 **之后** 的 tag 有用，不能抢救本次矩阵。

## Out of scope leftovers (not this spec)

- `/user`、`/feedback/config` leftover grok JWT
- 整文件 overlay 再变薄
- 完整 grok session transcript
- Muxi / 配额条 / Windows
