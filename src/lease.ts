import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * Advisory single-firer lease for a session.
 *
 * Two pi processes can end up attached to the same session id (e.g. a detached
 * background run plus an interactive attach). Both would otherwise fire the same
 * scheduled jobs and double-send. This lease elects one firer: the owner rewrites
 * a lock file every tick; a second process that sees a *fresh* lock held by a
 * different pid becomes a read-only reader (ticks + widget, but never fires). A
 * lock older than `LEASE_STALE_MS` is treated as abandoned and reclaimed.
 *
 * It is advisory, not a mutex — the worst failure mode (a torn write racing a
 * read) at most permits a single duplicate send, never data loss.
 */

export interface LeaseRecord {
  pid: number;
  sessionId: string;
  updatedAt: number;
}

export type LeaseRole = "owner" | "reader";

export type LeaseDecision =
  | { role: "owner"; lease: LeaseRecord }
  | { role: "reader"; heldBy: LeaseRecord };

/** Three missed 30s ticks: a lock older than this is considered abandoned. */
export const LEASE_STALE_MS = 90_000;

export function evaluateLease(args: {
  current: LeaseRecord | null;
  self: { pid: number; sessionId: string };
  now: number;
  staleMs?: number;
}): LeaseDecision {
  const staleMs = args.staleMs ?? LEASE_STALE_MS;
  const { current, self, now } = args;
  if (!current || current.pid === self.pid || now - current.updatedAt >= staleMs) {
    return { role: "owner", lease: { pid: self.pid, sessionId: self.sessionId, updatedAt: now } };
  }
  return { role: "reader", heldBy: current };
}

export function parseLease(raw: unknown): LeaseRecord | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (
    typeof o.pid === "number" &&
    typeof o.sessionId === "string" &&
    typeof o.updatedAt === "number"
  ) {
    return { pid: o.pid, sessionId: o.sessionId, updatedAt: o.updatedAt };
  }
  return null;
}

function sanitize(id: string): string {
  return id.replace(/[^A-Za-z0-9._-]/g, "_");
}

export function leasePath(agentDir: string, sessionId: string): string {
  return join(agentDir, "keep-going", "locks", `${sanitize(sessionId)}.lock`);
}

export interface LeaseIO {
  read(path: string): string | null;
  write(path: string, content: string): void;
}

export function defaultLeaseIO(): LeaseIO {
  return {
    read(path) {
      try {
        return readFileSync(path, "utf8");
      } catch {
        return null;
      }
    },
    write(path, content) {
      try {
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, content);
      } catch {
        // Advisory only: a failed write just means we can't assert ownership.
      }
    },
  };
}

/** Read the lock, decide the role, and (when owner) refresh it. */
export function refreshLease(args: {
  io: LeaseIO;
  path: string;
  self: { pid: number; sessionId: string };
  now: number;
  staleMs?: number;
}): LeaseRole {
  const raw = args.io.read(args.path);
  let current: LeaseRecord | null = null;
  if (raw) {
    try {
      current = parseLease(JSON.parse(raw));
    } catch {
      current = null;
    }
  }
  const decision = evaluateLease({
    current,
    self: args.self,
    now: args.now,
    staleMs: args.staleMs,
  });
  if (decision.role === "owner") {
    args.io.write(args.path, JSON.stringify(decision.lease));
  }
  return decision.role;
}
