import type {
  ExtensionAPI,
  ExtensionContext,
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

/**
 * pi-keep-going — thin adapter wiring the pure scheduler/persist/widget modules
 * to a live Pi session. The `/kg` command schedules one-shot follow-up messages;
 * jobs are rebuilt from the current branch on session start and tree navigation.
 */

const WIDGET_ID = "keep-going";
const DEFAULT_MESSAGE = "keep going";
const COMPLETIONS = ["auto", "list", "cancel", "10m", "30m", "1h"];

export default function (pi: ExtensionAPI): void {
  let ctx: ExtensionContext | null = null;
  let scheduler: Scheduler | null = null;

  const remaining = (fireAt: number): string =>
    humanizeDuration(Math.max(0, Math.ceil((fireAt - Date.now()) / 1000)));

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

  function setup(sessionCtx: ExtensionContext): void {
    ctx = sessionCtx;
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
  });

  pi.registerCommand("kg", {
    description:
      "Schedule a one-shot follow-up message (/kg 40m keep going). Also: /kg list, /kg cancel, /kg auto.",
    getArgumentCompletions: (prefix: string) => {
      const items = COMPLETIONS.filter((option) => option.startsWith(prefix)).map(
        (value) => ({ value, label: value }),
      );
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
    const command = parseKgCommand(args, DEFAULT_MESSAGE);

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
}
