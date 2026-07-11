import { describe, it, expect } from "vitest";
import {
  evaluateLease,
  parseLease,
  leasePath,
  refreshLease,
  LEASE_STALE_MS,
  type LeaseIO,
  type LeaseRecord,
} from "../src/lease";

const SELF = { pid: 100, sessionId: "s1" };
const NOW = 1_000_000;

describe("evaluateLease", () => {
  it("claims ownership when no lock exists", () => {
    const d = evaluateLease({ current: null, self: SELF, now: NOW });
    expect(d).toEqual({ role: "owner", lease: { pid: 100, sessionId: "s1", updatedAt: NOW } });
  });

  it("keeps ownership of its own fresh lock", () => {
    const current: LeaseRecord = { pid: 100, sessionId: "s1", updatedAt: NOW - 1000 };
    expect(evaluateLease({ current, self: SELF, now: NOW }).role).toBe("owner");
  });

  it("reclaims a stale lock from another pid", () => {
    const current: LeaseRecord = { pid: 200, sessionId: "s1", updatedAt: NOW - LEASE_STALE_MS };
    expect(evaluateLease({ current, self: SELF, now: NOW }).role).toBe("owner");
  });

  it("defers to a fresh lock held by another pid", () => {
    const current: LeaseRecord = { pid: 200, sessionId: "s1", updatedAt: NOW - 1000 };
    const d = evaluateLease({ current, self: SELF, now: NOW });
    expect(d).toEqual({ role: "reader", heldBy: current });
  });
});

describe("parseLease", () => {
  it("accepts a well-formed record", () => {
    expect(parseLease({ pid: 1, sessionId: "s", updatedAt: 5 })).toEqual({
      pid: 1,
      sessionId: "s",
      updatedAt: 5,
    });
  });

  it("rejects malformed records", () => {
    expect(parseLease({ pid: "1", sessionId: "s", updatedAt: 5 })).toBeNull();
    expect(parseLease(null)).toBeNull();
    expect(parseLease({})).toBeNull();
  });
});

describe("leasePath", () => {
  it("namespaces under keep-going/locks and sanitizes the id", () => {
    expect(leasePath("/agent", "abc/def:1")).toBe("/agent/keep-going/locks/abc_def_1.lock");
  });
});

describe("refreshLease", () => {
  function fakeIO(initial: Record<string, string>): { io: LeaseIO; store: Record<string, string> } {
    const store = { ...initial };
    return {
      store,
      io: {
        read: (p) => (p in store ? store[p] : null),
        write: (p, c) => {
          store[p] = c;
        },
      },
    };
  }

  const path = "/agent/keep-going/locks/s1.lock";

  it("writes a fresh lock and returns owner when none exists", () => {
    const { io, store } = fakeIO({});
    expect(refreshLease({ io, path, self: SELF, now: NOW })).toBe("owner");
    expect(JSON.parse(store[path])).toEqual({ pid: 100, sessionId: "s1", updatedAt: NOW });
  });

  it("returns reader and does not overwrite a fresh foreign lock", () => {
    const foreign = JSON.stringify({ pid: 200, sessionId: "s1", updatedAt: NOW - 1000 });
    const { io, store } = fakeIO({ [path]: foreign });
    expect(refreshLease({ io, path, self: SELF, now: NOW })).toBe("reader");
    expect(store[path]).toBe(foreign); // untouched
  });

  it("treats corrupt lock contents as no lock (claims ownership)", () => {
    const { io } = fakeIO({ [path]: "{not json" });
    expect(refreshLease({ io, path, self: SELF, now: NOW })).toBe("owner");
  });
});
