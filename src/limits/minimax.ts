import type { ResetInfo } from "./types";
import {
  defaultFetch,
  errText,
  num,
  pick,
  type FetchDeps,
  type UsageResult,
} from "./client";

/**
 * MiniMax Token Plan usage client. `GET /v1/token_plan/remains` with a Bearer
 * Subscription Key (the same key used for model calls). The response carries
 * one entry per model family, each with a 5-hour `end_time` and a weekly
 * `weekly_end_time`; the reset we want is the earliest such close time across
 * entries that have any quota. The endpoint is documented but MiniMax may
 * also return a non-zero `base_resp.status_code` for plan-less keys, which
 * surfaces as a soft error and lets the caller degrade to a manual prompt.
 */

export const MINIMAX_USAGE_URL = "https://api.minimax.io/v1/token_plan/remains";
export const MINIMAX_CN_USAGE_URL = "https://api.minimaxi.com/v1/token_plan/remains";

export function minimaxUsageUrl(provider: string): string {
  return provider === "minimax-cn" ? MINIMAX_CN_USAGE_URL : MINIMAX_USAGE_URL;
}

export function minimaxResetFromBody(body: unknown): ResetInfo | null {
  const entries = pick(body, "model_remains");
  if (!Array.isArray(entries)) return null;
  let earliest: number | null = null;
  for (const entry of entries) {
    for (const key of ["end_time", "weekly_end_time"]) {
      const v = num(pick(entry, key));
      if (v !== null && (earliest === null || v < earliest)) earliest = v;
    }
  }
  if (earliest === null) return null;
  return { at: new Date(earliest), source: "body" };
}

export async function fetchMinimaxReset(
  args: { token: string; provider: string } & FetchDeps,
): Promise<UsageResult> {
  const doFetch = args.fetchImpl ?? defaultFetch();
  const headers: Record<string, string> = {
    Authorization: `Bearer ${args.token}`,
    "Content-Type": "application/json",
  };

  let res;
  try {
    res = await doFetch(minimaxUsageUrl(args.provider), { headers, signal: args.signal });
  } catch (e) {
    return { ok: false, error: `MiniMax usage request failed: ${errText(e)}` };
  }

  if (res.status === 401 || res.status === 403) {
    return {
      ok: false,
      error: "MiniMax usage API rejected the token (401/403); a Token Plan Subscription Key may be required.",
    };
  }
  if (!res.ok) {
    return { ok: false, error: `MiniMax usage API returned HTTP ${res.status}.` };
  }

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    return { ok: false, error: "MiniMax usage API returned invalid JSON." };
  }

  const baseResp = pick(body, "base_resp");
  if (baseResp && typeof baseResp === "object") {
    const code = num(pick(baseResp, "status_code"));
    if (code !== null && code !== 0) {
      const msg = pick(baseResp, "status_msg");
      return {
        ok: false,
        error: `MiniMax usage API returned status ${code}${typeof msg === "string" ? `: ${msg}` : "."}`,
      };
    }
  }

  const reset = minimaxResetFromBody(body);
  if (!reset) return { ok: false, error: "MiniMax usage response carried no end_time." };
  return { ok: true, reset };
}
