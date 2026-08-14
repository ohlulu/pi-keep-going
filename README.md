# pi-keep-going

A [Pi](https://pi.dev) extension that schedules one-shot follow-up messages and
auto-resumes the agent after a provider usage limit resets.

Two capabilities:

1. **One-shot scheduling** — `/kg 40m keep going` sends `keep going` after 40
   minutes. Duration accepts `h/m/s` combos (`90s`, `2h30m`) or `auto` (derive
   the wait from the current provider's usage reset time).
2. **Usage-limit auto-resume** *(on by default)* — when a run stops on a
   provider usage limit, the extension reads the reset time and re-sends a
   continuation message once the window reopens. Supports Anthropic, OpenAI
   Codex, and Google Gemini.

## Install

Not published to npm yet — install from a clone:

```bash
git clone <repo> pi-keep-going
pi install ./pi-keep-going
```

A local-path install is added to `~/.pi/agent/settings.json` by reference, not
copied, so edits in the clone take effect on the next Pi start.

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

See `docs/plan.md` for the full design and `docs/tasks.md` for the milestone
checklist.
