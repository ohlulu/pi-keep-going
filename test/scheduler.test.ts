import { describe, it, expect, vi } from "vitest";
import { Scheduler, type SchedulerDeps } from "../src/scheduler";

function harness(overrides: Partial<SchedulerDeps> = {}) {
  let clock = 0;
  let counter = 0;
  const deps: SchedulerDeps = {
    now: () => clock,
    isIdle: vi.fn(() => true),
    sendUserMessage: vi.fn(),
    recordCreated: vi.fn(),
    recordCancelled: vi.fn(),
    recordFired: vi.fn(),
    onChange: vi.fn(),
    onFire: vi.fn(),
    genId: () => `id${++counter}`,
    ...overrides,
  };
  const scheduler = new Scheduler(deps);
  return { scheduler, deps, setClock: (t: number) => (clock = t) };
}

describe("Scheduler CRUD", () => {
  it("adds a job, records it, and lists it", () => {
    const { scheduler, deps } = harness();
    const job = scheduler.add({ fireAt: 1000, message: "keep going", kind: "manual" });
    expect(job.id).toBe("id1");
    expect(scheduler.list()).toHaveLength(1);
    expect(deps.recordCreated).toHaveBeenCalledWith(job);
    expect(deps.onChange).toHaveBeenCalled();
  });

  it("lists jobs sorted by fireAt", () => {
    const { scheduler } = harness();
    scheduler.add({ fireAt: 3000, message: "c", kind: "manual" });
    scheduler.add({ fireAt: 1000, message: "a", kind: "manual" });
    scheduler.add({ fireAt: 2000, message: "b", kind: "manual" });
    expect(scheduler.list().map((j) => j.message)).toEqual(["a", "b", "c"]);
  });

  it("cancels a job and records the cancellation", () => {
    const { scheduler, deps } = harness();
    const job = scheduler.add({ fireAt: 1000, message: "x", kind: "manual" });
    expect(scheduler.cancel(job.id)).toBe(true);
    expect(scheduler.list()).toHaveLength(0);
    expect(deps.recordCancelled).toHaveBeenCalledWith(job.id);
    expect(scheduler.cancel("missing")).toBe(false);
  });
});

describe("Scheduler firing", () => {
  it("does not fire a future job", () => {
    const { scheduler, deps, setClock } = harness();
    scheduler.add({ fireAt: 5000, message: "later", kind: "manual" });
    setClock(4000);
    scheduler.tick();
    expect(deps.sendUserMessage).not.toHaveBeenCalled();
    expect(scheduler.list()).toHaveLength(1);
  });

  it("fires a due job immediately when idle", () => {
    const { scheduler, deps, setClock } = harness();
    scheduler.add({ fireAt: 1000, message: "keep going", kind: "manual" });
    setClock(1000);
    scheduler.tick();
    expect(deps.sendUserMessage).toHaveBeenCalledWith("keep going");
    expect(deps.recordFired).toHaveBeenCalled();
    expect(deps.onFire).toHaveBeenCalledWith(
      expect.objectContaining({ message: "keep going" }),
      { late: false },
    );
    expect(scheduler.list()).toHaveLength(0);
  });

  it("queues as follow-up when the agent is busy", () => {
    const { scheduler, deps, setClock } = harness({ isIdle: vi.fn(() => false) });
    scheduler.add({ fireAt: 1000, message: "continue", kind: "auto-resume" });
    setClock(2000);
    scheduler.tick();
    expect(deps.sendUserMessage).toHaveBeenCalledWith("continue", {
      deliverAs: "followUp",
    });
  });

  it("fires already-due jobs on load as late", () => {
    const { scheduler, deps, setClock } = harness();
    setClock(5000);
    scheduler.load([
      { id: "j1", fireAt: 1000, message: "resumed", kind: "manual", state: "created" },
      { id: "j2", fireAt: 9000, message: "future", kind: "manual", state: "created" },
    ]);
    expect(deps.sendUserMessage).toHaveBeenCalledWith("resumed");
    expect(deps.onFire).toHaveBeenCalledWith(
      expect.objectContaining({ id: "j1" }),
      { late: true },
    );
    expect(scheduler.list().map((j) => j.id)).toEqual(["j2"]);
  });
});
