import { describe, it, expect } from "vitest";
import { parseKgCommand } from "../src/command";

const DEFAULT = "keep going";

describe("parseKgCommand", () => {
  it("treats empty input as help", () => {
    expect(parseKgCommand("", DEFAULT)).toEqual({ kind: "help" });
    expect(parseKgCommand("   ", DEFAULT)).toEqual({ kind: "help" });
    expect(parseKgCommand("help", DEFAULT)).toEqual({ kind: "help" });
  });

  it("parses list and cancel subcommands", () => {
    expect(parseKgCommand("list", DEFAULT)).toEqual({ kind: "list" });
    expect(parseKgCommand("cancel", DEFAULT)).toEqual({ kind: "cancel" });
    // trailing tokens after a subcommand are ignored
    expect(parseKgCommand("list now", DEFAULT)).toEqual({ kind: "list" });
  });

  it("parses auto with default and custom messages", () => {
    expect(parseKgCommand("auto", DEFAULT)).toEqual({ kind: "auto", message: "keep going" });
    expect(parseKgCommand("auto run the tests", DEFAULT)).toEqual({
      kind: "auto",
      message: "run the tests",
    });
  });

  it("schedules a duration with default or custom message", () => {
    expect(parseKgCommand("40m", DEFAULT)).toEqual({
      kind: "schedule",
      seconds: 2400,
      message: "keep going",
    });
    expect(parseKgCommand("2h30m finish the migration", DEFAULT)).toEqual({
      kind: "schedule",
      seconds: 9000,
      message: "finish the migration",
    });
  });

  it("is case-insensitive for the subcommand token", () => {
    expect(parseKgCommand("LIST", DEFAULT)).toEqual({ kind: "list" });
    expect(parseKgCommand("Auto go", DEFAULT)).toEqual({ kind: "auto", message: "go" });
  });

  it("returns an error for an invalid duration", () => {
    const result = parseKgCommand("xyz do stuff", DEFAULT);
    expect(result.kind).toBe("error");
    expect(result).toMatchObject({ kind: "error" });
    if (result.kind === "error") expect(result.reason).toContain("xyz");
  });
});
