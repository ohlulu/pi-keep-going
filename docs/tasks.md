# pi-keep-going — Implementation Tasks

Progress source of truth for the Ralph loop. Check a box only when that item's
code AND test are green.

## Locked Decisions (v1 — do not deviate)
- Package / repo name: `pi-keep-going`
- Primary command: `/kg` (NOT `/schedule` — plan.md examples predate this rename)
- auto-resume default: ON (`autoResume.enabled: true`)
- Repo root: `/Users/ohlulu/Developer/ohlulu/pi-keep-going`
- Reference: `docs/plan.md` (design + provider facts); prior art: `docs/research.md`

## How To Work (every iteration)
- Work only inside the repo root above. Code/comments/identifiers in English.
- After any code change: run `npm run typecheck` and `npm test` — both must stay green before checking a box.
- Small commits (Conventional Commits) after each milestone gate passes. Autonomous git is allowed.
- Never check a box ahead of green code + test.
- Access token via `ctx.modelRegistry.getApiKeyForProvider(provider)`; credential metadata (projectId) via `ctx.modelRegistry.authStorage.get(provider)`. Never read auth.json directly, never self-refresh.
- Timers: absolute-timestamp + 30s periodic tick (never a single long setTimeout). Guard every fire with `ctx.isIdle()`.
- All state via `pi.appendEntry` (TUI-only). The only thing entering LLM context is the final sent user message.

## M1 — Core one-shot scheduling
- [x] `src/duration.ts`: parse `40m` / `2h30m` / `90s` / `1h30m20s` → seconds; reject invalid; `humanize(seconds)` → "38m 12s"
- [x] `test/duration.test.ts`: valid combos, invalid inputs, humanize round-trip
- [x] `src/limits/types.ts`: `ResetInfo { at: Date; source: "header"|"body"|"usage-api"|"manual"; window?: string }`; `Job { id; fireAt; message; kind: "manual"|"auto-resume"; state: "created"|"cancelled"|"fired" }`
- [x] `src/persist.ts`: appendEntry job events; `rebuildFromBranch(ctx)` reduces `ctx.sessionManager.getBranch()` → live jobs (created && not cancelled/fired)
- [x] `test/persist.test.ts`: reducer over synthetic branch entries (created→cancelled, created→fired, created-only, out-of-order)
- [x] `src/scheduler.ts`: 30s tick comparing `Date.now() >= fireAt`; job CRUD; on fire → `isIdle` guard → `pi.sendUserMessage(msg, { deliverAs: "followUp" })` → mark fired
- [x] `src/widget.ts`: countdown widget via `ctx.ui.setWidget` (nearest job + "(+N more)"); hide when none
- [ ] `src/index.ts`: register `/kg` command (`<duration|auto|list|cancel> [message]`) with `getArgumentCompletions`; wire `session_start` + `session_tree` (rebuild) and `session_shutdown` (clear timers)
- [ ] `/kg <duration> [msg]` creates job (default msg "keep going"); `list` shows pending with remaining time; `cancel` removes (ui.select when multiple)
- [ ] session resume/tree rebuild: expired-but-unfired jobs fire immediately with a note
- [ ] M1 gate: typecheck + tests green; manual `pi -e ./src/index.ts` → `/kg 1m test` fires after ~60s; commit `feat: core /kg one-shot scheduling`

## M2 — usage-limit auto-resume
- [ ] `src/limits/detect.ts`: from last assistant message (stopReason "error" + errorMessage) + cached 429 `{status,headers}` → classify usage-limit per provider → `ResetInfo | null`
- [ ] Provider classifiers: codex (`/hit your ChatGPT usage limit/i`, `~(\d+) min`), anthropic (429 + `rate.?limit`, unified-reset header epoch/ISO tolerant, `retry-after`), gemini (`RESOURCE_EXHAUSTED`/`quota`, `quotaResetTimeStamp`, `retryDelay` "600s", `reset after (…)`, `retry in (…)s`)
- [ ] `test/detect.test.ts`: real-shape fixtures for all three providers (from plan.md §2.2) → correct ResetInfo; non-usage-limit errors → null
- [ ] `src/settings.ts`: load `~/.pi/agent/keep-going.json` (global) + project `<cwd>/<CONFIG_DIR_NAME>/keep-going.json` ONLY when `ctx.isProjectTrusted()`; defaults: autoResume.enabled=true, message "continue", bufferSeconds 90, maxPerSession 5, maxWaitHours 24
- [ ] `test/settings.test.ts`: default load; project override honored only when trusted (mock `ctx.isProjectTrusted`)
- [ ] `src/index.ts`: `after_provider_response` caches latest `{status, headers, at}` on 429
- [ ] `src/index.ts`: `agent_settled` → detect → if usage-limit and guards pass → schedule auto-resume job at reset + bufferSeconds
- [ ] Guards: `autoResume.enabled`, `maxPerSession` counter, `maxWaitHours` (beyond → notify only), consecutive-resume interval < 5min → stop
- [ ] Generation guard: session-scoped AbortController + generation id; `session_shutdown` aborts + invalidates; usage-API fetch uses signal + 10s timeout; verify generation before append/schedule
- [ ] M2 gate: typecheck + tests green; commit `feat: usage-limit auto-resume with trust-gated settings`

## M3 — `auto` mode + usage API clients
- [ ] `src/limits/codex.ts`: GET `https://chatgpt.com/backend-api/wham/usage` (Bearer via `getApiKeyForProvider("openai-codex")`, `ChatGPT-Account-Id` from JWT payload); parse `primary_window.reset_at` / `reset_after_seconds`
- [ ] `src/limits/anthropic.ts`: GET `https://api.anthropic.com/api/oauth/usage` (Bearer, `anthropic-beta: oauth-2025-04-20`, `User-Agent: claude-code/<ver>`); parse `five_hour.resets_at` (ISO)
- [ ] `src/limits/gemini.ts`: POST `v1internal:retrieveUserQuota` (token via `getApiKeyForProvider`, projectId via `authStorage.get("google-gemini-cli")`); parse `buckets[].resetTime`; missing provider/projectId → unsupported
- [ ] `test/clients.test.ts`: mock fetch → 200 parse, 401/403 → clear error, format variants
- [ ] `/kg auto [msg]`: route by `ctx.model.provider` → correct client → reset + bufferSeconds; anthropic API-key cred → error hint; gemini API-key → unsupported (fallback to cached 429 within 60m)
- [ ] `auto` failure UX: unreachable/unsupported → notify + suggest manual `/kg <duration>`
- [ ] M3 gate: typecheck + tests green; commit `feat: auto mode with per-provider usage clients`

## M4 — polish + publish-prep
- [ ] `pi.registerEntryRenderer` scheduled-job card; `ui.notify` on create/fire/cancel/auto-resume-scheduled
- [ ] Same-session dual-process advisory lease (`~/.pi/agent/keep-going/locks/<sessionId>.lock`, PID+mtime, stale reclaim); non-owner read-only
- [ ] Finalize dependency classification (peer vs deps vs devDeps) for `pi install` correctness; document in README
- [ ] README: install, `/kg` usage, settings, provider support matrix, known limitations
- [ ] Backfill `docs/plan.md` as canonical spec (Status: Implemented)
- [ ] M4 gate: typecheck + tests green; commit `docs: README + publish prep`

## Notes / Progress Log
(Append observations, deviations, and manual-verify results here.)
