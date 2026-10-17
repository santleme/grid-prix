export interface RaceDriver {
  id: string;
  name: string;
  teamId: string;
  color: string;
  x: number;
  y: number;
  heading: number;
  speed: number;
  lap: number;
  nextCheckpoint: number;
  progress: number;
  finished: boolean;
  finishTick: number | null;
  place: number | null;
  faults: number;
}

export interface RaceResult {
  place: number;
  driverId: string;
  driverName: string;
  teamId: string;
  laps: number;
  finishTick: number | null;
  faults: number;
  points: number;
}

export interface RaceEvent {
  [key: string]: unknown;
  tick: number;
  type: string;
  driverId?: string;
  driverCount?: number;
  teamCount?: number;
  results?: RaceResult[];
  reason?: string;
}

export interface RaceSnapshot {
  tick: number;
  drivers: Array<Pick<RaceDriver, "id" | "x" | "y" | "speed" | "lap" | "place"> & { heading: number }>;
}

export interface RaceState {
  seed: number;
  laps: number;
  tick: number;
  status: "running" | "finished";
  drivers: RaceDriver[];
  events: RaceEvent[];
  history: RaceSnapshot[];
  results: RaceResult[];
}

export type EngineDriver = RaceDriver;
export type EngineRace = RaceState;
export type EngineFrame = RaceSnapshot;

export const ARENA: Readonly<{ width: number; height: number; margin: number }>;
export const DRIVER_COUNT: number;
export const TEAM_COUNT: number;
export const DEFAULT_LAPS: number;
export const MAX_TICKS: number;
export const PHYSICS: Readonly<Record<string, number>>;
export function createRace(options?: { seed?: number; laps?: number; drivers?: Array<Partial<RaceDriver>> }): RaceState;
export function stepRace(race: RaceState, policy?: (driver: Omit<RaceDriver, "faults">, target: { x: number; y: number }, tick: number) => { steering?: number; throttle?: number }): RaceState;
export function runRace(options?: { seed?: number; laps?: number; drivers?: Array<Partial<RaceDriver>>; maxTicks?: number; policy?: (driver: Omit<RaceDriver, "faults">, target: { x: number; y: number }, tick: number) => { steering?: number; throttle?: number } }): RaceState;
export function racingPolicy(driver: Partial<RaceDriver> & { heading: number; x: number; y: number }, target: { x: number; y: number }): { steering: number; throttle: number };
export function getTrack(): Array<{ x: number; y: number }>;
