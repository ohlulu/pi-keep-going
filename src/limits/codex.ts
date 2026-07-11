import type { ResetInfo } from "./types";
import {
  decodeJwtPayload,
  defaultFetch,
  errText,
  num,
  pick,
  type FetchDeps,
  type UsageResult,
} from "./client";

/**
 * Codex (ChatGPT) usage client. `GET /backend-api/wham/usage` with a Bearer
 * token and the `ChatGPT-Account-Id` header derived from the access-token JWT.
 * Reset comes from `rate_limit.primary_window.reset_at` (epoch seconds) or
 * `reset_after_seconds` (relative). Facts: docs/plan.md §2.2 + openusage.
 */

export const CODEX_USAGE_URL = "https://chatgpt.com/backend-api/wham/usage";

/**
 * Extract the ChatGPT account id from the access-token JWT. ChatGPT tokens nest
 * it under the `https://api.openai.com/auth` claim; tolerate flat fallbacks too.
 */
export function codexAccountId(token: string): string | undefined {
  const payload = decodeJwtPayload(token);
  if (!payload) return undefined;
  const auth = payload["https://api.openai.com/auth"];
  if (auth && typeof auth === "object") {
    const id = (auth as Record<string, unknown>).chatgpt_account_id;
    if (typeof id === "string" && id.length > 0) return id;
  }
  for (const key of ["chatgpt_account_id", "account_id"]) {
    const value = payload[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return undefined;
}

export function codexResetFromBody(body: unknown, now: number): ResetInfo | null {
  const primary = pick(pick(body, "rate_limit"), "primary_window");
  const resetAt = num(pick(primary, "reset_at"));
  if (resetAt !== null) return { at: new Date(resetAt * 1000), source: "body" };
  const resetAfter = num(pick(primary, "reset_after_seconds"));
  if (resetAfter !== null) return { at: new Date(now + resetAfter * 1000), source: "body" };
  return null;
}

export async function fetchCodexReset(args: { token: string } & FetchDeps): Promise<UsageResult> {
  const now = args.now ?? Date.now();
  const doFetch = args.fetchImpl ?? defaultFetch();

  const headers: Record<string, string> = {
    Authorization: `Bearer ${args.token}`,
    "User-Agent": "pi-keep-going",
  };
  const accountId = codexAccountId(args.token);
  if (accountId) headers["ChatGPT-Account-Id"] = accountId;

  let res;
  try {
    res = await doFetch(CODEX_USAGE_URL, { headers, signal: args.signal });
  } catch (e) {
    return { ok: false, error: `Codex usage request failed: ${errText(e)}` };
  }

  if (res.status === 401 || res.status === 403) {
    return { ok: false, error: "Codex usage API rejected the token (401/403); a re-login may be needed." };
  }
  if (!res.ok) {
    return { ok: false, error: `Codex usage API returned HTTP ${res.status}.` };
  }

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    return { ok: false, error: "Codex usage API returned invalid JSON." };
  }

  const reset = codexResetFromBody(body, now);
  if (!reset) return { ok: false, error: "Codex usage response carried no reset time." };
  return { ok: true, reset };
}
