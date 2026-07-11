import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CONFIG_DIR_NAME, getAgentDir } from "@earendil-works/pi-coding-agent";

/**
 * Layered settings: DEFAULT ← global (`<agentDir>/keep-going.json`) ← project
 * (`<cwd>/<CONFIG_DIR_NAME>/keep-going.json`). The project layer is only read
 * when the project is trusted — the caller passes `projectPath: null` otherwise,
 * so an untrusted repo can never inject an auto-resume message.
 *
 * Parsing and merging are pure and validated (bad fields are ignored, never
 * thrown) so a malformed config degrades to defaults rather than breaking.
 */

export interface AutoResumeSettings {
  enabled: boolean;
  message: string;
  bufferSeconds: number;
  maxPerSession: number;
  maxWaitHours: number;
}

export interface KeepGoingSettings {
  defaultMessage: string;
  autoResume: AutoResumeSettings;
}

export interface PartialSettings {
  defaultMessage?: string;
  autoResume?: Partial<AutoResumeSettings>;
}

export const DEFAULT_SETTINGS: KeepGoingSettings = {
  defaultMessage: "keep going",
  autoResume: {
    enabled: true,
    message: "continue",
    bufferSeconds: 90,
    maxPerSession: 5,
    maxWaitHours: 24,
  },
};

function asString(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}
function asBool(v: unknown): boolean | undefined {
  return typeof v === "boolean" ? v : undefined;
}
function asNonNegNumber(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : undefined;
}

/** Coerce parsed JSON into a validated partial, dropping unknown/invalid fields. */
export function parseSettings(raw: unknown): PartialSettings {
  if (!raw || typeof raw !== "object") return {};
  const obj = raw as Record<string, unknown>;
  const out: PartialSettings = {};

  const defaultMessage = asString(obj.defaultMessage);
  if (defaultMessage !== undefined) out.defaultMessage = defaultMessage;

  if (obj.autoResume && typeof obj.autoResume === "object") {
    const ar = obj.autoResume as Record<string, unknown>;
    const arOut: Partial<AutoResumeSettings> = {};
    const enabled = asBool(ar.enabled);
    if (enabled !== undefined) arOut.enabled = enabled;
    const message = asString(ar.message);
    if (message !== undefined) arOut.message = message;
    const bufferSeconds = asNonNegNumber(ar.bufferSeconds);
    if (bufferSeconds !== undefined) arOut.bufferSeconds = bufferSeconds;
    const maxPerSession = asNonNegNumber(ar.maxPerSession);
    if (maxPerSession !== undefined) arOut.maxPerSession = maxPerSession;
    const maxWaitHours = asNonNegNumber(ar.maxWaitHours);
    if (maxWaitHours !== undefined) arOut.maxWaitHours = maxWaitHours;
    if (Object.keys(arOut).length > 0) out.autoResume = arOut;
  }
  return out;
}

/** Merge validated partial layers onto the defaults (later layers win). */
export function mergeSettings(...layers: PartialSettings[]): KeepGoingSettings {
  const result: KeepGoingSettings = {
    defaultMessage: DEFAULT_SETTINGS.defaultMessage,
    autoResume: { ...DEFAULT_SETTINGS.autoResume },
  };
  for (const layer of layers) {
    if (layer.defaultMessage !== undefined) result.defaultMessage = layer.defaultMessage;
    if (layer.autoResume) Object.assign(result.autoResume, layer.autoResume);
  }
  return result;
}

export interface SettingsIO {
  /** Return parsed JSON for a path, or null when missing/unreadable/invalid. */
  readJson(path: string): unknown | null;
}

export interface LoadSettingsOptions {
  io: SettingsIO;
  globalPath: string;
  /** Trusted project config path, or null when there is no project or it is untrusted. */
  projectPath?: string | null;
}

export function loadSettings(options: LoadSettingsOptions): KeepGoingSettings {
  const global = parseSettings(options.io.readJson(options.globalPath));
  const project = options.projectPath
    ? parseSettings(options.io.readJson(options.projectPath))
    : {};
  return mergeSettings(global, project);
}

// --- Production path/IO helpers (thin; not unit-tested) --------------------

export function globalSettingsPath(): string {
  return join(getAgentDir(), "keep-going.json");
}

export function projectSettingsPath(cwd: string): string {
  return join(cwd, CONFIG_DIR_NAME, "keep-going.json");
}

export function defaultSettingsIO(): SettingsIO {
  return {
    readJson(path: string): unknown | null {
      try {
        return JSON.parse(readFileSync(path, "utf8"));
      } catch {
        return null;
      }
    },
  };
}
