# pi-keep-going

A [Pi](https://pi.dev) extension that schedules one-shot follow-up messages and
auto-resumes the agent after a provider usage limit resets.

Two capabilities:

1. **One-shot scheduling** — `/kg 40m keep going` sends `keep going` after 40
   minutes. Duration accepts `h/m/s` combos (`90s`, `2h30m`) or `auto` (derive
   the wait from the current provider's usage reset time).
2. **Usage-limit auto-resume** — when a run stops on a provider usage limit,
   the extension reads the reset time and re-sends a continuation message once
   the window reopens. Supports Anthropic, OpenAI Codex, and Google Gemini.

> Status: in development. See `docs/plan.md` for the design and `docs/tasks.md`
> for the implementation checklist.

## Install

```bash
pi install npm:pi-keep-going
```

## Development

```bash
npm install
npm run typecheck
npm test
# load locally:
pi -e ./src/index.ts
```
