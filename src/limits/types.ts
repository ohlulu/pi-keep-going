/** Shared types for scheduling and usage-limit reset detection. */

/** When a provider usage window reopens, and where that time came from. */
export interface ResetInfo {
  /** Absolute time the usage window resets. */
  at: Date;
  /** Provenance of the reset time, for display and trust weighting. */
  source: "header" | "body" | "usage-api" | "manual";
  /** Optional window label, e.g. "five_hour" / "primary_window". */
  window?: string;
}

export type JobKind = "manual" | "auto" | "auto-resume";

export type JobState = "created" | "cancelled" | "fired";

/** A single scheduled follow-up message. */
export interface Job {
  id: string;
  /** Absolute fire time, epoch milliseconds. */
  fireAt: number;
  message: string;
  kind: JobKind;
  state: JobState;
}
