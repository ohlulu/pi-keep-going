import type {
  ExtensionAPI,
  ExtensionContext,
  SessionEntry,
} from "@earendil-works/pi-coding-agent";
import { Scheduler } from "./scheduler";
import {
  rebuildFromBranch,
  recordCancelled,
  recordCreated,
  recordFired,
} from "./persist";
import { renderWidgetLines } from "./widget";
import { pickCompanion, type CompanionStyle } from "./anim";
import { detectColorMode, type ColorMode } from "./sprite";
import { humanizeDuration } from "./duration";
import { parseKgCommand } from "./command";
import { detectUsageLimit, providerFamily, type Cached429, type ProviderFamily } from "./limits/detect";
import type { ResetInfo } from "./limits/types";
import { decideAutoResume, type AutoResumeState } from "./guards";
import { errText, type UsageResult } from "./limits/client";
import { fetchCodexReset } from "./limits/codex";
import { fetchAnthropicReset } from "./limits/anthropic";
import { fetchGeminiReset } from "./limits/gemini";
import {
  loadSettings,
  defaultSettingsIO,
  globalSettingsPath,
  projectSettingsPath,
  DEFAULT_SETTINGS,
  type KeepGoingSettings,
} from "./settings";
import { getAgentDir, readStoredCredential } from "@earendil-works/pi-coding-agent";
import { defaultLeaseIO, leasePath, refreshLease, type LeaseRole } from "./lease";

/**
 * pi-keep-going — thin adapter wiring the pure scheduler/detect/guards/settings
 * modules to a live Pi session. The `/kg` command schedules one-shot follow-ups;
 * on a settled usage-limit error the extension auto-resumes at the reset time.
 */

const WIDGET_ID = "keep-going";

/**
 * Companion frame interval. Deliberately slower than a spinner: the animation is
 * blinks and ear twitches, which read fine this slow, and the widget can be on
 * screen for hours during a usage-limit wait, where every frame is a wakeup on
 * an otherwise idle process.
 */
const ANIMATION_INTERVAL_MS = 900;

export default function (pi: ExtensionAPI): void {
  let ctx: ExtensionContext | null = null;
  let scheduler: Scheduler | null = null;
  let settings: KeepGoingSettings = DEFAULT_SETTINGS;
  let cached429: Cached429 | null = null;
  let autoResume: AutoResumeState = { count: 0, lastResumeAt: null };
  // Generation guard: a per-session id + AbortController so a late usage-API
  // fetch cannot write into a session that was replaced (/new, /resume, fork)
  // or torn down while it was in flight.
  let generation = 0;
  let sessionAbort: AbortController | null = null;
  // Advisory single-firer lease: a second pi process on the same session becomes
  // a read-only reader and never fires, so scheduled jobs are sent exactly once.
  const leaseIO = defaultLeaseIO();
  let leaseRole: LeaseRole = "owner";
  let sessionLeasePath: string | null = null;
  let sessionId = "";
  // Companion animation. The style is rolled once per countdown, not per frame,
  // and the timer only exists while something is actually pending.
  let companionStyle: CompanionStyle | null = null;
  let companionTick = 0;
  let animationTimer: ReturnType<typeof setInterval> | null = null;
  let colorMode: ColorMode = "ansi256";
  let canAnimate = false;

  function stopAnimation(): void {
    if (animationTimer) {
      clearInterval(animationTimer);
      animationTimer = null;
    }
  }

  /** Run the frame timer only while a job is pending. */
  function syncAnimation(hasJobs: boolean): void {
    const wanted = canAnimate && hasJobs;
    if (wanted && !animationTimer) {
      animationTimer = setInterval(() => {
        companionTick += 1;
        refreshWidget();
      }, ANIMATION_INTERVAL_MS);
      animationTimer.unref?.();
    } else if (!wanted) {
      stopAnimation();
    }
  }

  function refreshLeaseRole(): void {
    if (!sessionLeasePath) return;
    leaseRole = refreshLease({
      io: leaseIO,
      path: sessionLeasePath,
      self: { pid: process.pid, sessionId },
      now: Date.now(),
    });
  }

  const AUTO_FETCH_TIMEOUT_MS = 10_000;
  function autoSignal(): AbortSignal {
    const timeout = AbortSignal.timeout(AUTO_FETCH_TIMEOUT_MS);
    return sessionAbort ? AbortSignal.any([sessionAbort.signal, timeout]) : timeout;
  }

  const remaining = (fireAt: number): string =>
    humanizeDuration(Math.max(0, Math.ceil((fireAt - Date.now()) / 1000)));

  const clock = (fireAt: number): string => {
    const d = new Date(fireAt);
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  };

  function refreshWidget(): void {
    if (!ctx || !scheduler) return;
    const jobs = scheduler.list();

    if (jobs.length === 0) {
      // Reset so the next countdown rolls a fresh animal.
      companionStyle = null;
      companionTick = 0;
    } else if (companionStyle === null) {
      companionStyle = pickCompanion();
    }

    const companion =
      canAnimate && companionStyle
        ? { style: companionStyle, tick: companionTick, mode: colorMode }
        : null;

    ctx.ui.setWidget(WIDGET_ID, renderWidgetLines(jobs, Date.now(), companion) ?? undefined);
    syncAnimation(jobs.length > 0);
  }

  function createScheduler(): Scheduler {
    return new Scheduler({
      now: () => Date.now(),
      isIdle: () => ctx?.isIdle() ?? true,
      sendUserMessage: (content, options) => pi.sendUserMessage(content, options),
      recordCreated: (job) => recordCreated(pi, job),
      recordCancelled: (id) => recordCancelled(pi, id),
      recordFired: (id) => recordFired(pi, id),
      onChange: refreshWidget,
      onTick: () => {
        refreshLeaseRole();
        refreshWidget();
      },
      canFire: () => leaseRole === "owner",
      onFire: (job, meta) => {
        if (meta.late) {
          ctx?.ui.notify(`Sent scheduled message after resume: "${job.message}"`, "info");
        }
      },
    });
  }

  function loadConfig(sessionCtx: ExtensionContext): KeepGoingSettings {
    return loadSettings({
      io: defaultSettingsIO(),
      globalPath: globalSettingsPath(),
      projectPath: sessionCtx.isProjectTrusted() ? projectSettingsPath(sessionCtx.cwd) : null,
    });
  }

  function setup(sessionCtx: ExtensionContext): void {
    ctx = sessionCtx;
    settings = loadConfig(sessionCtx);
    // Only the TUI draws widgets; elsewhere the frame timer would be pure waste.
    canAnimate = sessionCtx.mode === "tui";
    colorMode = detectColorMode(process.env);
    stopAnimation();
    companionStyle = null;
    companionTick = 0;
    cached429 = null;
    autoResume = { count: 0, lastResumeAt: null };
    generation += 1;
    sessionAbort?.abort();
    sessionAbort = new AbortController();
    sessionId = sessionCtx.sessionManager.getSessionId();
    sessionLeasePath = leasePath(getAgentDir(), sessionId);
    refreshLeaseRole();
    scheduler?.stop();
    scheduler = createScheduler();
    scheduler.load(rebuildFromBranch(sessionCtx.sessionManager));
    scheduler.start();
    refreshWidget();
  }

  pi.on("session_start", (_event, sessionCtx) => setup(sessionCtx));
  pi.on("session_tree", (_event, sessionCtx) => setup(sessionCtx));
  pi.on("session_shutdown", () => {
    scheduler?.stop();
    scheduler = null;
    stopAnimation();
    companionStyle = null;
    ctx = null;
    cached429 = null;
    generation += 1;
    sessionAbort?.abort();
    sessionAbort = null;
  });

  // Cache the most recent 429 (for reset-time headers); clear it on any success.
  pi.on("after_provider_response", (event) => {
    if (event.status === 429) {
      cached429 = { status: event.status, headers: event.headers, at: Date.now() };
    } else if (event.status >= 200 && event.status < 300) {
      cached429 = null;
    }
  });

  // On a settled usage-limit error, decide whether to auto-resume.
  pi.on("agent_settled", async (_event, settledCtx) => {
    ctx = settledCtx;
    if (!scheduler) return;

    const error = lastAssistantError(settledCtx.sessionManager.getBranch());
    if (!error) return;

    const detection = detectUsageLimit({
      provider: settledCtx.model?.provider ?? "",
      stopReason: error.stopReason,
      errorMessage: error.errorMessage,
      cached429,
      now: Date.now(),
    });
    if (!detection) return;

    // Passive channels can come up empty: provider SDKs throw on 429 before
    // pi-ai's onResponse runs, so `after_provider_response` never fires with
    // 429 headers (cached429 stays null), and e.g. Anthropic's rate_limit_error
    // body carries no reset time. Fall back to the provider usage API before
    // giving up on auto-resume.
    let reset = detection.reset;
    if (!reset) {
      const gen = generation;
      reset = await fetchResetViaUsageApi(settledCtx);
      if (gen !== generation || !scheduler) return; // session replaced meanwhile
    }

    const decision = decideAutoResume({
      reset,
      settings: settings.autoResume,
      state: autoResume,
      now: Date.now(),
    });

    if (decision.action === "schedule") {
      scheduler.add({
        fireAt: decision.fireAt,
        message: settings.autoResume.message,
        kind: "auto-resume",
      });
      autoResume = { count: autoResume.count + 1, lastResumeAt: Date.now() };
      settledCtx.ui.notify(
        `Usage limit reached (${detection.provider}) — auto-resuming at ${clock(decision.fireAt)}.`,
        "info",
      );
    } else if (decision.action === "notify") {
      settledCtx.ui.notify(decision.reason, "warning");
    }
    // "skip" is intentionally silent.
  });

  pi.registerCommand("kg", {
    description:
      "Schedule a one-shot follow-up message (/kg 40m keep going). Also: /kg list, /kg cancel, /kg auto.",
    getArgumentCompletions: (prefix: string) => {
      const options = ["auto", "list", "cancel", "10m", "30m", "1h"];
      const items = options
        .filter((option) => option.startsWith(prefix))
        .map((value) => ({ value, label: value }));
      return items.length > 0 ? items : null;
    },
    handler: async (args, commandCtx) => {
      ctx = commandCtx;
      if (!scheduler) {
        scheduler = createScheduler();
        scheduler.start();
      }
      await runCommand(args, commandCtx);
    },
  });

  async function runCommand(args: string, c: ExtensionContext): Promise<void> {
    const sched = scheduler;
    if (!sched) return;
    const command = parseKgCommand(args, settings.defaultMessage);

    switch (command.kind) {
      case "help":
        c.ui.notify(
          "Usage: /kg <40m|2h30m|90s> [message] | /kg list | /kg cancel | /kg auto",
          "info",
        );
        return;

      case "error":
        c.ui.notify(command.reason, "error");
        return;

      case "auto": {
        const provider = c.model?.provider;
        const family = provider ? providerFamily(provider) : null;
        if (!provider || !family) {
          c.ui.notify(
            "Auto mode isn't supported for the current provider. Use /kg <duration> instead.",
            "warning",
          );
          return;
        }
        const token = await c.modelRegistry.getApiKeyForProvider(provider);
        if (!token) {
          c.ui.notify(`No credential available for ${provider}. Use /kg <duration> instead.`, "warning");
          return;
        }
        const gen = generation;
        const now = Date.now();
        let result: UsageResult;
        try {
          result = await resolveAutoReset(c, provider, family, token, autoSignal(), now);
        } catch (e) {
          result = { ok: false, error: errText(e) };
        }
        if (gen !== generation) return; // session was replaced while awaiting the fetch
        if (!result.ok) {
          c.ui.notify(`Auto mode failed: ${result.error} Use /kg <duration> to schedule manually.`, "warning");
          return;
        }
        const fireAt = result.reset.at.getTime() + settings.autoResume.bufferSeconds * 1000;
        const job = sched.add({ fireAt, message: command.message, kind: "auto" });
        c.ui.notify(
          `Auto: usage resets ~${clock(result.reset.at.getTime())}; sending "${job.message}" at ${clock(fireAt)}.`,
          "info",
        );
        return;
      }

      case "list": {
        const jobs = sched.list();
        if (jobs.length === 0) {
          c.ui.notify("No scheduled messages.", "info");
          return;
        }
        const lines = jobs.map((job) => `• ${remaining(job.fireAt)} — ${job.message}`);
        c.ui.notify(`Scheduled:\n${lines.join("\n")}`, "info");
        return;
      }

      case "cancel": {
        const jobs = sched.list();
        if (jobs.length === 0) {
          c.ui.notify("Nothing to cancel.", "info");
          return;
        }
        if (jobs.length === 1) {
          sched.cancel(jobs[0].id);
          c.ui.notify(`Cancelled "${jobs[0].message}".`, "info");
          return;
        }
        const labels = jobs.map(
          (job, i) => `${i + 1}. ${remaining(job.fireAt)} — ${job.message}`,
        );
        const choice = await c.ui.select("Cancel which scheduled message?", labels);
        if (!choice) return;
        const index = labels.indexOf(choice);
        if (index >= 0) {
          sched.cancel(jobs[index].id);
          c.ui.notify(`Cancelled "${jobs[index].message}".`, "info");
        }
        return;
      }

      case "schedule": {
        const job = sched.add({
          fireAt: Date.now() + command.seconds * 1000,
          message: command.message,
          kind: "manual",
        });
        c.ui.notify(
          `Scheduled "${job.message}" in ${humanizeDuration(command.seconds)}.`,
          "info",
        );
        return;
      }
    }
  }

  /** Best-effort usage-API lookup for auto-resume; null on any failure. */
  async function fetchResetViaUsageApi(c: ExtensionContext): Promise<ResetInfo | null> {
    const provider = c.model?.provider;
    const family = provider ? providerFamily(provider) : null;
    if (!provider || !family) return null;
    try {
      const token = await c.modelRegistry.getApiKeyForProvider(provider);
      if (!token) return null;
      const result = await resolveAutoReset(c, provider, family, token, autoSignal(), Date.now());
      return result.ok ? result.reset : null;
    } catch {
      return null;
    }
  }

  async function resolveAutoReset(
    c: ExtensionContext,
    provider: string,
    family: ProviderFamily,
    token: string,
    signal: AbortSignal,
    now: number,
  ): Promise<UsageResult> {
    if (family === "codex") return fetchCodexReset({ token, signal, now });
    if (family === "anthropic") return fetchAnthropicReset({ token, signal, now });
    // gemini: projectId is an index-signature field on the OAuth credential.
    // One-off read-only lookup (no refresh); modelRegistry.authStorage was removed in pi 0.80.8.
    const cred = readStoredCredential(provider);
    const raw = cred && cred.type === "oauth" ? (cred as Record<string, unknown>).projectId : undefined;
    const projectId = typeof raw === "string" ? raw : undefined;
    return fetchGeminiReset({ token, projectId, signal, now });
  }

  function lastAssistantError(
    branch: SessionEntry[],
  ): { stopReason?: string; errorMessage?: string } | null {
    for (let i = branch.length - 1; i >= 0; i -= 1) {
      const entry = branch[i];
      if (entry.type === "message" && entry.message.role === "assistant") {
        return { stopReason: entry.message.stopReason, errorMessage: entry.message.errorMessage };
      }
    }
    return null;
  }
}
