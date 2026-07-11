import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { Job, JobKind } from "./limits/types";

/**
 * Job persistence as an append-only event log of custom session entries.
 *
 * Jobs are never mutated in place. Each lifecycle transition is appended as a
 * `JobEvent` custom entry; the live set is reconstructed by replaying the
 * events on the CURRENT branch. Using the branch (not all entries) makes state
 * follow `/tree` navigation and `/fork`: a job created on an abandoned branch
 * simply is not present when that branch is not active.
 */

export const JOB_ENTRY_TYPE = "keep-going-job";

export type JobEvent =
  | { event: "created"; id: string; fireAt: number; message: string; kind: JobKind }
  | { event: "cancelled"; id: string }
  | { event: "fired"; id: string };

/** Structural view of a session entry — decouples the reducer from Pi's union. */
interface CustomEntryLike {
  type: string;
  customType?: string;
  data?: unknown;
}

type Appender = Pick<ExtensionAPI, "appendEntry">;

export function recordJobEvent(pi: Appender, event: JobEvent): void {
  pi.appendEntry(JOB_ENTRY_TYPE, event);
}

export function recordCreated(pi: Appender, job: Job): void {
  recordJobEvent(pi, {
    event: "created",
    id: job.id,
    fireAt: job.fireAt,
    message: job.message,
    kind: job.kind,
  });
}

export function recordCancelled(pi: Appender, id: string): void {
  recordJobEvent(pi, { event: "cancelled", id });
}

export function recordFired(pi: Appender, id: string): void {
  recordJobEvent(pi, { event: "fired", id });
}

function isJobEvent(data: unknown): data is JobEvent {
  if (!data || typeof data !== "object") return false;
  const e = data as Record<string, unknown>;
  if (e.event === "created") {
    return (
      typeof e.id === "string" &&
      typeof e.fireAt === "number" &&
      typeof e.message === "string" &&
      (e.kind === "manual" || e.kind === "auto-resume")
    );
  }
  if (e.event === "cancelled" || e.event === "fired") {
    return typeof e.id === "string";
  }
  return false;
}

/**
 * Replay job events into the live job set. Only jobs whose latest state is
 * `created` (not cancelled or fired) are returned, sorted by fire time.
 * Pure and branch-agnostic so it can be unit-tested with synthetic entries.
 */
export function reduceJobEntries(entries: readonly CustomEntryLike[]): Job[] {
  const byId = new Map<string, Job>();
  for (const entry of entries) {
    if (entry.type !== "custom" || entry.customType !== JOB_ENTRY_TYPE) continue;
    const ev = entry.data;
    if (!isJobEvent(ev)) continue;

    switch (ev.event) {
      case "created":
        byId.set(ev.id, {
          id: ev.id,
          fireAt: ev.fireAt,
          message: ev.message,
          kind: ev.kind,
          state: "created",
        });
        break;
      case "cancelled": {
        const job = byId.get(ev.id);
        if (job) job.state = "cancelled";
        break;
      }
      case "fired": {
        const job = byId.get(ev.id);
        if (job) job.state = "fired";
        break;
      }
    }
  }

  return [...byId.values()]
    .filter((job) => job.state === "created")
    .sort((a, b) => a.fireAt - b.fireAt);
}

/**
 * Reconstruct live jobs from the current session branch. Typed structurally so
 * it accepts `ctx.sessionManager` without depending on a non-exported type.
 */
export function rebuildFromBranch(sessionManager: {
  getBranch: () => readonly CustomEntryLike[];
}): Job[] {
  return reduceJobEntries(sessionManager.getBranch());
}
