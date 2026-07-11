import type { ResetInfo } from "./types";
import {
  defaultFetch,
  errText,
  isoReset,
  pick,
  type FetchDeps,
  type UsageResult,
} from "./client";

/**
 * Anthropic (Claude) usage client. `GET /api/oauth/usage` with a Bearer OAuth
 * token, the `anthropic-beta: oauth-2025-04-20` header, and a `claude-code/<ver>`
 * User-Agent (omitting the UA drops the caller into an aggressive rate-limit
 * bucket). Reset comes from `five_hour.resets_at` (ISO 8601). This endpoint
 * needs an OAuth token — an API-key credential yields 401/403.
 */

export const ANTHROPIC_USAGE_URL = "https://api.anthropic.com/api/oauth/usage";
const DEFAULT_USER_AGENT = "claude-code/1.0.0";

export function anthropicResetFromBody(body: unknown): ResetInfo | null {
  return isoReset(pick(pick(body, "five_hour"), "resets_at"), { window: "five_hour" });
}

export async function fetchAnthropicReset(
  args: { token: string; userAgent?: string } & FetchDeps,
): Promise<UsageResult> {
  const doFetch = args.fetchImpl ?? defaultFetch();

  const headers: Record<string, string> = {
    Authorization: `Bearer ${args.token}`,
    "anthropic-beta": "oauth-2025-04-20",
    "User-Agent": args.userAgent ?? DEFAULT_USER_AGENT,
  };

  let res;
  try {
    res = await doFetch(ANTHROPIC_USAGE_URL, { headers, signal: args.signal });
  } catch (e) {
    return { ok: false, error: `Anthropic usage request failed: ${errText(e)}` };
  }

  if (res.status === 401 || res.status === 403) {
    return {
      ok: false,
      error:
        "Anthropic usage API rejected the token (401/403). The oauth/usage endpoint needs a Claude OAuth login, not an API key.",
    };
  }
  if (!res.ok) {
    return { ok: false, error: `Anthropic usage API returned HTTP ${res.status}.` };
  }

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    return { ok: false, error: "Anthropic usage API returned invalid JSON." };
  }

  const reset = anthropicResetFromBody(body);
  if (!reset) return { ok: false, error: "Anthropic usage response carried no five_hour reset time." };
  return { ok: true, reset };
}
