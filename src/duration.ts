/**
 * Duration parsing and humanizing for the `/kg` command.
 *
 * Accepts canonical largest-first compound durations built from day/hour/
 * minute/second units, e.g. `40m`, `2h30m`, `90s`, `1h30m20s`, `2d`. Units are
 * case-insensitive and each may appear at most once, in `d h m s` order. A bare
 * number (no unit) is rejected to avoid ambiguity.
 */

const DURATION_PATTERN =
  /^(?:(\d+)d)?(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/;

const SECONDS_PER = { d: 86_400, h: 3_600, m: 60, s: 1 } as const;

/**
 * Parse a duration string into whole seconds.
 * Returns `null` for empty, malformed, unit-less, or non-positive input.
 */
export function parseDuration(input: string): number | null {
  const normalized = input.trim().toLowerCase();
  if (normalized === "") return null;

  const match = DURATION_PATTERN.exec(normalized);
  if (!match) return null;

  const [, d, h, m, s] = match;
  // All groups undefined means the pattern matched only the empty string.
  if (d === undefined && h === undefined && m === undefined && s === undefined) {
    return null;
  }

  const total =
    Number(d ?? 0) * SECONDS_PER.d +
    Number(h ?? 0) * SECONDS_PER.h +
    Number(m ?? 0) * SECONDS_PER.m +
    Number(s ?? 0) * SECONDS_PER.s;

  return total > 0 ? total : null;
}

/**
 * Render whole seconds as a compact human-readable string, dropping zero-valued
 * units in `d h m s` order, e.g. `5420 -> "1h 30m 20s"`, `3600 -> "1h"`,
 * `0 -> "0s"`.
 */
export function humanizeDuration(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  if (total === 0) return "0s";

  const parts: string[] = [];
  let remaining = total;
  for (const unit of ["d", "h", "m", "s"] as const) {
    const size = SECONDS_PER[unit];
    const value = Math.floor(remaining / size);
    if (value > 0) parts.push(`${value}${unit}`);
    remaining -= value * size;
  }
  return parts.join(" ");
}
