import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import registerKeepGoing from "../src/index";
import { CODEX_USAGE_URL } from "../src/limits/codex";
import { JOB_ENTRY_TYPE, type JobEvent } from "../src/persist";
import { RESUME_ENTRY_TYPE, type ResumeDecisionEntry } from "../src/resume-log";

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
 *
 * 2026-11-16 incident (session 01a1e498-…2cef5a): 16 subagent children, each
 * loading this extension, queried oauth/usage in the same second; the parent's
 * lookup failed and auto-resume degraded to an ephemeral notice. Children are now
 * inert (no UI), a failed lookup schedules a backoff retry, and every decision is
 * logged to the session.
 */

const ANTHROPIC_429 =
  '429 {"type":"error","error":{"type":"rate_limit_error","message":"This request would exceed your account\'s rate limit. Please try again later."},"request_id":"req_test"}';

type Handler = (event: unknown, ctx: ExtensionContext) => void | Promise<void>;

type Appended =
  | { customType: typeof JOB_ENTRY_TYPE; data: JobEvent }
  | { customType: typeof RESUME_ENTRY_TYPE; data: ResumeDecisionEntry };

function makePi() {
  const handlers = new Map<string, Handler[]>();
  const appended: Appended[] = [];
  const pi = {
    on: (event: string, handler: Handler) => {
      handlers.set(event, [...(handlers.get(event) ?? []), handler]);
    },
    registerCommand: () => {},
    sendUserMessage: vi.fn(),
    appendEntry: (customType: string, data: unknown) => {
      appended.push({ customType, data } as Appended);
    },
  } as unknown as ExtensionAPI & { sendUserMessage: ReturnType<typeof vi.fn> };

  const emit = async (event: string, ctx: ExtensionContext): Promise<void> => {
    for (const handler of handlers.get(event) ?? []) {
      await handler({ type: event }, ctx);
    }
  };
  return { pi, emit, appended };
}

const CODEX_WS_LIMIT = "Codex error: The usage limit has been reached";

type BranchEntry = Record<string, unknown>;

function errorEntry(errorMessage = ANTHROPIC_429, id = "err-1"): BranchEntry {
  return {
    type: "message",
    id,
    message: { role: "assistant", content: [], stopReason: "error", errorMessage },
  };
}

function makeCtx(
  notifications: string[],
  opts: { provider?: string; branch?: BranchEntry[]; hasUI?: boolean } = {},
): ExtensionContext {
  const branch = opts.branch ?? [errorEntry()];
  return {
    cwd: "/tmp",
    hasUI: opts.hasUI ?? true,
    mode: opts.hasUI === false ? "print" : "tui",
    isProjectTrusted: () => false,
    isIdle: () => true,
    model: { provider: opts.provider ?? "anthropic" },
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

const usage429 = async () => ({ ok: false, status: 429, json: async () => ({}) });

function createdJobs(appended: Appended[]) {
  return appended.flatMap((entry) =>
    entry.customType === JOB_ENTRY_TYPE && entry.data.event === "created" ? [entry.data] : [],
  );
}

function decisions(appended: Appended[]): ResumeDecisionEntry[] {
  return appended.flatMap((entry) => (entry.customType === RESUME_ENTRY_TYPE ? [entry.data] : []));
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
    opts: { provider?: string; errorMessage?: string; branch?: BranchEntry[]; hasUI?: boolean } = {},
  ) {
    const fetchMock = vi.fn(fetchImpl);
    vi.stubGlobal("fetch", fetchMock);
    const { pi, emit, appended } = makePi();
    const notifications: string[] = [];
    const ctx = makeCtx(notifications, {
      provider: opts.provider,
      hasUI: opts.hasUI,
      branch: opts.branch ?? [errorEntry(opts.errorMessage)],
    });
    registerKeepGoing(pi);
    await emit("session_start", ctx);
    await emit("agent_settled", ctx);
    await emit("session_shutdown", ctx);
    return { appended, notifications, fetchMock, pi };
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
      { provider: "openai-codex", errorMessage: CODEX_WS_LIMIT },
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

  it("schedules a 30-minute retry and logs the reason when the usage API fails", async () => {
    const before = Date.now();
    const { appended, notifications } = await run(usage429);
    const after = Date.now();

    const [job] = createdJobs(appended);
    expect(job).toMatchObject({ kind: "auto-resume" });
    const fireAt = (job as Extract<JobEvent, { event: "created" }>).fireAt;
    expect(fireAt).toBeGreaterThanOrEqual(before + 30 * 60_000);
    expect(fireAt).toBeLessThanOrEqual(after + 30 * 60_000);

    expect(decisions(appended)).toEqual([
      {
        errorEntryId: "err-1",
        provider: "anthropic",
        action: "schedule",
        fireAt,
        resetSource: "fallback",
        usageError: "Anthropic usage API returned HTTP 429.",
      },
    ]);
    expect(notifications.some((m) => m.includes("reset time is unknown"))).toBe(true);
  });

  it("doubles the retry when the previous fallback hit the limit again", async () => {
    const branch = [
      errorEntry(ANTHROPIC_429, "err-1"),
      {
        type: "custom",
        customType: RESUME_ENTRY_TYPE,
        data: { errorEntryId: "err-1", provider: "anthropic", action: "schedule", resetSource: "fallback" },
      },
      { type: "message", id: "user-1", message: { role: "user", content: "continue" } },
      errorEntry(ANTHROPIC_429, "err-2"),
    ];
    const before = Date.now();
    const { appended } = await run(usage429, { branch });

    const [job] = createdJobs(appended);
    expect((job as Extract<JobEvent, { event: "created" }>).fireAt).toBeGreaterThanOrEqual(
      before + 60 * 60_000,
    );
    expect(decisions(appended)[0]).toMatchObject({ errorEntryId: "err-2", resetSource: "fallback" });
  });

  it("handles each assistant error once, even across a session restart", async () => {
    const branch = [
      errorEntry(),
      {
        type: "custom",
        customType: RESUME_ENTRY_TYPE,
        data: { errorEntryId: "err-1", provider: "anthropic", action: "schedule", resetSource: "fallback" },
      },
    ];
    const { appended, fetchMock } = await run(usage429, { branch });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(appended).toEqual([]);
  });

  it("does not query the usage API when auto-resume is disabled", async () => {
    writeFileSync(join(agentDir, "keep-going.json"), JSON.stringify({ autoResume: { enabled: false } }));
    const { appended, fetchMock } = await run(usage429);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(createdJobs(appended)).toEqual([]);
    expect(decisions(appended)).toEqual([
      expect.objectContaining({ action: "skip", reason: "auto-resume disabled" }),
    ]);
  });

  it("stays inert in a session without a UI (subagent child, print mode)", async () => {
    const dueJob = {
      type: "custom",
      customType: JOB_ENTRY_TYPE,
      data: { event: "created", id: "due", fireAt: 0, message: "continue", kind: "auto-resume" },
    };
    const { appended, fetchMock, pi } = await run(usage429, {
      hasUI: false,
      branch: [dueJob, errorEntry()],
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(appended).toEqual([]);
    expect(pi.sendUserMessage).not.toHaveBeenCalled();
    expect(existsSync(join(agentDir, "keep-going", "locks"))).toBe(false);
  });
});
