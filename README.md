# pi-keep-going

**English** · [繁體中文](README.zh-TW.md) · [日本語](README.ja.md) · [Français](README.fr.md) · [Español](README.es.md)

A [Pi](https://pi.dev) extension that keeps a run alive across provider usage
limits, and schedules one-shot follow-up messages when you ask for them.

## Zero setup — it just runs

**You do not have to run any command.** Auto-resume is on by default
(`autoResume.enabled: true`), so once the extension is installed it watches
every turn on its own:

1. It caches any `429` response it sees from the provider.
2. When a turn ends on a usage-limit error, it classifies the error and resolves
   the reset time (headers → error body → provider usage API).
3. It schedules the continuation message (`continue`) for `reset + 90s` and
   tells you when that is:
   `Usage limit reached (anthropic) — auto-resuming at 14:05.`

When the window reopens the message is sent and the agent picks up where it
stopped. The `/kg` command exists for the times you want to schedule something
yourself — it is never required for the automatic path.

## Install

```bash
pi install npm:pi-keep-going
```

Pi prompts you to run `pi update --extensions` only when a new **version** is
published: for an npm source it compares the installed `package.json` version
against the registry. Leave the spec unversioned — `npm:pi-keep-going@1.0.0`
counts as pinned, and Pi skips update checks for pinned sources entirely.

To hack on it, install a clone by path instead. A local-path install is
referenced from `~/.pi/agent/settings.json`, not copied, so your edits take
effect on the next Pi start:

```bash
git clone https://github.com/ohlulu/pi-keep-going
pi install ./pi-keep-going
```

## `/kg` command

| Command | Effect |
| --- | --- |
| `/kg 40m keep going` | Send `keep going` after 40 minutes. |
| `/kg 2h30m` | Send the default message (`keep going`) after 2h30m. |
| `/kg 90s ship it` | Duration is largest-unit-first: `d h m s`, each unit at most once. |
| `/kg auto [message]` | Query the current provider's usage API and schedule at the reset time + buffer. |
| `/kg list` | List pending scheduled messages. |
| `/kg cancel` | Cancel a scheduled message (prompts when several are pending). |

Scheduled jobs are persisted per branch, so they survive `/tree`, `/fork`, and
reload. Timers use an absolute fire timestamp checked on a 30s tick, so a job
still fires correctly after the machine sleeps. Nothing enters the LLM context
except the final message that is actually sent.

## Auto-resume

When a turn ends on a usage-limit error, the extension:

1. Classifies the error per provider (from the assistant error message plus any
   cached `429` response headers).
2. Resolves the reset time (headers → embedded time → provider usage API).
   The usage-API step is load-bearing for Anthropic: the SDK throws on 429
   before pi can observe the response, so the unified-reset headers are never
   cached and the error body carries no reset time.
3. Schedules a continuation message at `reset + bufferSeconds`, guarded by the
   settings below.

Auto-resume is skipped silently inside a 5-minute window after a previous
resume (loop protection), and turns into a notification (rather than a schedule)
when the per-session cap is reached or the reset is further away than
`maxWaitHours`.

## Provider support

| Provider | Detection | `auto` usage API |
| --- | --- | --- |
| OpenAI Codex (`openai-codex`) | `hit your ChatGPT usage limit`, `usage_limit_reached`, 429 | `GET /backend-api/wham/usage` → `primary_window.reset_at` |
| Anthropic (`anthropic`) | rate-limit errors, 429, unified-reset headers | `GET /api/oauth/usage` → `five_hour.resets_at` (needs an OAuth login, not an API key) |
| Google Gemini (`google-gemini-cli`) | `RESOURCE_EXHAUSTED`, quota errors | `POST v1internal:retrieveUserQuota` → earliest `buckets[].resetTime` (needs the CLI login's project id) |

Tokens are resolved through `ctx.modelRegistry.getApiKeyForProvider()` (Pi
handles OAuth refresh); the extension never reads `auth.json` or refreshes tokens
itself. If a usage API is unreachable or unsupported, `auto` degrades to a
notification suggesting a manual `/kg <duration>`.

## Settings

Everything below already has a working default — you only need a config file to
change behavior, e.g. to turn auto-resume off or send a different message.

Global config lives at `<pi agent dir>/keep-going.json`. A project-local
override at `<cwd>/<pi config dir>/keep-going.json` is applied **only when the
project is trusted**. Later layers win; unknown or invalid fields are ignored.

```jsonc
{
  "defaultMessage": "keep going",
  "autoResume": {
    "enabled": true,        // master switch for usage-limit auto-resume
    "message": "continue",  // message sent when a window reopens
    "bufferSeconds": 90,    // wait past the reset before sending
    "maxPerSession": 5,     // cap auto-resumes per session
    "maxWaitHours": 24      // beyond this, notify instead of scheduling
  }
}
```

## How it stays safe

- **Generation guard** — every session gets an `AbortController` + generation
  id. `auto` usage-API fetches run with a 10s timeout composed with the session
  signal, and the result is discarded if the session was replaced while the
  request was in flight.
- **Single-firer lease** — if two Pi processes attach to the same session, an
  advisory lock elects one firer; the other runs read-only so a job is sent
  exactly once.

## Development

```bash
npm install
npm run typecheck
npm test
pi -e ./src/index.ts   # load locally
```

`@earendil-works/pi-coding-agent` is a **peer dependency** — it is provided by
the Pi runtime that loads the extension, so it must not be bundled. It is also a
dev dependency here so `tsc` and `vitest` resolve it locally.
