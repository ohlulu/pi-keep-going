import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import registerKeepGoing from "../src/index";
import { JOB_ENTRY_TYPE, type JobEvent } from "../src/persist";

/**
 * Regression test for the 2026-07-11 incident (session 019f51c4-…3435):
 * Anthropic's SDK throws on 429 before pi-ai can invoke onResponse, so
 * `after_provider_response` never fires with 429 headers and the error body
 * carries no reset time. Detection then yields `reset: null`, and without the
 * usage-API fallback the extension only notified ("could not read the reset
 * time") instead of scheduling an auto-resume.
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

function makeCtx(notifications: string[]): ExtensionContext {
  const branch = [
    {
      type: "message",
      message: {
        role: "assistant",
        content: [],
        stopReason: "error",
        errorMessage: ANTHROPIC_429,
      },
    },
  ];
  return {
    cwd: "/tmp",
    isProjectTrusted: () => false,
    isIdle: () => true,
    model: { provider: "anthropic" },
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

  async function run(fetchImpl: () => Promise<unknown>) {
    vi.stubGlobal("fetch", vi.fn(fetchImpl));
    const { pi, emit, appended } = makePi();
    const notifications: string[] = [];
    const ctx = makeCtx(notifications);
    registerKeepGoing(pi);
    await emit("session_start", ctx);
    await emit("agent_settled", ctx);
    await emit("session_shutdown", ctx);
    return { appended, notifications };
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
