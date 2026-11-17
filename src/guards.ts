import type { ResetInfo } from "./limits/types";
import type { AutoResumeSettings } from "./settings";

/**
 * Pure auto-resume policy. Given the detected reset time, settings, and the
 * session's running auto-resume state, decide whether to schedule a resume,
 * notify the user, or skip silently. Kept pure so every guard is unit-tested.
 */

export interface AutoResumeState {
  /** Auto-resumes already scheduled this session. */
  count: number;
  /** epoch ms of the last auto-resume schedule, or null. */
  lastResumeAt: number | null;
}

export type AutoResumeDecision =
  | { action: "schedule"; fireAt: number; basis: "reset" | "fallback" }
  | { action: "notify"; reason: string }
  | { action: "skip"; reason: string };

/** Consecutive auto-resumes closer than this look like a hot loop; pause. */
export const MIN_RESUME_INTERVAL_MS = 5 * 60 * 1000;

/**
 * First retry delay when the reset time cannot be read. Each consecutive
 * fallback doubles it (30m, 1h, 2h, …), bounded by `maxWaitHours`.
 */
export const FALLBACK_BASE_DELAY_MS = 30 * 60 * 1000;

/**
 * Guards that do not depend on the reset time. Checked before any usage-API
 * lookup so a disabled or capped session never queries the provider.
 * Returns null when auto-resume may proceed.
 */
export function checkAutoResumeGates(args: {
  settings: AutoResumeSettings;
  state: AutoResumeState;
  now: number;
}): Exclude<AutoResumeDecision, { action: "schedule" }> | null {
  const { settings, state, now } = args;

  if (!settings.enabled) {
    return { action: "skip", reason: "auto-resume disabled" };
  }

  if (state.count >= settings.maxPerSession) {
    return {
      action: "notify",
      reason: `Auto-resume limit reached (${settings.maxPerSession} this session). Use /kg to continue manually.`,
    };
  }

  if (state.lastResumeAt !== null && now - state.lastResumeAt < MIN_RESUME_INTERVAL_MS) {
    return {
      action: "skip",
      reason: "auto-resumed less than 5 minutes ago; pausing to avoid a loop",
    };
  }

  return null;
}

export function decideAutoResume(args: {
  reset: ResetInfo | null;
  settings: AutoResumeSettings;
  state: AutoResumeState;
  now: number;
  /** Fallback resumes already scheduled since the last successful turn. */
  fallbackStreak: number;
}): AutoResumeDecision {
  const { reset, settings, state, now, fallbackStreak } = args;

  const gate = checkAutoResumeGates({ settings, state, now });
  if (gate) return gate;

  const maxWaitMs = settings.maxWaitHours * 3600 * 1000;

  if (!reset) {
    const delayMs = FALLBACK_BASE_DELAY_MS * 2 ** fallbackStreak;
    if (delayMs > maxWaitMs) {
      return {
        action: "notify",
        reason: `Hit a usage limit but could not read the reset time, and the next retry would exceed ${settings.maxWaitHours}h. Use /kg <duration> to schedule a retry.`,
      };
    }
    return { action: "schedule", fireAt: now + delayMs, basis: "fallback" };
  }

  const fireAtRaw = reset.at.getTime() + settings.bufferSeconds * 1000;
  const waitMs = fireAtRaw - now;
  if (waitMs > maxWaitMs) {
    return {
      action: "notify",
      reason: `Usage resets in more than ${settings.maxWaitHours}h; not auto-resuming. Use /kg if you want to wait.`,
    };
  }

  // A reset already in the past fires on the next tick.
  return { action: "schedule", fireAt: now + Math.max(0, waitMs), basis: "reset" };
}
