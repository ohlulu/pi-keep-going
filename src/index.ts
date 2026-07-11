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
import { humanizeDuration } from "./duration";
import { parseKgCommand } from "./command";
import { detectUsageLimit, type Cached429 } from "./limits/detect";
import { decideAutoResume, type AutoResumeState } from "./guards";
import {
  loadSettings,
  defaultSettingsIO,
  globalSettingsPath,
  projectSettingsPath,
  DEFAULT_SETTINGS,
  type KeepGoingSettings,
} from "./settings";

/**
 * pi-keep-going — thin adapter wiring the pure scheduler/detect/guards/settings
 * modules to a live Pi session. The `/kg` command schedules one-shot follow-ups;
 * on a settled usage-limit error the extension auto-resumes at the reset time.
 */

const WIDGET_ID = "keep-going";

export default function (pi: ExtensionAPI): void {
  let ctx: ExtensionContext | null = null;
  let scheduler: Scheduler | null = null;
  let settings: KeepGoingSettings = DEFAULT_SETTINGS;
  let cached429: Cached429 | null = null;
  let autoResume: AutoResumeState = { count: 0, lastResumeAt: null };

  const remaining = (fireAt: number): string =>
    humanizeDuration(Math.max(0, Math.ceil((fireAt - Date.now()) / 1000)));

  const clock = (fireAt: number): string => {
    const d = new Date(fireAt);
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  };

  function refreshWidget(): void {
    if (!ctx || !scheduler) return;
    ctx.ui.setWidget(WIDGET_ID, renderWidgetLines(scheduler.list(), Date.now()) ?? undefined);
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
      onTick: refreshWidget,
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
    cached429 = null;
    autoResume = { count: 0, lastResumeAt: null };
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
    ctx = null;
    cached429 = null;
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
  pi.on("agent_settled", (_event, settledCtx) => {
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

    const decision = decideAutoResume({
      reset: detection.reset,
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

      case "auto":
        c.ui.notify(
          "/kg auto is not available yet (coming in M3). Specify a duration, e.g. /kg 40m.",
          "warning",
        );
        return;

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
