# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- Auto-resume no longer gives up when the reset time cannot be read. When the
  usage API fails (for example because it is rate-limited itself), a retry is
  scheduled after 30 minutes, doubling for each consecutive retry and bounded by
  `maxPerSession` and `maxWaitHours`. Previously the session only showed a
  notification and stopped.
- Sessions without a UI (print and JSON mode, including subagent children) no
  longer query usage APIs, write lease files, or schedule jobs that could never
  fire. Parallel subagents hitting a limit at once could exhaust the usage API
  before the interactive session asked for its reset time.
- `/kg auto` jobs now survive a restart or `/tree` navigation; they were dropped
  when the job log was replayed.

### Added

- Each handled usage-limit error is recorded as a `keep-going-auto-resume`
  session entry (action, reset source, usage-API error), so a missed resume can
  be diagnosed from the session file. The same error is never handled twice,
  even across a restart.

### Changed

- The enabled, per-session cap, and 5-minute loop guards are checked before the
  usage API is queried.

## [1.1.1] — 2026-11-05

### Fixed

- Auto-resume now triggers for Codex usage limits reported over WebSocket
  (`Codex error: The usage limit has been reached`). That message carries no
  reset time, so the reset is read from the Codex usage API.

## [1.1.0] — 2026-08-28

### Added

- Animated companion in the countdown widget: original pixel art of a dog or a
  cat, picked at random each time a countdown starts. Rendered as truecolor
  half-blocks, falling back to 256 colours and then to flat ASCII art depending
  on what the terminal supports. Frames advance every 900ms and the timer only
  runs while a job is pending, so an idle session is unaffected.

### Fixed

- Corrected the provider table in the READMEs: the Codex reset time is read from
  `rate_limit.primary_window.reset_at`, and the Gemini row was missing the
  `google` provider id.

## [1.0.0] — 2026-08-17

First release.

### Added

- Usage-limit auto-resume, on by default. When a turn ends on a provider usage
  limit, the extension resolves the reset time and re-sends a continuation
  message once the window reopens. No command and no configuration required.
- Provider support for OpenAI Codex, Anthropic, and Google Gemini — error
  classification per provider, plus a usage-API lookup for each
  (`wham/usage`, `oauth/usage`, `v1internal:retrieveUserQuota`).
- `/kg <duration> [message]` to schedule a one-shot follow-up. Durations are
  largest-unit-first `d h m s` combos such as `40m`, `2h30m`, `90s`.
- `/kg auto [message]` to query the current provider's usage API and schedule at
  the reset time plus a buffer.
- `/kg list` and `/kg cancel` to inspect and drop pending messages.
- Branch-aware persistence, so scheduled jobs survive `/tree`, `/fork`, and
  reload. Timers fire off an absolute timestamp checked on a 30s tick, so a job
  still fires correctly after the machine sleeps.
- Countdown widget showing pending jobs.
- Layered settings at `<pi agent dir>/keep-going.json`, with a project-local
  override that applies only when the project is trusted.
- Guards against runaway resumes: a per-session cap, a `maxWaitHours` ceiling
  beyond which the extension notifies instead of scheduling, and a 5-minute
  silent-skip window after a previous resume.
- Generation guard, so a usage-API request still in flight cannot write into a
  session that was replaced by `/new`, `/resume`, or a fork.
- Advisory single-firer lease, so two Pi processes attached to the same session
  send a scheduled job exactly once.
- READMEs in English, Traditional Chinese, Japanese, French, and Spanish.

[1.1.1]: https://github.com/ohlulu/pi-keep-going/releases/tag/1.1.1
[1.1.0]: https://github.com/ohlulu/pi-keep-going/releases/tag/1.1.0
[1.0.0]: https://github.com/ohlulu/pi-keep-going/releases/tag/1.0.0
