import { humanizeDuration } from "./duration";
import type { Job } from "./limits/types";

/** Countdown widget rendering. Pure so it can be unit-tested. */

const ICON = "⏱";
const MAX_MESSAGE = 40;

function truncate(text: string, max = MAX_MESSAGE): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 1)}…`;
}

function formatClock(epochMs: number): string {
  const d = new Date(epochMs);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

/**
 * Render widget lines for the current jobs, or `null` when there are none
 * (caller should clear the widget). Shows the nearest job's countdown and a
 * `(+N more)` suffix when other jobs are pending.
 */
export function renderWidgetLines(
  jobs: readonly Job[],
  now: number,
): string[] | null {
  if (jobs.length === 0) return null;

  const sorted = [...jobs].sort((a, b) => a.fireAt - b.fireAt);
  const next = sorted[0];
  const remainingSec = Math.max(0, Math.ceil((next.fireAt - now) / 1000));
  const when = remainingSec <= 0 ? "now" : `in ${humanizeDuration(remainingSec)}`;

  let line = `${ICON} ${truncate(next.message)} ${when} (${formatClock(next.fireAt)})`;
  if (sorted.length > 1) line += ` (+${sorted.length - 1} more)`;
  return [line];
}
