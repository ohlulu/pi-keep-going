import type { ResetInfo } from "./types";
import { defaultFetch, errText, pick, type FetchDeps, type UsageResult } from "./client";

/**
 * Gemini (Code Assist) usage client. `POST v1internal:retrieveUserQuota` with a
 * Bearer token and a `{ projectId }` body; the reset comes from the earliest
 * `buckets[].resetTime` (ISO 8601). The projectId is credential metadata from
 * the `google-gemini-cli` OAuth login (an index-signature field on the stored
 * credential) — an API-key credential has none, so `auto` is unsupported there.
 *
 * NOTE: this Code Assist endpoint is undocumented; treat failures as soft — the
 * caller degrades to a manual `/kg <duration>` prompt. Host/shape to be
 * confirmed against a live google-gemini-cli login.
 */

export const GEMINI_QUOTA_URL =
  "https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuota";

export function geminiResetFromBody(body: unknown): ResetInfo | null {
  const buckets = pick(body, "buckets");
  if (!Array.isArray(buckets)) return null;
  let earliest: number | null = null;
  for (const bucket of buckets) {
    const resetTime = pick(bucket, "resetTime");
    if (typeof resetTime !== "string") continue;
    const ms = Date.parse(resetTime);
    if (Number.isFinite(ms) && (earliest === null || ms < earliest)) earliest = ms;
  }
  if (earliest === null) return null;
  return { at: new Date(earliest), source: "body" };
}

export async function fetchGeminiReset(
  args: { token: string; projectId?: string } & FetchDeps,
): Promise<UsageResult> {
  if (!args.projectId) {
    return {
      ok: false,
      error:
        "Gemini auto mode needs a Code Assist projectId from a google-gemini-cli login; none is available.",
    };
  }

  const doFetch = args.fetchImpl ?? defaultFetch();
  const headers: Record<string, string> = {
    Authorization: `Bearer ${args.token}`,
    "Content-Type": "application/json",
  };
  const requestBody = JSON.stringify({ projectId: args.projectId });

  let res;
  try {
    res = await doFetch(GEMINI_QUOTA_URL, {
      method: "POST",
      headers,
      body: requestBody,
      signal: args.signal,
    });
  } catch (e) {
    return { ok: false, error: `Gemini quota request failed: ${errText(e)}` };
  }

  if (res.status === 401 || res.status === 403) {
    return { ok: false, error: "Gemini quota API rejected the token (401/403)." };
  }
  if (!res.ok) {
    return { ok: false, error: `Gemini quota API returned HTTP ${res.status}.` };
  }

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    return { ok: false, error: "Gemini quota API returned invalid JSON." };
  }

  const reset = geminiResetFromBody(body);
  if (!reset) return { ok: false, error: "Gemini quota response carried no reset time." };
  return { ok: true, reset };
}
