import { describe, it, expect } from "vitest";
import {
  DEFAULT_SETTINGS,
  parseSettings,
  mergeSettings,
  loadSettings,
  type SettingsIO,
} from "../src/settings";

function ioFrom(files: Record<string, unknown>): SettingsIO {
  return { readJson: (path) => (path in files ? files[path] : null) };
}

describe("DEFAULT_SETTINGS", () => {
  it("defaults auto-resume ON with the locked defaults", () => {
    expect(DEFAULT_SETTINGS.autoResume).toEqual({
      enabled: true,
      message: "continue",
      bufferSeconds: 90,
      maxPerSession: 5,
      maxWaitHours: 24,
    });
    expect(DEFAULT_SETTINGS.defaultMessage).toBe("keep going");
  });
});

describe("parseSettings", () => {
  it("extracts valid fields and ignores invalid ones", () => {
    expect(
      parseSettings({
        defaultMessage: "go",
        autoResume: { enabled: false, bufferSeconds: 30, maxWaitHours: "nope", junk: 1 },
        extra: true,
      }),
    ).toEqual({
      defaultMessage: "go",
      autoResume: { enabled: false, bufferSeconds: 30 },
    });
  });

  it("returns an empty partial for non-objects and negatives", () => {
    expect(parseSettings(null)).toEqual({});
    expect(parseSettings("x")).toEqual({});
    expect(parseSettings({ autoResume: { bufferSeconds: -5 } })).toEqual({});
  });
});

describe("mergeSettings", () => {
  it("returns defaults when no layers are given", () => {
    expect(mergeSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it("lets later layers override earlier ones and merges nested fields", () => {
    const merged = mergeSettings(
      { autoResume: { enabled: false, bufferSeconds: 120 } },
      { autoResume: { bufferSeconds: 300 } },
    );
    expect(merged.autoResume.enabled).toBe(false); // from global
    expect(merged.autoResume.bufferSeconds).toBe(300); // project wins
    expect(merged.autoResume.message).toBe("continue"); // default preserved
  });
});

describe("loadSettings", () => {
  const globalPath = "/global/keep-going.json";
  const projectPath = "/project/.pi/keep-going.json";

  it("applies global config over defaults", () => {
    const io = ioFrom({ [globalPath]: { autoResume: { maxPerSession: 9 } } });
    const s = loadSettings({ io, globalPath });
    expect(s.autoResume.maxPerSession).toBe(9);
    expect(s.autoResume.enabled).toBe(true);
  });

  it("applies a trusted project config over global", () => {
    const io = ioFrom({
      [globalPath]: { autoResume: { message: "resume", maxPerSession: 9 } },
      [projectPath]: { autoResume: { message: "carry on" } },
    });
    const s = loadSettings({ io, globalPath, projectPath });
    expect(s.autoResume.message).toBe("carry on"); // project wins
    expect(s.autoResume.maxPerSession).toBe(9); // from global
  });

  it("ignores the project config when untrusted (projectPath null)", () => {
    const io = ioFrom({
      [globalPath]: { autoResume: { message: "resume" } },
      [projectPath]: { autoResume: { message: "malicious" } },
    });
    const s = loadSettings({ io, globalPath, projectPath: null });
    expect(s.autoResume.message).toBe("resume"); // project not read
  });
});
