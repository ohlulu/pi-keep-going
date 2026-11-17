import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { ProviderFamily } from "./limits/detect";
import type { ResetInfo } from "./limits/types";

/**
 * Auto-resume decision log: one custom session entry per usage-limit error the
 * extension handled, recording what it decided and why. Notifications are
 * ephemeral; this entry is what makes a missed resume diagnosable afterwards.
 * Custom entries never reach the model context.
 *
 * The log doubles as state that survives a restart: the error entry id makes
 * handling idempotent, and the fallback entries since the last successful turn
 * set the next fallback delay.
 */

export const RESUME_ENTRY_TYPE = "keep-going-auto-resume";

export type ResetSource = ResetInfo["source"] | "fallback";

export interface ResumeDecisionEntry {
  /** Session entry id of the assistant error this decision answers. */
  errorEntryId: string;
  provider: ProviderFamily;
  action: "schedule" | "notify" | "skip";
  reason?: string;
  resetSource?: ResetSource;
  fireAt?: number;
  /** Why the usage-API lookup failed, when it was attempted and failed. */
  usageError?: string;
}

/** Structural view of a session entry — decouples the scan from Pi's union. */
interface BranchEntryLike {
  type: string;
  customType?: string;
  data?: unknown;
  message?: { role?: string; stopReason?: string };
}

type Appender = Pick<ExtensionAPI, "appendEntry">;

export function recordResumeDecision(pi: Appender, entry: ResumeDecisionEntry): void {
  pi.appendEntry(RESUME_ENTRY_TYPE, entry);
}

function decisionOf(entry: BranchEntryLike): Partial<ResumeDecisionEntry> | null {
  if (entry.type !== "custom" || entry.customType !== RESUME_ENTRY_TYPE) return null;
  return entry.data && typeof entry.data === "object"
    ? (entry.data as Partial<ResumeDecisionEntry>)
    : null;
}

/** True when a decision for this assistant error is already on the branch. */
export function isErrorHandled(branch: readonly BranchEntryLike[], errorEntryId: string): boolean {
  return branch.some((entry) => decisionOf(entry)?.errorEntryId === errorEntryId);
}

/**
 * Fallback resumes scheduled since the most recent assistant turn that did not
 * end in an error or abort. A successful turn means the provider is serving
 * again, so the backoff starts over.
 */
export function fallbackStreak(branch: readonly BranchEntryLike[]): number {
  let streak = 0;
  for (let i = branch.length - 1; i >= 0; i -= 1) {
    const entry = branch[i];
    if (entry.type === "message" && entry.message?.role === "assistant") {
      const stop = entry.message.stopReason;
      if (stop !== "error" && stop !== "aborted") break;
      continue;
    }
    const decision = decisionOf(entry);
    if (decision?.action === "schedule" && decision.resetSource === "fallback") streak += 1;
  }
  return streak;
}
