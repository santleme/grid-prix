export type DriverStatus = "racing" | "finished" | "retired";

export interface DriverView {
  id: string;
  name: string;
  team: string;
  color: string;
  /** Normalized track coordinates in the [0, 1] range. */
  x: number;
  y: number;
  speed: number;
  /** Optional measured speed samples, oldest first. */
  speedHistory?: number[];
  lap: number;
  place: number;
  status: DriverStatus;
  /** Optional recent path, in normalized track coordinates. */
  trail?: Array<{ x: number; y: number }>;
}

export interface RaceEventView {
  tick: number;
  message: string;
  tone?: "neutral" | "positive" | "warning";
}

export interface RaceFrameView {
  tick: number;
  drivers: DriverView[];
}

export interface RaceView {
  tick: number;
  lap: number;
  totalLaps: number;
  track: Array<{ x: number; y: number }>;
  drivers: DriverView[];
  history: RaceFrameView[];
  events: RaceEventView[];
  seed: number;
  status: "ready" | "running" | "paused" | "finished";
}

export interface EvolutionView {
  available?: boolean;
  status: "idle" | "running" | "succeeded" | "rejected" | "error";
  generation: number;
  candidateName?: string;
  summary?: string;
  beforeScore?: number;
  afterScore?: number;
  source?: string;
  log: string[];
}

export interface TeamView {
  name: string;
  color: string;
  points: number;
  budget: number;
  upgrades: string[];
  upgradeIds: string[];
}
