---
summary: Implementation plan for a Pi extension that schedules one-shot "keep going" messages and auto-resumes after provider usage limits (Anthropic / Codex / Gemini)
read_when:
  - Implementing or reviewing the pi-keep-going extension
  - Investigating how Pi surfaces provider usage-limit errors
  - Looking up provider usage/reset API details (oauth/usage, wham/usage, Code Assist 429)
---

# pi-keep-going — 一次性排程 + Usage-Limit 自動續跑 Extension 計劃書

**Status**: Implemented（M1–M4 核心完成；此文件為 canonical spec）
**Date**: 2026-07-11
**前置研究**: [research.md](./research.md)
**進度來源**: [tasks.md](./tasks.md)（逐項勾選 + 偏離註記）

> **實作摘要（2026-07-11）**：`/kg` 一次性排程、usage-limit 自動續跑（三家偵測器 + usage API client）、generation guard、trust-gated settings、單一觸發 advisory lease 皆已落地，92 tests 綠、`pi -e` 載入乾淨。
> **延後（非阻塞，已記於 tasks.md）**：`registerEntryRenderer` 卡片（widget 已覆蓋可見性，需互動 TUI + pi-tui peer 解析才驗證）；google API-key 路徑的 cached-429<60m fallback（次要）。
> **發布前必辦**：Gemini `retrieveUserQuota` endpoint host/shape 需對真實 `google-gemini-cli` 登入實測（此環境無法驗證）。

## Locked Decisions (v1)

使用者已拍板，取代 §9 暫定值：
- Package / repo 名：`pi-keep-going`
- 主指令：**`/kg`**（下文 §4 等處的 `/schedule` 範例一律讀作 `/kg`）
- auto-resume 預設：**ON**（`autoResume.enabled: true`）
- Repo root：`~/Developer/ohlulu/pi-keep-going`

實作清單見 [tasks.md](./tasks.md)。

## 1. 目標與範圍

| # | 需求 | 落地形式 |
|---|------|---------|
| 1 | 一次性排程 `/schedule 40m keep going`，時間支援 `h/m/s` 組合與 `auto` | 自訂 command + one-shot timer + `pi.sendUserMessage()` |
| 2 | 遇 usage-limit 自動抓 reset 時間，時間到自動續跑 | `agent_settled` 偵測 error → 解析 reset → 排程 continue |
| 3 | 支援 Anthropic / Codex / Gemini 三家 | Provider-aware 偵測器 + usage API clients |

非目標（本版不做）：cron / 週期排程（pi-schedule-prompt 已覆蓋）、跨 session 佇列（session 關閉後 timer 不存活，僅持久化未觸發的 job 供 resume 重建）、Copilot 等其他 provider。

## 2. 調查結論（事實基礎）

### 2.1 Pi Extension API 可用原語

全部來自官方 `docs/extensions.md` 與 `dist/` 原始碼，無需 hack：

| 需求 | API | 備註 |
|------|-----|------|
| `/schedule` 指令 | `pi.registerCommand("schedule", { handler, getArgumentCompletions })` | 支援參數自動補全 |
| 時間到送訊息 | `pi.sendUserMessage(text, { deliverAs: "followUp" })` | idle 時立即觸發 turn；streaming 中排隊到本輪結束 |
| 偵測 agent 停止 | `pi.on("agent_settled")` | 此時 pi 內建 retry（3 次 / 2s→4s→8s backoff）已全部用盡 |
| 讀最後錯誤 | `ctx.sessionManager.getBranch()` 最後一筆 assistant message 的 `stopReason === "error"` + `errorMessage` | pi-ai 將 provider 錯誤 body（cap 4000 chars）塞入 `errorMessage` |
| 攔 429 headers | `pi.on("after_provider_response")` → `{ status, headers }` | Anthropic unified headers 從這裡抓 |
| 倒數顯示 | `ctx.ui.setWidget()` / `ctx.ui.setStatus()` | widget 顯示在 editor 上方 |
| 持久化 | `pi.appendEntry("keep-going-job", data)` + `session_start` 重建 | 不進 LLM context |
| 清理 | `pi.on("session_shutdown")` 清 timer | factory 內不可起 timer（官方明文） |
| **OAuth token 重用** | `await ctx.modelRegistry.getApiKeyForProvider("anthropic" \| "openai-codex")` | **公開 API，自動處理 refresh**。extension 不碰 refresh token，無 rotation 衝突風險 |

Pi retry 分類（`pi-ai/dist/utils/retry.js`）：`rate limit`、`429`、`overloaded` 等視為 retryable（agent 自動重試 3 次後 error 結束）；`quota exceeded`、`insufficient_quota`、`billing` 為 non-retryable（立即 error 結束）。兩種路徑最終都會走到 `agent_settled`，我們的掛載點統一。

另 `settings.json` 的 `retry.provider.maxRetryDelayMs`（預設 60s）：在預設 `retry.provider.maxRetries: 0` 下，provider 要求的等待超過上限時請求直接 fail 並保留原始錯誤文字 —— Gemini「quota will reset after 14h」這類長等待正是走此路徑，錯誤訊息完整可解析。注意：若使用者自行開啟 provider-level retry（`maxRetries > 0`），pi-ai 會以 `Math.min(delay, maxRetryDelayMs)` 截短後重試而非直接 fail（`openai-codex-responses.js` 262-267），偵測器不可假設「長 delay 必然立刻 error 結束」。

### 2.2 三家 provider 的 usage-limit 特徵

#### Anthropic（`anthropic`，OAuth 或 API key）

- 429 headers（未文件化，Claude Code 原始碼與實測封包驗證）：
  - `anthropic-ratelimit-unified-reset` — Claude Code 用 `Number()` 解析（epoch 秒）；社群另有 ISO 字串解讀 → **兩種格式都要容錯**
  - `anthropic-ratelimit-unified-5h-reset` / `-7d-reset` — epoch 秒（實測確認）
  - `anthropic-ratelimit-unified-representative-claim: five_hour` — 指出當前約束視窗
  - `retry-after` — 秒數（官方文件化，API key 路徑）
- 主動查詢：`GET https://api.anthropic.com/api/oauth/usage`
  - Headers：`Authorization: Bearer <token>`、`anthropic-beta: oauth-2025-04-20`、`User-Agent: claude-code/<ver>`（**缺 UA 會被丟進激進限流 bucket**）
  - Response：`five_hour.resets_at`（ISO 8601）、`utilization`（0–100）；`seven_day` 同構
  - Pi 的 OAuth scopes 含 `user:profile` ✓（打此 API 的必要 scope）
- ⚠️ 現況注意：pi 的 Claude Pro/Max 走 **extra usage**（per-token 計費，不吃 plan 5h window，見 pi providers.md）。此分支的 auto-resume 實際觸發率低 —— 主要價值在 API key 用戶的 org rate limit 與未來政策變動的防禦。

#### OpenAI Codex（`openai-codex`，ChatGPT 訂閱 OAuth）

- 錯誤：429 或 error code `usage_limit_reached` / `usage_not_included` / `rate_limit_exceeded`，body 帶 `resets_at`（epoch 秒）
- pi-ai 已轉成固定格式 friendlyMessage：`You have hit your ChatGPT usage limit (plus plan). Try again in ~118 min.` → **errorMessage regex 解析 `~(\d+) min` 即可**（來源：`pi-ai/dist/api/openai-codex-responses.js` parseErrorResponse）
- 主動查詢：`GET https://chatgpt.com/backend-api/wham/usage`
  - Headers：`Authorization: Bearer <token>`、`ChatGPT-Account-Id`（從 access token JWT payload 解出，pi-ai 內同款邏輯）
  - Response：`rate_limit.primary_window.reset_at`（epoch 秒）或 `reset_after_seconds`、`used_percent`、`limit_window_seconds`；`secondary_window` = weekly
  - openusage（3.2k★）同款實作，穩定可移植

#### Google Gemini（`google` API key，或第三方 `google-gemini-cli` OAuth provider ext）

- Code Assist 路徑（cloudcode-pa.googleapis.com）429 body（gemini-cli 官方 test fixtures 驗證）：
  - `message`: `"You have exhausted your capacity on this model. Your quota will reset after 14h24m54s."` — duration 格式 `29s` / `10m` / `14h24m54s`
  - `details[]`：`RetryInfo.retryDelay`（`"600s"`）、`ErrorInfo.metadata.quotaResetTimeStamp`（RFC3339）、`QuotaFailure.violations[].quotaId`（含 `PerDay` → 隔日 reset）
- API key 路徑（generativelanguage.googleapis.com）：`"...Please retry in 34.074824224s."` + `RetryInfo`；外層 message 可能是 stringified JSON 需二次 parse
- 每日配額 reset：午夜太平洋時間（Google Cloud 通則），但 **以 server 回傳的 duration/timestamp 為準**，不硬編碼
- 主動查詢：Code Assist 有 `POST v1internal:retrieveUserQuota` → `buckets[].resetTime`（gemini-cli stats 同款）。依賴 `google-gemini-cli` credential（auth.json 已有，含 projectId）。API key 路徑無 usage API → `auto` 模式 fallback 見 §5.2。

### 2.3 生態系定位（不重工確認）

- `pi-schedule-prompt`（94★）：cron/interval 排程，LLM 工具導向；**無 usage-limit 偵測、無 auto reset 抓取** → 不重疊，本 extension 聚焦「usage-limit aware 的一次性續跑」
- OpenCode 的 `opencode-auto-resume` / `opencode-loop`：真 idle-timer 實作可參考其去抖動設計，但平台不同
- Pi 生態系無同類 extension（前置研究已確認）

## 3. 架構設計

單一 pi package（npm 可發佈），目錄：

```
pi-keep-going/
├── package.json              # pi.extensions 指向 src/index.ts
├── src/
│   ├── index.ts              # factory：command 註冊、event 接線、生命周期
│   ├── scheduler.ts          # one-shot job 管理：絕對時間戳 + 30s tick（睡眠安全）
│   ├── duration.ts           # "40m" / "2h30m" / "90s" 解析 + humanize
│   ├── widget.ts             # 倒數 widget + statusline
│   ├── persist.ts            # appendEntry 持久化 + session_start 重建
│   └── limits/
│       ├── types.ts          # ResetInfo { at: Date; source: "header"|"body"|"usage-api"|"manual"; window?: string }
│       ├── detect.ts         # errorMessage / status+headers → 是否 usage-limit + 解析 reset
│       ├── anthropic.ts      # oauth/usage client + unified headers 解析
│       ├── codex.ts          # wham/usage client + "~N min" 解析 + JWT account id
│       └── gemini.ts         # RetryInfo / "reset after Xh Ym Zs" / "retry in Ns" 解析
└── test/                     # vitest：duration、detect（真實 fixture）、clients（mock fetch）
```

關鍵設計決策：

1. **Timer 用絕對時間戳 + 週期 tick（30s），不用單發長 `setTimeout`**。Node 的 timer 在系統睡眠時暫停計時，長 setTimeout 醒來後行為不可靠；tick 比對 `Date.now() >= job.fireAt` 跨睡眠正確，且順便驅動 widget 倒數更新。
2. **送訊息一律走 `pi.sendUserMessage(msg, { deliverAs: "followUp" })`**。斷點防護：fire 前檢查 `ctx.isIdle()`；若 agent 正在跑（使用者手動又開工了），改 queue 為 followUp 自然銜接，不打斷。
3. **Token 與 credential metadata 分兩條唯讀路徑**：access token 一律走 `ctx.modelRegistry.getApiKeyForProvider()`（pi 自動處理 OAuth refresh）；credential metadata（如 Gemini 的 `projectId`）走公開 export 的 `ctx.modelRegistry.authStorage.get(provider)` 唯讀取得。兩者都不解析 auth.json 檔案、絕不自行 refresh —— 避免 refresh-token rotation 衝突（Codex refresh token 是 single-use，openusage 為此寫了一整套 conflict 處理，我們直接繞開這個坑）。`getApiKeyForProvider()` 只回傳 `string | undefined`，metadata 必須走 authStorage，這是 M3 Gemini quota client 的前提。
4. **usage-limit 偵測雙通道**：
   - 通道 A（被動、零成本）：`after_provider_response` 於 429 時快取 `{ status, headers, at }`（僅保留最近一筆）
   - 通道 B（權威）：`agent_settled` 時檢查最後 assistant message `stopReason === "error"`，errorMessage 跑 provider-aware 分類
   - Reset 時間決策順序：headers 快取 → errorMessage 內嵌時間 → 主動打 usage API → 全失敗則通知使用者手動 `/schedule`
5. **廣播最小化**：所有狀態（pending job、resume 排程）只進 `appendEntry`（TUI-only），不污染 LLM context；唯一進 context 的是最終送出的 user message 本身。
6. **Branch-aware job 狀態（reducer 模式）**：job 生命週期三態 `created` / `cancelled` / `fired` 全部以 `appendEntry` 記錄。重建點不只 `session_start` —— `session_tree`（`/tree` 導航不重啟 session）與 fork 後的 `session_start` 都要：先清空所有 in-memory timer，再掃 `ctx.sessionManager.getBranch()` 依序 reduce 出每個 job 的最終狀態，只為「created 且未 cancelled/fired」的 job 重排 timer。使用者切回 job 建立前的分支節點時，該 job 的 entry 不在 branch 上，timer 自然消失；切回來則自然復活。
7. **非同步防護（generation guard）**：每個 session runtime 建立一個 `AbortController` + 遞增 generation id；`session_shutdown` 時 abort 並失效整個 generation。所有 usage API fetch 掛 `signal` 並設 10s timeout，回來後先驗證 generation 仍是現行值才允許 append entry 或排 timer —— 防止 session replacement（`/new`、`/resume`、fork）後，遲到的 fetch 對已銷毀的 runtime 寫入。

## 4. 指令 UX 規格

```
/schedule 40m keep going          # 40 分鐘後送 "keep going"
/schedule 2h30m continue the task # h/m/s 任意組合：90s、1h、2h30m、1h30m20s
/schedule auto                    # 從當前 model 的 provider 抓 reset 時間 + buffer，送預設訊息
/schedule auto run the tests      # auto + 自訂訊息
/schedule list                    # 列出 pending jobs（含剩餘時間）
/schedule cancel                  # 取消（單一 job 直接取消；多筆時 ui.select）
```

- 省略訊息時預設 `keep going`（settings 可改）
- `auto` 解析流程見 §5.2；抓不到 reset 時間時報錯並提示手動指定
- `getArgumentCompletions` 提供 `auto` / `list` / `cancel` / 常用 duration 補全
- Widget（有 job 時顯示）：`⏱ keep going in 38m 12s (16:42)` ；多筆顯示最近一筆 + `(+N more)`
- 一次性 job 觸發後自動移除；session resume 時重建未觸發的 job，已過期的 job 立即補送（附說明文字）並通知

Settings（`~/.pi/agent/keep-going.json`；project 層 `<cwd>/{CONFIG_DIR_NAME}/keep-going.json` 可覆蓋，**僅在 `ctx.isProjectTrusted()` 為 true 時載入** —— 全域 extension 不得吃下未信任 repo 的設定，避免惡意 repo 注入自動訊息）：

```jsonc
{
  "defaultMessage": "keep going",
  "autoResume": {
    "enabled": true,          // usage-limit 自動續跑總開關
    "message": "continue",
    "bufferSeconds": 90,      // reset 時間後多等的緩衝
    "maxPerSession": 5,       // 防無限循環
    "maxWaitHours": 24        // reset 超過此時長改為只通知、不排程
  }
}
```

## 5. 核心流程

### 5.1 Usage-limit 自動續跑（需求 2）

```
agent_settled
  └─ 最後 assistant message stopReason === "error"?
       ├─ no → 不動作
       └─ yes → detect.ts 分類 errorMessage（+ 快取的 429 headers）
            ├─ 非 usage-limit（context overflow、auth、5xx…）→ 不動作
            └─ usage-limit
                 ├─ 解析 reset 時間（headers → body 文字 → usage API）
                 ├─ 檢查防護（enabled? 次數 < maxPerSession? 等待 < maxWaitHours?）
                 ├─ 排 one-shot job（reset + bufferSeconds）
                 ├─ widget 顯示 "usage limit — resuming at HH:MM"
                 └─ 時間到 → isIdle 檢查 → sendUserMessage(autoResume.message)
```

分類 pattern（初版，fixtures 齊全後迭代）：

| Provider 判定 | usage-limit patterns | reset 解析 |
|---------------|----------------------|-----------|
| `ctx.model.provider === "openai-codex"` | `/hit your ChatGPT usage limit/i`、`usage_limit_reached` | `~(\d+) min` → now + N min；失敗 → wham/usage |
| `anthropic` | `/rate.?limit/i` + status 429、`rate_limit_error` | headers unified-reset（epoch 或 ISO 容錯）→ `retry-after` → oauth/usage `five_hour.resets_at` |
| `google` / `google-gemini-cli` | `RESOURCE_EXHAUSTED`、`/quota/i` | `quotaResetTimeStamp`（RFC3339）→ `retryDelay`（"600s"）→ `reset after ((\d+h)?(\d+m)?(\d+(\.\d+)?s)?)` → `retry in ([\d.]+)s` |

### 5.2 `auto` 模式（需求 1 的 auto）

依「當前 model 的 provider」路由：

1. `openai-codex` → `GET wham/usage` → `primary_window.reset_at ?? now + reset_after_seconds`
2. `anthropic` → `GET api/oauth/usage` → `five_hour.resets_at`（credential 為 API key 而非 OAuth 時此 API 不可用 → 報錯提示）
3. `google-gemini-cli` → `POST v1internal:retrieveUserQuota` → `buckets[].resetTime`（M3 再做，M1 先報「Gemini 不支援 auto，請指定時間」）。quota-context 組裝：access token 走 `getApiKeyForProvider("google-gemini-cli")`，`projectId` 走 `authStorage.get("google-gemini-cli")` 的 credential metadata；任一缺失（未裝 provider ext / 無 projectId）→ 明確報「Gemini auto 不可用」並提示手動指定時間。`google`（API key）→ 不支援 auto，但若 60 分鐘內有快取的 429 reset 資訊則採用
4. 所有路徑 + `bufferSeconds`

## 6. 風險與對策

| 風險 | 等級 | 對策 |
|------|------|------|
| 未文件化 API（oauth/usage、wham/usage、unified headers）變動 | 高 | 全部軟降級：API 失敗只影響 `auto` 與 reset 精度，核心排程不受影響；錯誤訊息引導手動指定時間 |
| errorMessage 文字隨 pi-ai 版本變動 | 中 | detect.ts 用真實 fixture 測試；pattern 集中一檔好維護；漏判 = 不動作（安全側） |
| 無限續跑循環（resume → 立刻又打爆 → 又 resume） | 中 | `maxPerSession` 上限 + 每次 resume 在 widget/notify 留痕；連續兩次間隔 < 5min 直接停 |
| 系統睡眠跨越 fire 時間 | 中 | tick 架構天然處理：醒來後第一個 tick 補觸發 |
| 與 pi-schedule-prompt 併裝衝突 | 低 | 命令名不同（`/schedule` vs `/schedule-prompt`）；若使用者裝了兩者，考慮改名 `/kg`（開放問題 #2） |
| Anthropic extra usage 政策使 Claude 分支少用 | 低 | 保留分支但不過度投資；API key org rate limit 仍受益 |
| token scope 不足（如 `claude setup-token` 產生的 inference-only token） | 低 | usage API 401/403 → 明確報錯 + fallback 手動 |
| 同一 persisted session 被兩個 pi process 同時 resume → job 重複觸發 | 低 | 平台級未定義行為（雙開本身會使 session file append 交錯損壞，非本 extension 特有）。M1 文件化為 known limitation；M4 加輕量 advisory lease（`~/.pi/agent/keep-going/locks/<sessionId>.lock`，PID + mtime、stale 自動回收），非 lease owner 只讀不排 timer |

## 7. 實作里程碑

### M1 — 核心排程（MVP，可先出）
- [ ] `duration.ts`：parse + humanize（單元測試）
- [ ] `scheduler.ts`：tick 架構、job CRUD、isIdle 防護
- [ ] `/schedule <duration> [msg]`、`list`、`cancel` + 補全
- [ ] `widget.ts` 倒數
- [ ] `persist.ts`：appendEntry 三態 reducer（created/cancelled/fired）+ `session_start` **與 `session_tree`** 重建 + 過期補送
- [ ] `session_shutdown` 清理 + generation guard 骨架（AbortController + generation id）

### M2 — usage-limit 自動續跑
- [ ] `after_provider_response` 429 headers 快取
- [ ] `detect.ts`：三家分類器 + 真實 fixture 測試
- [ ] `agent_settled` 接線 + 防護（maxPerSession / maxWaitHours / 間隔檢查）
- [ ] usage API fetch 全掛 generation guard + 10s timeout（測試：延遲 fetch 後 `/new`、`/fork`、`/resume` 不得寫入新 runtime）
- [ ] settings 載入（global + project 覆蓋，project 層過 `ctx.isProjectTrusted()` gate）

### M3 — `auto` 模式
- [ ] `codex.ts`：wham/usage client（JWT account-id 解析）
- [ ] `anthropic.ts`：oauth/usage client
- [ ] `gemini.ts`：retrieveUserQuota（token via getApiKeyForProvider + projectId via authStorage.get()；任一缺失報不支援）
- [ ] `auto` 路由 + 快取 429 fallback

### M4 — 打磨與發佈
- [ ] entry renderer（排程卡片）
- [ ] `ui.notify` 時機統一（排程建立/觸發/取消/auto-resume 排入）
- [ ] 同 session 雙 process advisory lease（sessionId lockfile，stale 回收）
- [ ] README（英文）+ 安裝說明（`pi install npm:pi-keep-going`）
- [ ] npm publish + 回填本文件為 spec

## 8. 測試計畫

- 單元：`duration.ts` 全格式、`detect.ts` 用三家真實 errorMessage/headers fixtures（本計劃書 §2.2 的樣本起步）
- 整合：mock fetch 測三個 usage client（200 / 401 / 格式變異）
- 手動 E2E：
  1. `/schedule 1m test` → 60s 後訊息送出、widget 消失
  2. streaming 中 fire → followUp 排隊不打斷
  3. `pi -e ./src/index.ts` 掛載，Codex 模型跑到 usage limit（或 mock `after_provider_response`）→ 驗證 auto-resume 排程
  4. 睡眠喚醒後補觸發
  5. `/schedule 5m x` → `/tree` 切回排程前節點 → timer 消失；切回原分支 → timer 復活
  6. 排程存在時 `/fork`、`/new`、`/resume` 各一輪 → 舊 runtime 無殘留 timer、無遲到寫入
- 驗證指令：`npx vitest run`（實作時以 repo 實際配置為準）

## 9. 開放問題（已定案）

1. **Extension 名稱** → `pi-keep-going`
2. **命令名** → `/kg`
3. **auto-resume 預設** → ON
4. **獨立 repo** → `~/Developer/ohlulu/pi-keep-going`

## Related
- [research/2026-07-11-idle-timeout-keep-going-extension.md](../research/2026-07-11-idle-timeout-keep-going-extension.md) ← 前置生態系調查
