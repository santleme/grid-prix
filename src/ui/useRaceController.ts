import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ARENA, createRace, getTrack, stepRace } from "../simulation/index.mjs";
import type { RaceDriver, RaceEvent, RaceState } from "../simulation/index.mjs";
import type { DriverView, RaceFrameView, RaceView } from "./types";

const track = getTrack().map((point) => ({ x: point.x / ARENA.width, y: point.y / ARENA.height }));

/** React adapter for the deterministic engine; simulation state remains the source of truth. */
export function useRaceController(seed = 1, laps = 3) {
  const [roundSeed, setRoundSeed] = useState(seed);
  const [engineRace, setRaceState] = useState(() => createRace({ seed: roundSeed, laps }));
  const [paused, setPaused] = useState(true);
  const [initialDrivers, setInitialDrivers] = useState(() => engineRace.drivers.map((driver) => ({ ...driver })));
  const historyCache = useRef<RaceFrameView[]>([]);
  const raceRef = useRef(engineRace);
  raceRef.current = engineRace;

  const refresh = useCallback(() => {
    setRaceState({ ...raceRef.current });
  }, []);

  const start = useCallback(() => setPaused(false), []);
  const pause = useCallback(() => setPaused(true), []);
  const step = useCallback(() => {
    const race = raceRef.current;
    if (race.status === "finished") return;
    stepRace(race);
    refresh();
  }, [refresh]);
  const reset = useCallback(() => {
    const nextSeed = roundSeed + 1;
    setRoundSeed(nextSeed);
    const next = createRace({ seed: nextSeed, laps });
    raceRef.current = next;
    setRaceState(next);
    setInitialDrivers(next.drivers.map((driver) => ({ ...driver })));
    historyCache.current = [];
    setPaused(true);
  }, [roundSeed, laps]);

  useEffect(() => {
    if (paused || engineRace.status === "finished") return;
    const timer = window.setInterval(() => {
      const race = raceRef.current;
      if (race.status === "finished") return;
      stepRace(race);
      refresh();
      if ((race.status as string) === "finished") setPaused(true);
    }, 50);
    return () => window.clearInterval(timer);
  }, [paused, engineRace.status, refresh]);

  const race = useMemo(() => toRaceView(engineRace, paused, initialDrivers, historyCache.current), [engineRace, paused, initialDrivers]);
  return { race, start, pause, reset, step };
}

function toRaceView(engineRace: RaceState, paused: boolean, initialDrivers: RaceDriver[], history: RaceFrameView[]): RaceView {
  const current = new Map(engineRace.drivers.map((driver) => [driver.id, driver]));
  if (history.length === 0) history.push({ tick: 0, drivers: initialDrivers.map((driver) => makeDriverView(driver)) });
  for (let index = history.length - 1; index < engineRace.history.length; index += 1) {
    const frame = engineRace.history[index];
    if (!frame) continue;
    history.push({
      tick: frame.tick,
      drivers: frame.drivers.map((snapshot) => {
        const driver = current.get(snapshot.id);
        return driver ? makeDriverView({ ...driver, ...snapshot }) : undefined;
      }).filter((driver): driver is DriverView => driver != null),
    });
  }
  const recentFrames = engineRace.history.slice(-32);
  const currentDrivers = engineRace.drivers.map((driver) => {
    const samples = recentFrames.map((frame) => frame.drivers.find((snapshot) => snapshot.id === driver.id)).filter((snapshot) => snapshot != null);
    return makeDriverView(driver, samples.map((snapshot) => snapshot.speed), samples.map((snapshot) => ({ x: snapshot.x / ARENA.width, y: snapshot.y / ARENA.height })));
  });
  const events = engineRace.events.slice(-8).map((event) => ({
    tick: Number(event.tick ?? 0),
    message: describeEvent(event),
    tone: event.type === "race-finished" || event.type === "driver-finished" ? "positive" as const : "neutral" as const,
  }));
  return {
    tick: engineRace.tick,
    lap: Math.max(0, ...engineRace.drivers.map((driver) => driver.lap)),
    totalLaps: engineRace.laps,
    track,
    drivers: currentDrivers,
    history,
    events,
    seed: engineRace.seed,
    status: engineRace.status === "finished" ? "finished" : paused ? engineRace.tick === 0 ? "ready" : "paused" : "running",
  };
}

function makeDriverView(driver: RaceDriver, speedHistory: number[] = [], trail: Array<{ x: number; y: number }> = []): DriverView {
  return {
    id: driver.id,
    name: driver.name,
    team: driver.teamId,
    color: driver.color,
    x: driver.x / ARENA.width,
    y: driver.y / ARENA.height,
    speed: driver.speed,
    speedHistory,
    lap: driver.lap,
    place: driver.place ?? Number.MAX_SAFE_INTEGER,
    status: driver.finished ? "finished" : "racing",
    trail,
  };
}

function describeEvent(event: RaceEvent) {
  if (event.type === "race-start") return `Race started with ${event.driverCount} drivers across ${event.teamCount} teams.`;
  if (event.type === "driver-finished") return `Driver ${String(event.driverId)} crossed the finish line.`;
  if (event.type === "race-finished") return "Race complete. Final classification recorded.";
  return String(event.type ?? "Race event");
}
