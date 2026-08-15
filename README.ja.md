# pi-keep-going

[English](README.md) · [繁體中文](README.zh-TW.md) · **日本語** · [Français](README.fr.md) · [Español](README.es.md)

プロバイダの利用上限（usage limit）をまたいで実行を継続させ、必要なときには
単発のフォローアップメッセージも予約できる [Pi](https://pi.dev) 拡張機能です。

## 設定不要 — 入れるだけで動く

**コマンドを実行する必要はありません。** 自動再開（auto-resume）はデフォルトで
有効（`autoResume.enabled: true`）なので、インストールした時点から拡張機能が
すべてのターンを自動で監視します。

1. プロバイダから返ってきた `429` レスポンスをキャッシュする。
2. ターンが利用上限エラーで終了したら、そのエラーを分類してリセット時刻を解決する
   （ヘッダー → エラーボディ → プロバイダの usage API）。
3. 継続メッセージ（`continue`）を `リセット時刻 + 90 秒` に予約し、その時刻を通知する:
   `Usage limit reached (anthropic) — auto-resuming at 14:05.`

上限枠が回復するとメッセージが送信され、エージェントは中断したところから作業を
再開します。`/kg` コマンドは自分で予約したいとき用であり、自動処理には一切不要です。

## インストール

```bash
pi install git:github.com/ohlulu/pi-keep-going
```

npm には未公開です。開発する場合はクローンをパス指定でインストールしてください。
ローカルパスでのインストールは `~/.pi/agent/settings.json` から参照されるだけで
コピーはされないため、編集内容は次回の Pi 起動時に反映されます。

```bash
git clone https://github.com/ohlulu/pi-keep-going
pi install ./pi-keep-going
```

## `/kg` コマンド

| コマンド | 動作 |
| --- | --- |
| `/kg 40m keep going` | 40 分後に `keep going` を送信する。 |
| `/kg 2h30m` | 2 時間 30 分後にデフォルトメッセージ（`keep going`）を送信する。 |
| `/kg 90s ship it` | 時間指定は大きい単位から順に `d h m s`。各単位は最大 1 回まで。 |
| `/kg auto [message]` | 現在のプロバイダの usage API を照会し、リセット時刻 + バッファに予約する。 |
| `/kg list` | 予約中のメッセージを一覧表示する。 |
| `/kg cancel` | 予約をキャンセルする（複数ある場合は選択を求める）。 |

予約ジョブはブランチごとに永続化されるため、`/tree`、`/fork`、リロードを経ても
残ります。タイマーは絶対時刻のタイムスタンプを 30 秒ごとのティックで確認する方式
なので、マシンがスリープしたあとでも正しく発火します。実際に送信される最終的な
メッセージ以外は、LLM のコンテキストに一切入りません。

## 自動再開（auto-resume）

ターンが利用上限エラーで終了すると、拡張機能は次のように動作します。

1. プロバイダごとにエラーを分類する（アシスタントのエラーメッセージと、
   キャッシュされた `429` レスポンスヘッダーから判定）。
2. リセット時刻を解決する（ヘッダー → メッセージ内の時刻 → プロバイダの usage API）。
   この usage API の段階は Anthropic では必須です。SDK が 429 で例外を投げるため
   pi はレスポンスを観測できず、unified-reset ヘッダーがキャッシュされることはなく、
   エラーボディにもリセット時刻が含まれないからです。
3. 下記の設定をガードとして、`リセット時刻 + bufferSeconds` に継続メッセージを予約する。

直前の自動再開から 5 分以内は無言でスキップされます（ループ防止）。セッションごとの
上限に達した場合や、リセットまでの待ち時間が `maxWaitHours` を超える場合は、予約では
なく通知に切り替わります。

## 対応プロバイダ

| プロバイダ | 検出方法 | `auto` の usage API |
| --- | --- | --- |
| OpenAI Codex (`openai-codex`) | `hit your ChatGPT usage limit`、`usage_limit_reached`、429 | `GET /backend-api/wham/usage` → `primary_window.reset_at` |
| Anthropic (`anthropic`) | レート制限エラー、429、unified-reset ヘッダー | `GET /api/oauth/usage` → `five_hour.resets_at`（API キーではなく OAuth ログインが必要） |
| Google Gemini (`google-gemini-cli`) | `RESOURCE_EXHAUSTED`、クォータエラー | `POST v1internal:retrieveUserQuota` → 最も早い `buckets[].resetTime`（CLI ログインの project id が必要） |

トークンは `ctx.modelRegistry.getApiKeyForProvider()` 経由で取得します（OAuth の
リフレッシュは Pi が担当）。拡張機能が `auth.json` を直接読んだり、自前でトークンを
リフレッシュすることはありません。usage API に到達できない、または未対応の場合、
`auto` は手動の `/kg <duration>` を提案する通知にフォールバックします。

## 設定

以下の項目にはすべて実用的なデフォルト値があります。設定ファイルが必要になるのは
挙動を変えたいとき、たとえば自動再開を止めたり、別のメッセージを送りたいときだけです。

グローバル設定は `<pi agent dir>/keep-going.json` に置きます。プロジェクト単位の
上書きは `<cwd>/<pi config dir>/keep-going.json` に置き、**プロジェクトが信頼されて
いる場合にのみ**適用されます。後ろのレイヤーが優先され、未知または不正なフィールドは
無視されます。

```jsonc
{
  "defaultMessage": "keep going",
  "autoResume": {
    "enabled": true,        // 利用上限による自動再開のマスタースイッチ
    "message": "continue",  // 上限枠が回復したときに送るメッセージ
    "bufferSeconds": 90,    // リセット後に追加で待つ秒数
    "maxPerSession": 5,     // セッションあたりの自動再開回数の上限
    "maxWaitHours": 24      // これを超える待ち時間なら予約せず通知する
  }
}
```

## 安全性の仕組み

- **世代ガード（generation guard）** — セッションごとに `AbortController` と世代 ID を
  持ちます。`auto` の usage API 呼び出しは 10 秒のタイムアウトとセッションシグナルを
  合成したシグナルで実行され、リクエスト中にセッションが差し替わった場合、結果は
  破棄されます。
- **単一発火リース（single-firer lease）** — 同じセッションに 2 つの Pi プロセスが
  接続した場合、アドバイザリロックで発火役を 1 つだけ選出します。もう一方は読み取り
  専用で動作するため、ジョブはちょうど 1 回だけ送信されます。

## 開発

```bash
npm install
npm run typecheck
npm test
pi -e ./src/index.ts   # ローカルで読み込む
```

`@earendil-works/pi-coding-agent` は **peer dependency** です。拡張機能を読み込む Pi
ランタイムから提供されるため、バンドルしてはいけません。`tsc` と `vitest` がローカルで
解決できるよう、dev dependency にも入れてあります。

設計の詳細は `docs/plan.md`、マイルストーンのチェックリストは `docs/tasks.md` を
参照してください。
