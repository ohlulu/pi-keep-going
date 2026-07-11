import { randomUUID } from "node:crypto";
import type { Job, JobKind } from "./limits/types";

/**
 * One-shot job scheduler.
 *
 * Uses an absolute fire timestamp compared on a fixed 30s tick rather than a
 * single long `setTimeout`, so it survives system sleep: on wake, the first
 * tick fires everything already due. `isIdle()` only chooses the delivery form
 * (immediate turn vs. queued follow-up); a due job always fires.
 *
 * All side effects are injected so the tick logic is unit-testable with a fake
 * clock and no real timers.
 */

export interface SchedulerDeps {
  now(): number;
  isIdle(): boolean;
  sendUserMessage(content: string, options?: { deliverAs: "followUp" }): void;
  recordCreated(job: Job): void;
  recordCancelled(id: string): void;
  recordFired(id: string): void;
  /** Called after the live set changes, to refresh the widget. */
  onChange?(): void;
  /** Called at the end of every tick, so the countdown display can refresh. */
  onTick?(): void;
  /** Called when a job fires; `late` means it was already due at load time. */
  onFire?(job: Job, meta: { late: boolean }): void;
  /** Test seam for deterministic ids; defaults to randomUUID. */
  genId?(): string;
  /** Advisory firing gate: when it returns false (read-only lease), due jobs are
   * held, not sent, so a second process on the same session never double-fires. */
  canFire?(): boolean;
}

export interface NewJob {
  fireAt: number;
  message: string;
  kind: JobKind;
  id?: string;
}

const TICK_MS = 30_000;

export class Scheduler {
  private jobs = new Map<string, Job>();
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly deps: SchedulerDeps) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), TICK_MS);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  list(): Job[] {
    return [...this.jobs.values()].sort((a, b) => a.fireAt - b.fireAt);
  }

  add(spec: NewJob): Job {
    const job: Job = {
      id: spec.id ?? this.genId(),
      fireAt: spec.fireAt,
      message: spec.message,
      kind: spec.kind,
      state: "created",
    };
    this.jobs.set(job.id, job);
    this.deps.recordCreated(job);
    this.deps.onChange?.();
    return job;
  }

  cancel(id: string): boolean {
    const job = this.jobs.get(id);
    if (!job) return false;
    job.state = "cancelled";
    this.jobs.delete(id);
    this.deps.recordCancelled(id);
    this.deps.onChange?.();
    return true;
  }

  cancelAll(): number {
    const ids = [...this.jobs.keys()];
    for (const id of ids) this.cancel(id);
    return ids.length;
  }

  /** Replace the live set from a branch rebuild, firing any already-due jobs. */
  load(jobs: readonly Job[]): void {
    this.jobs = new Map(jobs.map((j) => [j.id, { ...j }]));
    this.fireDue(true);
    this.deps.onChange?.();
  }

  tick(): void {
    if (this.fireDue(false) > 0) this.deps.onChange?.();
    this.deps.onTick?.();
  }

  private fireDue(late: boolean): number {
    if (this.deps.canFire && !this.deps.canFire()) return 0;
    const now = this.deps.now();
    const due = [...this.jobs.values()].filter((j) => now >= j.fireAt);
    for (const job of due) this.fire(job, late);
    return due.length;
  }

  private fire(job: Job, late: boolean): void {
    if (this.deps.isIdle()) {
      this.deps.sendUserMessage(job.message);
    } else {
      this.deps.sendUserMessage(job.message, { deliverAs: "followUp" });
    }
    job.state = "fired";
    this.jobs.delete(job.id);
    this.deps.recordFired(job.id);
    this.deps.onFire?.(job, { late });
  }

  private genId(): string {
    return this.deps.genId ? this.deps.genId() : randomUUID();
  }
}
