# Research: Session 閒置逾時後自動送出「keep going」訊息的擴充功能 — Pi / Claude Code / Codex CLI 現況調查

**Date**: 2026-07-11
**Mode**: Quick（3 平行 worker + GitHub API 交叉驗證）
**Queries executed**: 約 15 次 Brave 搜尋 + 11 次 GitHub API 驗證
**Sources consulted**: 24 kept / 約 40 total

## Summary

三個生態系都有人在解這類問題，但幾乎沒有人做「單純閒置 N 分鐘 → 自動送 keep going」這個最直白的版本；社群工具幾乎都掛在**特定事件**上觸發（rate-limit 訊息、Stop hook、AskUserQuestion 對話框），而非「純粹等了 40 分鐘沒動靜就送訊息」。三者中，**Pi 生態系反而是最接近使用者需求、且已有成熟現成方案**：[tintinweb/pi-schedule-prompt](https://github.com/tintinweb/pi-schedule-prompt)（94★，production-ready）已支援 `schedule="+40m"` 的一次性排程，把訊息以使用者訊息的形式注入 agent，機制上就是「session 開著、45 分鐘後丟一則 prompt」，跟你要做的東西幾乎一樣——差別只在於它是「固定時間排程」而不是「偵測到閒置才排程」。Claude Code 這邊官方已把類似需求正式化為外掛（`ralph-wiggum`）與內建指令（`/goal`、`/loop`），但都是靠 Stop hook 或固定 interval，不是「偵測到閒置」；社群另有一群工具（`claude-auto-resume`、`claude-auto-retry`）解決的是「usage limit 打到之後自動續跑」，觸發條件是偵測到 rate-limit 字串，不是計時器。Codex CLI 原生完全沒有這塊，社群也只有 `cirosantilli/codex-continue` 一個 expect 腳本、同樣是抓 usage-limit 訊息而非閒置計時；官方 issue（[#21073](https://github.com/openai/codex/issues/21073)、[#31386](https://github.com/openai/codex/issues/31386)）顯示這是尚未實作的既有需求。

## Findings

1. **Pi：`pi-schedule-prompt`（tintinweb，94★，production-ready）幾乎就是你要的功能，只差「閒置偵測」這一步。** 它提供 `schedule_prompt` 工具，`schedule` 參數接受相對時間（`+5m`、`+40m`）、interval、cron 或 ISO 時間戳，`type="once"` 時會在指定延遲後把 prompt 當成一則使用者訊息注入目前的 agent session，並有 live widget 顯示倒數、下次執行時間、執行次數。README 明確寫著 *"schedules only fire while a pi session is open in this directory; nothing is queued"*——這跟你描述的「session 到期後 40 分鐘再送 keep going」場景高度吻合：只要 session 還開著，計時器就會準時觸發。它的限制是**必須手動或由 LLM 主動呼叫工具建立排程**（例如你跟它說「40 分鐘後提醒我 keep going」），並不會自己偵測「agent 已經閒置多久」再決定要不要送——這正是你的擴充功能要補上的差異化功能。([tintinweb/pi-schedule-prompt README](https://raw.githubusercontent.com/tintinweb/pi-schedule-prompt/master/README.md))

2. **Pi 官方 SDK 已經內建你需要的所有原語，缺的只是「idle-timer + 自動觸發」的組裝邏輯。** `extensions.md` 文件中 `AgentSession.followUp(text, opts)` 可以「排一則訊息，等 agent 進入 idle 狀態後才送出」；`opts.triggerTurn: true` 則可以在 agent 已經是 idle 時立刻觸發一次 LLM 回應；`ctx.isIdle()` / `ctx.waitForIdle()` 提供狀態查詢與等待。換句話說，你要做的擴充功能骨架其實是：在每次 turn 結束時用 `setTimeout` 開一個計時器（例如 40 分鐘），若期間沒有新的使用者輸入把計時器 reset 掉，時間到就呼叫 `ctx.session.followUp("keep going", { triggerTurn: true })`。這條路線在本機 `$PI_ROOT/docs/extensions.md` 中有完整 API 佐證，屬於官方支援、非 hack。另一個值得參考的既有 prior art 是 `pi-lazy-extensions`（[pi.dev/packages/pi-lazy-extensions](https://pi.dev/packages/pi-lazy-extensions)），它已經在用「可設定的 `idleTimeout`（預設 10 分鐘）」這個 config 慣例，只是方向相反（閒置後**卸載**工具省資源，而不是送訊息）——可以直接抄它的設定檔 UX 模式。

3. **Claude Code 官方已經把「不要停」這件事變成正式產品線，但全部是事件觸發，不是閒置計時。** Anthropic 在 `anthropics/claude-code` 倉庫的 `plugins/ralph-wiggum/`（已在 GitHub API 驗證存在，含 `hooks/stop-hook.sh`）把社群發明的 "Ralph Wiggum" 技巧（Geoffrey Huntley，2025 年 7 月提出：`while :; do cat PROMPT.md | claude; done`）收編為官方外掛：用 **Stop hook** 攔截 Claude 想結束回合的動作（exit code 2 擋下退出），把同一份 prompt 重新餵回去，在**同一個 session 內**無限循環，直到 `--max-iterations` 或 `--completion-promise` 命中為止。Claude Code 2.1 另外內建 `/goal`（v2.1.139+，驗證條件達成前持續工作）、`/loop`（固定 interval 重跑，例如 `/loop 5m check if deploy finished`）、`/batch`（平行 worktree agent）。這些都是「觸發即重試」或「固定週期」，**沒有一個是「偵測到閒置 N 分鐘才觸發」**。相關 GitHub issue（[#31854](https://github.com/anthropics/claude-code/issues/31854)）證實社群仍在要求「incoming webhook 喚醒閒置 session」這種功能，Anthropic 尚未提供，現有替代方案（`/loop`）被使用者抱怨「長時間掛著會燒很多 token」。

4. **Claude Code 唯一算是原生「閒置逾時」設定的是 `askUserQuestionTimeout`，但範圍窄到只管對話框，不是通用 keep-going。** Claude Code ≥ v2.1.200 的 `settings.json` 支援 `askUserQuestionTimeout`（僅 user-scope），可設 `"60s"`、`"5m"`、`"10m"`，作用是當 `AskUserQuestion` 對話框閒置超過此時間，Claude 會自動選擇當前預選項並繼續——這確實是「偵測閒置→自動繼續」的原生機制，但**僅限於單一 UI 對話框情境**，不是「整個 session 閒置後主動送一則自訂訊息」。([dev.classmethod.jp 文章](https://dev.classmethod.jp/en/articles/claude-code-ask-user-question-timeout/))

5. **Claude Code 社群工具解決的是另一個問題：usage-limit 打到後自動續跑，不是通用閒置計時器。** `terryso/claude-auto-resume`（789★）、`cheapestinference/claude-auto-retry`（220★，npm 套件）都是偵測終端輸出裡的 rate-limit 字串，解析出重置時間，睡到那個時間點再透過 `tmux send-keys` 或重新呼叫 `claude` 送出 `"continue"`（`claude-auto-resume` 甚至支援自訂成 `"keep going"`）。這類工具的「等待時長」是由 rate-limit reset 時間**反推**出來的，而不是由使用者設定「40 分鐘」這種固定閒置窗；也完全是在 CLI/shell 層外部監控，不是走 Claude Code 的 hook/extension API。另有 `hjpetrovic/claude-code-goal` 用 Stop hook 做出類 Codex `/goal` 的持續工作模式，同樣是事件觸發（每次 turn 結束時檢查），非閒置計時。

6. **Codex CLI 原生沒有這塊，且是三者中最弱的一環；社群也只有一個對標工具，同樣抓的是 usage-limit 而非閒置。** `cirosantilli/codex-continue`（PyPI 套件，expect 腳本）監看 Codex 終端輸出裡的 usage-limit 訊息，解析重置時間後睡到期，注入預設訊息 `"Continue"`（可用 `--continue-prompt` 自訂）並按 Enter。官方 issue [#21073](https://github.com/openai/codex/issues/21073) 明確指出 Codex CLI **目前不會**在 usage-limit 解除時自動續跑，社群提案是加一個 `codex --auto-resume-on-limit` flag 或 `~/.codex/config.toml` 裡的 `[usage_limits] auto_resume = true`，且指出協定裡其實已經有 `resets_at` 欄位、只是被丟棄沒用上；另一個 issue [#31386](https://github.com/openai/codex/issues/31386) 顯示連 Codex 自家的 `/goal` 功能，quota 用完暫停後也要手動按繼續。r/codex 社群目前流傳的做法非常原始：手動打 "CONTINUE" 排隊 10 次，或有人半開玩笑地說「這問題不比自己寫一套軟體簡單」——換句話說，**Codex CLI 生態系目前完全沒有你要的這種擴充功能，是三者中最大的空白**。

7. **跟 Pi 最像、但目標平台不同的替代方案是 OpenCode 生態系的兩個工具，兩者都做到了「真正的閒置計時觸發」。** `Mte90/opencode-auto-resume`（70★）：若連續 48 秒（`chunkTimeoutMs` + `gracePeriodMs`，可設定）沒有 stream 事件，自動送出 `"continue"`，失敗 3 次後放棄，退避重試。`ByBrawe/opencode-loop`（97★，明確定位為「Claude Code style auto-continue for OpenCode」）更接近你的設計目標：同時支援「idle/status 事件觸發」與「內部 due-timer/heartbeat 排程器」兩種機制——因為作者發現純事件驅動的 plugin 系統在沒有新 UI 事件時無法喚醒排程任務，所以額外做了一個心跳排程器。它的 `/loop 1m --no-now continue the project` 語法（等 1 分鐘、閒置時觸發）幾乎就是你要的功能的完整實作範例，只是換了個受眾（OpenCode 而非 Pi/Claude Code/Codex）。這兩個工具的原始碼是目前找到**最接近「閒置計時 + 自動續傳訊息」正確模式**的公開實作，值得直接參考其計時器/去抖動設計。

8. **Claude Code「Agent Teams」內建的 idle-nudge 機制是另一組值得參考的官方 prior art，但用途是多 agent 對話，不是單一 session 續跑。** 實驗性功能 `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` 底下，子 agent 會先收到約 3 次「idle nudge」才會被標記為 idle，之後如果 inbox 有新訊息會有「auto-wake」機制重新啟動它（[Issue #28075](https://github.com/anthropics/claude-code/issues/28075)）。這證明 Anthropic 內部已經有「偵測閒置 → nudge → 必要時 auto-wake」的設計思路，只是目前只開放給 peer-to-peer 的 agent 對話情境，尚未開放成一般使用者可設定的「session 閒置 N 分鐘後送某句話」功能。

## Comparison

| 平台 | 官方原生機制 | 觸發條件 | 社群工具（最具代表性） | 是否為「純閒置計時器」 |
|---|---|---|---|---|
| **Pi** | `followUp()` / `ctx.isIdle()` SDK 原語（無現成打包擴充） | 需自行組裝 | [pi-schedule-prompt](https://github.com/tintinweb/pi-schedule-prompt)（94★，`+40m` 一次性排程） | 排程本身用固定時間，非閒置偵測；但可作為現成骨架 |
| **Claude Code** | `/goal`、`/loop`、`ralph-wiggum` 官方外掛（Stop hook）、`askUserQuestionTimeout` | Stop hook / 固定 interval / 對話框逾時 | [claude-auto-resume](https://github.com/terryso/claude-auto-resume)（789★）、[claude-auto-retry](https://github.com/cheapestinference/claude-auto-retry)（220★）、[ralph-claude-code](https://github.com/frankbria/ralph-claude-code)（9524★） | 否——皆為 rate-limit 偵測或固定 interval |
| **Codex CLI** | 無（官方 issue [#21073](https://github.com/openai/codex/issues/21073)、[#31386](https://github.com/openai/codex/issues/31386) 待處理） | 無 | [codex-continue](https://github.com/cirosantilli/codex-continue)（expect 腳本） | 否——rate-limit 偵測 |
| （對照組）OpenCode | 無官方原生 | — | [opencode-auto-resume](https://github.com/Mte90/opencode-auto-resume)（70★，48s 無 stream 事件觸發）、[opencode-loop](https://github.com/ByBrawe/opencode-loop)（97★，idle 事件 + heartbeat timer 雙軌） | **是**——這兩個是唯一找到的真閒置計時器實作 |

## Conflicts & Caveats

- 「Ralph Wiggum」一詞在不同社群脈絡下指涉不同東西：Geoffrey Huntley 原始定義是**外部 bash while-loop**（每輪重啟全新 process）；Anthropic 官方外掛版本則是**同一 session 內用 Stop hook 循環**——機制完全不同，引用時要分清楚。
- 部分 Reddit 討論串（r/ClaudeAI、r/codex）被反爬蟲機制擋下，只能取得搜尋摘要、無法驗證完整內文，相關描述已標記為「snippet only」。
- Agent 結論（無引用，僅供參考）：以你描述的需求（「session 到期後，指定時間如 40m，時間到自動送 keep going」）來看，最省力的落地方式**不是從零寫**，而是（a）直接借用 `pi-schedule-prompt` 現有的排程機制作為送訊息的執行層，（b）自己另外包一層「偵測 agent 是否已閒置 X 分鐘」的邏輯（用 `ctx.isIdle()` + 你自己的 last-activity 時間戳），閒置達標時才呼叫排程 / `followUp`。這樣可以重用一個已經 94★、production-ready 的擴充，而不用重新造排程輪子。

## Sources

### Kept
- [pi-schedule-prompt (tintinweb)](https://github.com/tintinweb/pi-schedule-prompt) — GitHub repo / README — Pi 生態系最接近的現成排程機制，94★，已驗證 stars/更新時間
- Pi `docs/extensions.md`（隨 `@earendil-works/pi-coding-agent` 安裝的本機文件） — 官方文件 — `followUp`/`ctx.isIdle()`/`triggerTurn` API 佐證
- [pi-lazy-extensions](https://pi.dev/packages/pi-lazy-extensions) — 官方套件頁 — 既有 idleTimeout 設定慣例參考
- [narumiruna/pi-extensions](https://github.com/narumiruna/pi-extensions) — GitHub repo — 139★，`/goal`、caffeinate 等相關 Pi 擴充集合
- [anthropics/claude-code plugins/ralph-wiggum](https://github.com/anthropics/claude-code/tree/main/plugins/ralph-wiggum) — 官方 repo — 已用 GitHub API 驗證路徑存在（`hooks/`、`commands/`、`scripts/`）
- [frankbria/ralph-claude-code](https://github.com/frankbria/ralph-claude-code) — GitHub repo — 9524★，最受歡迎的社群 Ralph 實作
- [terryso/claude-auto-resume](https://github.com/terryso/claude-auto-resume) — GitHub repo — 789★，已驗證
- [cheapestinference/claude-auto-retry](https://github.com/cheapestinference/claude-auto-retry) — GitHub repo — 220★，已驗證
- [hjpetrovic/claude-code-goal](https://github.com/hjpetrovic/claude-code-goal) — GitHub repo — Stop hook 型 `/goal` 實作
- [dev.classmethod.jp — askUserQuestionTimeout](https://dev.classmethod.jp/en/articles/claude-code-ask-user-question-timeout/) — 技術部落格（Classmethod） — 官方設定文件的二手說明
- [anthropics/claude-code Issue #31854](https://github.com/anthropics/claude-code/issues/31854) — GitHub issue — 證實 `/loop` 已存在但耗 token，webhook 喚醒需求未解
- [anthropics/claude-code Issue #28075](https://github.com/anthropics/claude-code/issues/28075) — GitHub issue — Agent Teams idle-nudge/auto-wake 機制
- [openai/codex Issue #21073](https://github.com/openai/codex/issues/21073) — GitHub issue — 官方確認無 auto-resume-on-limit
- [openai/codex Issue #31386](https://github.com/openai/codex/issues/31386) — GitHub issue — `/goal` 暫停後需手動續跑
- [cirosantilli/codex-continue](https://github.com/cirosantilli/codex-continue) — GitHub repo — Codex CLI 唯一對標社群工具
- [Mte90/opencode-auto-resume](https://github.com/Mte90/opencode-auto-resume) — GitHub repo — 70★，48s 閒置偵測，已驗證
- [ByBrawe/opencode-loop](https://github.com/ByBrawe/opencode-loop) — GitHub repo — 97★，idle 事件 + heartbeat timer 雙軌，已驗證
- [ghuntley.com/ralph](https://ghuntley.com/ralph/) — 部落格（Geoffrey Huntley） — Ralph Wiggum 技巧原始出處

### Dropped
- MindStudio 「Keep Claude Code Running 24/7」系列 — OS 層防休眠（caffeinate/pmset），與訊息層 keep-going 無關
- Reddit r/ClaudeAI「automatically continue command once 5h session limit renews」 — 內容被反爬擋下，僅摘要可用，且屬 rate-limit 類方案而非閒置計時
- Reddit r/codex 兩則討論串 — 內容被反爬擋下，僅摘要可用
- Sitepoint「Running AI Coding Agents for 13 Days Straight」 — HTTP 403，無法驗證全文

## Gaps

- 沒有找到任何一個工具是「純粹偵測閒置 N 分鐘（不管任何特定觸發字串）→ 送出自訂 keep-going 訊息」且明確鎖定 Pi / Claude Code / Codex CLI 三者之一的成品；`opencode-auto-resume` / `opencode-loop` 雖然做到了真閒置偵測，但目標平台是 OpenCode。
- GitHub Code Search（非 web search）可能可以找到更多把 `followUp(..., {triggerTurn:true})` 跟 timer 結合的隱藏小專案，本次未執行（Brave web search 對 GitHub blob 內容的抓取被 JS render 擋下）。
- 建議下一步：若確定要動手做，可以先用 `gh api search/code` 搜尋 `followUp triggerTurn setTimeout` 在 Pi 擴充生態系裡是否已有人做過類似組合，確認沒有重工後再開始設計。
