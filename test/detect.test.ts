import { describe, it, expect } from "vitest";
import { detectUsageLimit, providerFamily, type DetectInput } from "../src/limits/detect";

function input(overrides: Partial<DetectInput>): DetectInput {
  return {
    provider: "openai-codex",
    stopReason: "error",
    errorMessage: "",
    cached429: null,
    now: 1_000_000,
    ...overrides,
  };
}

describe("providerFamily", () => {
  it("maps provider ids to families", () => {
    expect(providerFamily("openai-codex")).toBe("codex");
    expect(providerFamily("anthropic")).toBe("anthropic");
    expect(providerFamily("google")).toBe("gemini");
    expect(providerFamily("google-gemini-cli")).toBe("gemini");
    expect(providerFamily("mistral")).toBeNull();
  });
});

describe("non-usage-limit and preconditions", () => {
  it("returns null when the run did not stop on error", () => {
    expect(detectUsageLimit(input({ stopReason: "endTurn", errorMessage: "rate limit" }))).toBeNull();
  });

  it("returns null for unrelated errors", () => {
    expect(
      detectUsageLimit(input({ provider: "anthropic", errorMessage: "prompt is too long (context)" })),
    ).toBeNull();
    expect(
      detectUsageLimit(input({ provider: "openai-codex", errorMessage: "fetch failed: ECONNRESET" })),
    ).toBeNull();
  });

  it("returns null for unknown providers", () => {
    expect(detectUsageLimit(input({ provider: "mistral", errorMessage: "rate limit" }))).toBeNull();
  });
});

describe("codex", () => {
  it("parses the friendly '~N min' reset", () => {
    const result = detectUsageLimit(
      input({ errorMessage: "You have hit your ChatGPT usage limit (plus plan). Try again in ~118 min." }),
    );
    expect(result).toEqual({
      provider: "codex",
      reset: { at: new Date(1_000_000 + 118 * 60_000), source: "body" },
    });
  });

  it("flags the limit but reports unknown reset when no minutes are present", () => {
    const result = detectUsageLimit(
      input({ errorMessage: "You have hit your ChatGPT usage limit." }),
    );
    expect(result).toEqual({ provider: "codex", reset: null });
  });
});

describe("anthropic", () => {
  const cached = (headers: Record<string, string>, at = 1_000_000) => ({
    status: 429,
    headers,
    at,
  });

  it("reads the unified 5h reset header as epoch seconds", () => {
    const result = detectUsageLimit(
      input({
        provider: "anthropic",
        errorMessage: "rate_limit_error: too many requests",
        cached429: cached({ "anthropic-ratelimit-unified-5h-reset": "1783180800" }),
      }),
    );
    expect(result?.reset?.at.getTime()).toBe(1783180800 * 1000);
    expect(result?.reset).toMatchObject({ source: "header", window: "five_hour" });
  });

  it("tolerates an ISO unified-reset header", () => {
    const iso = "2026-04-11T07:00:00Z";
    const result = detectUsageLimit(
      input({
        provider: "anthropic",
        errorMessage: "429 rate limit",
        cached429: cached({ "anthropic-ratelimit-unified-reset": iso }),
      }),
    );
    expect(result?.reset?.at.getTime()).toBe(Date.parse(iso));
  });

  it("falls back to retry-after seconds", () => {
    const result = detectUsageLimit(
      input({
        provider: "anthropic",
        now: 0,
        errorMessage: "rate limit",
        cached429: cached({ "retry-after": "3600" }, 0),
      }),
    );
    expect(result?.reset?.at.getTime()).toBe(3_600_000);
    expect(result?.reset?.window).toBeUndefined();
  });

  it("ignores a stale cached 429 and reports unknown reset", () => {
    const result = detectUsageLimit(
      input({
        provider: "anthropic",
        now: 1_000_000,
        errorMessage: "rate limit",
        cached429: cached({ "anthropic-ratelimit-unified-5h-reset": "1783180800" }, 0),
      }),
    );
    expect(result).toEqual({ provider: "anthropic", reset: null });
  });
});

describe("gemini", () => {
  it("prefers quotaResetTimeStamp (RFC3339)", () => {
    const ts = "2025-10-20T19:14:08Z";
    const result = detectUsageLimit(
      input({
        provider: "google-gemini-cli",
        errorMessage: `RESOURCE_EXHAUSTED ... "quotaResetTimeStamp":"${ts}" ...`,
      }),
    );
    expect(result?.reset?.at.getTime()).toBe(Date.parse(ts));
    expect(result?.reset?.source).toBe("body");
  });

  it("parses RetryInfo retryDelay", () => {
    const result = detectUsageLimit(
      input({
        provider: "google-gemini-cli",
        now: 1000,
        errorMessage: 'RESOURCE_EXHAUSTED ... "retryDelay":"600s"',
      }),
    );
    expect(result?.reset?.at.getTime()).toBe(1000 + 600_000);
  });

  it("parses a compound 'reset after' duration", () => {
    const result = detectUsageLimit(
      input({
        provider: "google",
        now: 0,
        errorMessage:
          "You have exhausted your capacity on this model. Your quota will reset after 14h24m54s.",
      }),
    );
    expect(result?.reset?.at.getTime()).toBe((14 * 3600 + 24 * 60 + 54) * 1000);
  });

  it("parses a fractional 'retry in Ns' delay", () => {
    const result = detectUsageLimit(
      input({
        provider: "google",
        now: 0,
        errorMessage: "You exceeded your current quota. Please retry in 34.074824224s.",
      }),
    );
    expect(result?.reset?.at.getTime()).toBe(Math.round(34.074824224 * 1000));
  });

  it("flags quota exhaustion with unknown reset when no time is present", () => {
    const result = detectUsageLimit(
      input({ provider: "google", errorMessage: "RESOURCE_EXHAUSTED: quota exceeded" }),
    );
    expect(result).toEqual({ provider: "gemini", reset: null });
  });
});
