# pi-keep-going

[English](../README.md) · **繁體中文** · [日本語](ja.md) · [Français](fr.md) · [Español](es.md)

一個 [Pi](https://pi.dev) extension：在 provider 觸發 usage limit 後自動接手續跑，
也能在你需要時排程一次性的後續訊息。

## 零設定 — 裝上就會動

**你不需要下任何指令。** Auto-resume 預設開啟（`autoResume.enabled: true`），
extension 裝好之後就會自己盯著每一輪對話：

1. 快取 provider 回傳的任何 `429` response。
2. 當一輪對話以 usage-limit 錯誤結束時，分類該錯誤並解析 reset 時間
   （headers → error body → provider usage API）。
3. 把續跑訊息（`continue`）排在 `reset + 90s`，並告訴你時間點：
   `Usage limit reached (anthropic) — auto-resuming at 14:05.`

額度視窗重新開啟時訊息就會送出，agent 從中斷的地方接著跑。`/kg` 指令是留給你
想自己排程的情況——自動流程完全用不到它。

## 安裝

```bash
pi install npm:pi-keep-going
```

只有發布新**版本**時，Pi 才會提示你執行 `pi update --extensions`——對 npm source
它比對的是已安裝的 `package.json` version 與 registry 上的版本。source 字串不要帶
版本號：`npm:pi-keep-going@1.0.0` 會被視為 pinned，而 Pi 對 pinned source 完全跳過
更新檢查。

要開發的話改用本地路徑安裝。local-path 安裝是在 `~/.pi/agent/settings.json` 裡以參照
方式記錄，不是複製檔案，所以你的修改在下次啟動 Pi 時就會生效：

```bash
git clone https://github.com/ohlulu/pi-keep-going
pi install ./pi-keep-going
```

## `/kg` 指令

| 指令 | 效果 |
| --- | --- |
| `/kg 40m keep going` | 40 分鐘後送出 `keep going`。 |
| `/kg 2h30m` | 2 小時 30 分後送出預設訊息（`keep going`）。 |
| `/kg 90s ship it` | 時間由大單位排到小單位：`d h m s`，每個單位最多出現一次。 |
| `/kg auto [message]` | 查詢目前 provider 的 usage API，排在 reset 時間 + buffer。 |
| `/kg list` | 列出待送出的排程訊息。 |
| `/kg cancel` | 取消排程訊息（有多筆時會詢問取消哪一筆）。 |
| `/kg help` | 顯示用法。單打 `/kg` 效果相同。 |

排程工作會依 branch 持久化，所以 `/tree`、`/fork`、reload 之後都還在。計時器記的是
絕對觸發時間戳、以 30 秒 tick 檢查，因此機器睡眠後仍能正確觸發。除了最後真正送出的
那則訊息之外，不會有任何東西進入 LLM context。

## 倒數 widget

只要有排程在等，編輯器上方就會出現倒數，旁邊帶一隻會動的小動物 —— 狗或貓，每次
倒數開始時隨機挑一隻：

```
⏱ keep going in 7m 58s (14:23)
```

圖是原創的 pixel art，用 truecolor half-block 繪製，一個終端機字元格裝兩個像素。
色彩會自動降級：終端機支援就用 24-bit，否則退到 256 色，完全沒有顏色時改用純
ASCII 圖案。每 900ms 換一幀，而且只有在有排程時才會有 timer，閒置的 session 完全
不受影響。

## Auto-resume

一輪對話以 usage-limit 錯誤結束時，extension 會：

1. 依 provider 分類錯誤（讀 assistant 的 error message，加上快取的 `429`
   response headers）。
2. 解析 reset 時間（headers → 錯誤訊息內嵌時間 → provider usage API）。
   usage API 這一步對 Anthropic 是關鍵：SDK 在 429 時直接 throw，pi 根本觀察不到
   那個 response，所以 unified-reset headers 永遠不會被快取，而 error body 裡也沒有
   reset 時間。
3. 在 `reset + bufferSeconds` 排一則續跑訊息，並套用下面的設定作為防護。

前一次 auto-resume 之後的 5 分鐘內會靜默跳過（迴圈保護）；當 session 上限用完、或
reset 時間比 `maxWaitHours` 還遠時，會改成通知而不是排程。

## Provider 支援

| Provider | 偵測方式 | `auto` usage API |
| --- | --- | --- |
| OpenAI Codex (`openai-codex`) | `hit your ChatGPT usage limit`、`usage_limit_reached`、429 | `GET /backend-api/wham/usage` → `rate_limit.primary_window.reset_at` |
| Anthropic (`anthropic`) | rate-limit 錯誤、429、unified-reset headers | `GET /api/oauth/usage` → `five_hour.resets_at`（需要 OAuth 登入，不能是 API key） |
| Google Gemini (`google-gemini-cli`、`google`) | `RESOURCE_EXHAUSTED`、quota 錯誤 | `POST v1internal:retrieveUserQuota` → 最早的 `buckets[].resetTime`（需要 CLI 登入的 project id） |

Token 一律透過 `ctx.modelRegistry.getApiKeyForProvider()` 取得（OAuth refresh 由 Pi
處理）；extension 不會自己讀 `auth.json`，也不會自己 refresh token。若 usage API 連
不上或不支援，`auto` 會降級成一則通知，建議你手動 `/kg <duration>`。

## 設定

以下每一項都已經有可用的預設值——只有要改變行為時才需要設定檔，例如關掉
auto-resume 或換一則續跑訊息。

全域設定放在 `<pi agent dir>/keep-going.json`。專案層級的覆寫放在
`<cwd>/<pi config dir>/keep-going.json`，且**只在專案被信任時**才會套用。後面的層級
覆蓋前面的；無法辨識或格式錯誤的欄位會被忽略。

```jsonc
{
  "defaultMessage": "keep going",
  "autoResume": {
    "enabled": true,        // usage-limit auto-resume 的總開關
    "message": "continue",  // 額度視窗重開時送出的訊息
    "bufferSeconds": 90,    // reset 之後再多等幾秒才送
    "maxPerSession": 5,     // 每個 session 的 auto-resume 次數上限
    "maxWaitHours": 24      // 超過這個等待時間就改成通知，不排程
  }
}
```

## 安全性設計

- **Generation guard** — 每個 session 都有自己的 `AbortController` 與 generation
  id。`auto` 的 usage-API 請求帶著 10 秒 timeout 與 session signal 組合而成的
  signal；若請求還在飛的時候 session 已經被換掉，結果會直接丟棄。
- **Single-firer lease** — 若有兩個 Pi process 掛在同一個 session 上，advisory lock
  會選出唯一的觸發者，另一個以唯讀模式執行，確保每則排程訊息只送一次。

## 開發

```bash
npm install
npm run typecheck
npm test
pi -e ./src/index.ts   # 本地載入
```

`@earendil-works/pi-coding-agent` 是 **peer dependency**——由載入 extension 的 Pi
runtime 提供，所以絕對不能打包進來。它同時也列在 dev dependency，讓 `tsc` 和
`vitest` 在本地解析得到。
