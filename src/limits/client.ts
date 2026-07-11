import type { ResetInfo } from "./types";

/**
 * Shared plumbing for the per-provider usage-API clients. Each client resolves
 * the current usage window's reset time for `auto` mode. Clients take an
 * injectable `fetchImpl` (a minimal `FetchLike`, not the full DOM `fetch`) so
 * tests can drive them with plain objects, and an `AbortSignal` for the
 * generation-guard + timeout wired at the call site.
 */

export type UsageResult =
  | { ok: true; reset: ResetInfo }
  | { ok: false; error: string };

export interface FetchResponseLike {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}

export interface FetchInitLike {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
}

export type FetchLike = (url: string, init?: FetchInitLike) => Promise<FetchResponseLike>;

export interface FetchDeps {
  fetchImpl?: FetchLike;
  signal?: AbortSignal;
  now?: number;
}

export function defaultFetch(): FetchLike {
  return fetch as unknown as FetchLike;
}

/** Read a property from an unknown value, guarding against non-objects. */
export function pick(obj: unknown, key: string): unknown {
  return obj && typeof obj === "object" ? (obj as Record<string, unknown>)[key] : undefined;
}

/** Coerce a number or numeric string to a finite number, else null. */
export function num(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export function errText(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}

/** Parse an ISO 8601 / RFC 3339 timestamp into a ResetInfo, or null. */
export function isoReset(
  value: unknown,
  extra?: Partial<Pick<ResetInfo, "window">>,
): ResetInfo | null {
  if (typeof value !== "string") return null;
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return null;
  return { at: new Date(ms), source: "body", ...extra };
}

/** Decode a JWT payload for read-only claim extraction (no signature check). */
export function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split(".");
  if (parts.length < 2) return null;
  try {
    const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const json = Buffer.from(b64, "base64").toString("utf8");
    const obj = JSON.parse(json);
    return obj && typeof obj === "object" ? (obj as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
