import { describe, it, expect, vi } from "vitest";
import {
  JOB_ENTRY_TYPE,
  reduceJobEntries,
  rebuildFromBranch,
  recordCreated,
  recordCancelled,
  type JobEvent,
} from "../src/persist";
import type { Job } from "../src/limits/types";

/** Build a custom session entry carrying a job event. */
function entry(data: JobEvent | unknown) {
  return { type: "custom", customType: JOB_ENTRY_TYPE, data };
}

function created(id: string, fireAt: number, message = "keep going"): JobEvent {
  return { event: "created", id, fireAt, message, kind: "manual" };
}

describe("reduceJobEntries", () => {
  it("returns a created-only job as live", () => {
    const jobs = reduceJobEntries([entry(created("a", 1000))]);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ id: "a", fireAt: 1000, state: "created" });
  });

  it("drops cancelled and fired jobs", () => {
    const cancelled = reduceJobEntries([
      entry(created("a", 1000)),
      entry({ event: "cancelled", id: "a" }),
    ]);
    expect(cancelled).toHaveLength(0);

    const fired = reduceJobEntries([
      entry(created("b", 1000)),
      entry({ event: "fired", id: "b" }),
    ]);
    expect(fired).toHaveLength(0);
  });

  it("keeps other jobs live when one is interleaved-fired, sorted by fireAt", () => {
    const jobs = reduceJobEntries([
      entry(created("a", 3000)),
      entry(created("b", 1000)),
      entry({ event: "fired", id: "a" }),
      entry(created("c", 2000)),
    ]);
    expect(jobs.map((j) => j.id)).toEqual(["b", "c"]);
  });

  it("ignores unrelated entries and malformed job data", () => {
    const jobs = reduceJobEntries([
      { type: "message", customType: undefined, data: {} },
      { type: "custom", customType: "other-ext", data: created("x", 500) },
      entry({ event: "created", id: "y" }), // malformed: missing fireAt/message/kind
      entry({ event: "bogus", id: "z" }),
      entry(created("ok", 700)),
    ]);
    expect(jobs.map((j) => j.id)).toEqual(["ok"]);
  });
});

describe("rebuildFromBranch", () => {
  it("reduces over the current branch", () => {
    const branch = [entry(created("a", 100)), entry(created("b", 50))];
    const jobs = rebuildFromBranch({ getBranch: () => branch as never });
    expect(jobs.map((j) => j.id)).toEqual(["b", "a"]);
  });
});

describe("record helpers", () => {
  it("append a created event with the job fields", () => {
    const appendEntry = vi.fn();
    const job: Job = {
      id: "j1",
      fireAt: 1234,
      message: "continue",
      kind: "auto-resume",
      state: "created",
    };
    recordCreated({ appendEntry }, job);
    expect(appendEntry).toHaveBeenCalledWith(JOB_ENTRY_TYPE, {
      event: "created",
      id: "j1",
      fireAt: 1234,
      message: "continue",
      kind: "auto-resume",
    });
  });

  it("append a cancelled event", () => {
    const appendEntry = vi.fn();
    recordCancelled({ appendEntry }, "j1");
    expect(appendEntry).toHaveBeenCalledWith(JOB_ENTRY_TYPE, {
      event: "cancelled",
      id: "j1",
    });
  });
});
