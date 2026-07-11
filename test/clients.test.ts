import { describe, it, expect } from "vitest";
import type { FetchLike, FetchInitLike } from "../src/limits/client";
import { decodeJwtPayload } from "../src/limits/client";
import { fetchCodexReset, codexAccountId, CODEX_USAGE_URL } from "../src/limits/codex";
import { fetchAnthropicReset, ANTHROPIC_USAGE_URL } from "../src/limits/anthropic";

function makeJwt(payload: object): string {
  const b64 = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `header.${b64}.sig`;
}

interface MockSpec {
  status: number;
  ok?: boolean;
  body?: unknown; // undefined → json() throws (invalid JSON)
  throwErr?: unknown;
}

function mockFetch(spec: MockSpec, capture?: (url: string, init?: FetchInitLike) => void): FetchLike {
  return async (url, init) => {
    capture?.(url, init);
    if (spec.throwErr) throw spec.throwErr;
    return {
      ok: spec.ok ?? (spec.status >= 200 && spec.status < 300),
      status: spec.status,
      json: async () => {
        if (spec.body === undefined) throw new Error("invalid json");
        return spec.body;
      },
    };
  };
}

const NOW = 1_000_000;

describe("decodeJwtPayload / codexAccountId", () => {
  it("decodes a base64url JWT payload", () => {
    const token = makeJwt({ sub: "u1", "https://api.openai.com/auth": { chatgpt_account_id: "acc-123" } });
    expect(decodeJwtPayload(token)).toMatchObject({ sub: "u1" });
  });

  it("returns null for a non-JWT string", () => {
    expect(decodeJwtPayload("not-a-jwt")).toBeNull();
  });

  it("reads the nested account id, then flat fallbacks", () => {
    expect(codexAccountId(makeJwt({ "https://api.openai.com/auth": { chatgpt_account_id: "nested" } }))).toBe(
      "nested",
    );
    expect(codexAccountId(makeJwt({ chatgpt_account_id: "flat" }))).toBe("flat");
    expect(codexAccountId(makeJwt({ account_id: "legacy" }))).toBe("legacy");
    expect(codexAccountId(makeJwt({ sub: "x" }))).toBeUndefined();
  });
});

describe("fetchCodexReset", () => {
  const token = makeJwt({ "https://api.openai.com/auth": { chatgpt_account_id: "acc-123" } });

  it("parses primary_window.reset_at (epoch seconds) and sends the right headers", async () => {
    let seenUrl = "";
    let seenHeaders: Record<string, string> = {};
    const fetchImpl = mockFetch(
      { status: 200, body: { rate_limit: { primary_window: { reset_at: 1783180800 } } } },
      (url, init) => {
        seenUrl = url;
        seenHeaders = init?.headers ?? {};
      },
    );
    const result = await fetchCodexReset({ token, fetchImpl, now: NOW });
    expect(result).toEqual({ ok: true, reset: { at: new Date(1783180800 * 1000), source: "body" } });
    expect(seenUrl).toBe(CODEX_USAGE_URL);
    expect(seenHeaders.Authorization).toBe(`Bearer ${token}`);
    expect(seenHeaders["ChatGPT-Account-Id"]).toBe("acc-123");
    expect(seenHeaders["User-Agent"]).toBeTruthy();
  });

  it("parses reset_after_seconds relative to now", async () => {
    const fetchImpl = mockFetch({
      status: 200,
      body: { rate_limit: { primary_window: { reset_after_seconds: 600 } } },
    });
    const result = await fetchCodexReset({ token, fetchImpl, now: NOW });
    expect(result).toEqual({ ok: true, reset: { at: new Date(NOW + 600_000), source: "body" } });
  });

  it("reports a clear error on 401", async () => {
    const result = await fetchCodexReset({ token, fetchImpl: mockFetch({ status: 401 }), now: NOW });
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toMatch(/401/);
  });

  it("errors on invalid JSON", async () => {
    const result = await fetchCodexReset({ token, fetchImpl: mockFetch({ status: 200 }), now: NOW });
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toMatch(/invalid JSON/i);
  });

  it("errors when the body has no reset time", async () => {
    const fetchImpl = mockFetch({ status: 200, body: { rate_limit: { primary_window: {} } } });
    const result = await fetchCodexReset({ token, fetchImpl, now: NOW });
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toMatch(/no reset time/i);
  });

  it("surfaces a network error", async () => {
    const fetchImpl = mockFetch({ status: 0, throwErr: new Error("ECONNRESET") });
    const result = await fetchCodexReset({ token, fetchImpl, now: NOW });
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toMatch(/ECONNRESET/);
  });
});

describe("fetchAnthropicReset", () => {
  const token = "sk-oauth-token";

  it("parses five_hour.resets_at and sends oauth headers", async () => {
    const iso = "2026-04-11T07:00:00Z";
    let seenHeaders: Record<string, string> = {};
    const fetchImpl = mockFetch(
      { status: 200, body: { five_hour: { resets_at: iso }, seven_day: { resets_at: iso } } },
      (_url, init) => {
        seenHeaders = init?.headers ?? {};
      },
    );
    const result = await fetchAnthropicReset({ token, fetchImpl, now: NOW });
    expect(result).toEqual({
      ok: true,
      reset: { at: new Date(Date.parse(iso)), source: "body", window: "five_hour" },
    });
    expect(seenHeaders["anthropic-beta"]).toBe("oauth-2025-04-20");
    expect(seenHeaders["User-Agent"]).toMatch(/^claude-code\//);
    expect(seenHeaders.Authorization).toBe(`Bearer ${token}`);
  });

  it("respects a custom User-Agent", async () => {
    let seenHeaders: Record<string, string> = {};
    const fetchImpl = mockFetch(
      { status: 200, body: { five_hour: { resets_at: "2026-01-01T00:00:00Z" } } },
      (_url, init) => {
        seenHeaders = init?.headers ?? {};
      },
    );
    await fetchAnthropicReset({ token, userAgent: "claude-code/9.9.9", fetchImpl, now: NOW });
    expect(seenHeaders["User-Agent"]).toBe("claude-code/9.9.9");
  });

  it("hints about API-key vs OAuth on 403", async () => {
    const result = await fetchAnthropicReset({ token, fetchImpl: mockFetch({ status: 403 }), now: NOW });
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toMatch(/API key|OAuth/i);
  });

  it("hits the documented endpoint", async () => {
    let seenUrl = "";
    const fetchImpl = mockFetch(
      { status: 200, body: { five_hour: { resets_at: "2026-01-01T00:00:00Z" } } },
      (url) => {
        seenUrl = url;
      },
    );
    await fetchAnthropicReset({ token, fetchImpl, now: NOW });
    expect(seenUrl).toBe(ANTHROPIC_USAGE_URL);
  });
});
