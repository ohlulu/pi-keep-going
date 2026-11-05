import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import registerKeepGoing from "../src/index";
import { CODEX_USAGE_URL } from "../src/limits/codex";
import { JOB_ENTRY_TYPE, type JobEvent } from "../src/persist";

/**
 * Regression test for the 2026-07-11 incident (session 019f51c4-…3435):
 * Anthropic's SDK throws on 429 before pi-ai can invoke onResponse, so
 * `after_provider_response` never fires with 429 headers and the error body
 * carries no reset time. Detection then yields `reset: null`, and without the
 * usage-API fallback the extension only notified ("could not read the reset
 * time") instead of scheduling an auto-resume.
 *
 * Codex over WebSocket hits the same gap: the server's `type: "error"` event
 * becomes "Codex error: The usage limit has been reached" with no HTTP response
 * and no reset time, so the reset must come from wham/usage.
 */

const ANTHROPIC_429 =
  '429 {"type":"error","error":{"type":"rate_limit_error","message":"This request would exceed your account\'s rate limit. Please try again later."},"request_id":"req_test"}';

type Handler = (event: unknown, ctx: ExtensionContext) => void | Promise<void>;

function makePi() {
  const handlers = new Map<string, Handler[]>();
  const appended: Array<{ customType: string; data: JobEvent }> = [];
  const pi = {
    on: (event: string, handler: Handler) => {
      handlers.set(event, [...(handlers.get(event) ?? []), handler]);
    },
    registerCommand: () => {},
    sendUserMessage: vi.fn(),
    appendEntry: (customType: string, data: JobEvent) => {
      appended.push({ customType, data });
    },
  } as unknown as ExtensionAPI;

  const emit = async (event: string, ctx: ExtensionContext): Promise<void> => {
    for (const handler of handlers.get(event) ?? []) {
      await handler({ type: event }, ctx);
    }
  };
  return { pi, emit, appended };
}

const CODEX_WS_LIMIT = "Codex error: The usage limit has been reached";

function makeCtx(
  notifications: string[],
  provider = "anthropic",
  errorMessage = ANTHROPIC_429,
): ExtensionContext {
  const branch = [
    {
      type: "message",
      message: {
        role: "assistant",
        content: [],
        stopReason: "error",
        errorMessage,
      },
    },
  ];
  return {
    cwd: "/tmp",
    isProjectTrusted: () => false,
    isIdle: () => true,
    model: { provider },
    modelRegistry: {
      getApiKeyForProvider: async () => "oauth-token",
    },
    sessionManager: {
      getSessionId: () => "test-session",
      getBranch: () => branch,
    },
    ui: {
      setWidget: () => {},
      notify: (message: string) => notifications.push(message),
      select: async () => undefined,
    },
  } as unknown as ExtensionContext;
}

describe("auto-resume usage-API fallback", () => {
  let agentDir: string;

  beforeEach(() => {
    agentDir = mkdtempSync(join(tmpdir(), "kg-test-"));
    process.env.PI_CODING_AGENT_DIR = agentDir;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.PI_CODING_AGENT_DIR;
    rmSync(agentDir, { recursive: true, force: true });
  });

  async function run(
    fetchImpl: () => Promise<unknown>,
    provider?: string,
    errorMessage?: string,
  ) {
    const fetchMock = vi.fn(fetchImpl);
    vi.stubGlobal("fetch", fetchMock);
    const { pi, emit, appended } = makePi();
    const notifications: string[] = [];
    const ctx = makeCtx(notifications, provider, errorMessage);
    registerKeepGoing(pi);
    await emit("session_start", ctx);
    await emit("agent_settled", ctx);
    await emit("session_shutdown", ctx);
    return { appended, notifications, fetchMock };
  }

  it("schedules auto-resume via oauth/usage when the 429 carries no reset time", async () => {
    const resetsAt = new Date(Date.now() + 60 * 60 * 1000);
    const { appended, notifications } = await run(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ five_hour: { resets_at: resetsAt.toISOString() } }),
    }));

    const created = appended.find(
      (entry) => entry.customType === JOB_ENTRY_TYPE && entry.data.event === "created",
    );
    expect(created).toBeDefined();
    expect(created!.data).toMatchObject({ event: "created", kind: "auto-resume" });
    // fireAt = usage-API reset + default 90s buffer.
    expect((created!.data as Extract<JobEvent, { event: "created" }>).fireAt).toBe(
      resetsAt.getTime() + 90_000,
    );
    expect(notifications.some((m) => m.includes("auto-resuming"))).toBe(true);
  });

  it("schedules auto-resume via wham/usage for a Codex WebSocket usage-limit error", async () => {
    const resetAtSeconds = Math.floor(Date.now() / 1000) + 3600;
    const { appended, fetchMock } = await run(
      async () => ({
        ok: true,
        status: 200,
        json: async () => ({ rate_limit: { primary_window: { reset_at: resetAtSeconds } } }),
      }),
      "openai-codex",
      CODEX_WS_LIMIT,
    );

    expect(fetchMock).toHaveBeenCalledWith(CODEX_USAGE_URL, expect.anything());
    const created = appended.find(
      (entry) => entry.customType === JOB_ENTRY_TYPE && entry.data.event === "created",
    );
    expect(created!.data).toMatchObject({ event: "created", kind: "auto-resume" });
    expect((created!.data as Extract<JobEvent, { event: "created" }>).fireAt).toBe(
      resetAtSeconds * 1000 + 90_000,
    );
  });

  it("falls back to the manual-retry notice when the usage API also fails", async () => {
    const { appended, notifications } = await run(async () => ({
      ok: false,
      status: 500,
      json: async () => ({}),
    }));

    expect(appended.find((entry) => entry.data.event === "created")).toBeUndefined();
    expect(notifications.some((m) => m.includes("could not read the reset time"))).toBe(true);
  });
});
