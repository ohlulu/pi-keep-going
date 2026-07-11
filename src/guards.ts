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
  | { action: "schedule"; fireAt: number }
  | { action: "notify"; reason: string }
  | { action: "skip"; reason: string };

/** Consecutive auto-resumes closer than this look like a hot loop; pause. */
export const MIN_RESUME_INTERVAL_MS = 5 * 60 * 1000;

export function decideAutoResume(args: {
  reset: ResetInfo | null;
  settings: AutoResumeSettings;
  state: AutoResumeState;
  now: number;
}): AutoResumeDecision {
  const { reset, settings, state, now } = args;

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

  if (!reset) {
    return {
      action: "notify",
      reason: "Hit a usage limit but could not read the reset time. Use /kg <duration> to schedule a retry.",
    };
  }

  const fireAtRaw = reset.at.getTime() + settings.bufferSeconds * 1000;
  const waitMs = fireAtRaw - now;
  const maxWaitMs = settings.maxWaitHours * 3600 * 1000;
  if (waitMs > maxWaitMs) {
    return {
      action: "notify",
      reason: `Usage resets in more than ${settings.maxWaitHours}h; not auto-resuming. Use /kg if you want to wait.`,
    };
  }

  // A reset already in the past fires on the next tick.
  return { action: "schedule", fireAt: now + Math.max(0, waitMs) };
}
