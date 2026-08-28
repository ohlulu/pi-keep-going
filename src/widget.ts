import { humanizeDuration } from "./duration";
import type { Job } from "./limits/types";
import { COMPANIONS, companionAsciiFrame, companionFrame, type CompanionStyle } from "./anim";
import { renderHalfBlocks, type ColorMode } from "./sprite";

/** Countdown widget rendering. Pure so it can be unit-tested. */

const ICON = "⏱";
const MAX_MESSAGE = 40;

/**
 * Spacer row between the countdown and the sprite.
 *
 * Not `""`: pi wraps each widget line in a Text component, whose render bails
 * out with zero lines when the content is empty or whitespace-only, so a plain
 * empty string vanishes instead of producing a gap. A bare reset escape is
 * non-blank to that check, and `visibleWidth` strips ANSI, so it still measures
 * as zero columns and paints an empty row.
 */
export const BLANK_ROW = "\x1b[0m";

/** The animal shown under the countdown while a job is pending. */
export interface CompanionView {
  style: CompanionStyle;
  /** Frame counter; wraps internally, so any monotonic value works. */
  tick: number;
  mode: ColorMode;
}

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

/** Colour sprite, or the flat ASCII art when the terminal has no colour. */
function renderCompanion(companion: CompanionView): string[] {
  if (companion.mode === "mono") return [...companionAsciiFrame(companion.style, companion.tick)];
  return renderHalfBlocks(
    companionFrame(companion.style, companion.tick),
    COMPANIONS[companion.style].palette,
    companion.mode,
  );
}

/**
 * Render widget lines for the current jobs, or `null` when there are none
 * (caller should clear the widget). Shows the nearest job's countdown and a
 * `(+N more)` suffix when other jobs are pending.
 *
 * With a companion, the layout is countdown, blank row, then the sprite.
 */
export function renderWidgetLines(
  jobs: readonly Job[],
  now: number,
  companion?: CompanionView | null,
): string[] | null {
  if (jobs.length === 0) return null;

  const sorted = [...jobs].sort((a, b) => a.fireAt - b.fireAt);
  const next = sorted[0];
  const remainingSec = Math.max(0, Math.ceil((next.fireAt - now) / 1000));
  const when = remainingSec <= 0 ? "now" : `in ${humanizeDuration(remainingSec)}`;

  let line = `${ICON} ${truncate(next.message)} ${when} (${formatClock(next.fireAt)})`;
  if (sorted.length > 1) line += ` (+${sorted.length - 1} more)`;

  if (!companion) return [line];
  return [line, BLANK_ROW, ...renderCompanion(companion)];
}
