/**
 * Deterministic, dependency-free GRID PRIX race simulation.
 *
 * Coordinates are CSS-pixel-like units on a 1200 x 760 arena. Policies receive
 * an immutable driver snapshot and a waypoint target and return normalized
 * steering/acceleration controls. Keep policy output serializable so Python
 * policies can use the same JSON contract as browser-native policies.
 */

export const ARENA = Object.freeze({ width: 1200, height: 760, margin: 42 });
export const DRIVER_COUNT = 20;
export const TEAM_COUNT = 10;
export const DEFAULT_LAPS = 3;
export const MAX_TICKS = 12_000;
export const PHYSICS = Object.freeze({
  maxSpeed: 5.4,
  acceleration: 0.075,
  braking: 0.11,
  drag: 0.992,
  turnRate: 0.052,
  collisionRadius: 6,
});

const TRACK = Object.freeze([
  Object.freeze({ x: 920, y: 148 }),
  Object.freeze({ x: 1052, y: 230 }),
  Object.freeze({ x: 1052, y: 530 }),
  Object.freeze({ x: 920, y: 612 }),
  Object.freeze({ x: 280, y: 612 }),
  Object.freeze({ x: 148, y: 530 }),
  Object.freeze({ x: 148, y: 230 }),
  Object.freeze({ x: 280, y: 148 }),
]);

const DRIVER_NAMES = Object.freeze([
  'Apex', 'Vector', 'Nitro', 'Pulse', 'Comet', 'Drift', 'Rogue', 'Nova',
  'Turbo', 'Blitz', 'Echo', 'Vortex', 'Sonic', 'Glitch', 'Spark', 'Phantom',
  'Rocket', 'Cipher', 'Volt', 'Orbit',
]);

// Each preset changes the executable driving policy, not only presentation.
// laneBias and lookahead choose a line; cornering, pace, acceleration,
// braking, and risk alter control decisions in racingPolicy.
export const DRIVER_STRATEGIES = Object.freeze([
  { id: 'apex', laneBias: -0.18, lookahead: 0.18, cornering: 1.22, pace: 0.96, acceleration: 0.95, braking: 1.16, risk: 0.24 },
  { id: 'vector', laneBias: 0.12, lookahead: 0.58, cornering: 0.94, pace: 1.02, acceleration: 1.04, braking: 0.92, risk: 0.54 },
  { id: 'nitro', laneBias: 0.24, lookahead: 0.34, cornering: 0.88, pace: 1.12, acceleration: 1.20, braking: 0.72, risk: 0.92 },
  { id: 'pulse', laneBias: -0.08, lookahead: 0.76, cornering: 1.08, pace: 0.91, acceleration: 0.91, braking: 1.28, risk: 0.38 },
  { id: 'comet', laneBias: 0.30, lookahead: 0.25, cornering: 0.82, pace: 1.08, acceleration: 1.12, braking: 0.82, risk: 0.82 },
  { id: 'drift', laneBias: -0.28, lookahead: 0.65, cornering: 1.16, pace: 1.00, acceleration: 0.98, braking: 0.86, risk: 0.70 },
  { id: 'rogue', laneBias: 0.18, lookahead: 0.42, cornering: 0.90, pace: 1.10, acceleration: 1.08, braking: 0.68, risk: 0.98 },
  { id: 'nova', laneBias: -0.12, lookahead: 0.88, cornering: 1.20, pace: 0.88, acceleration: 0.88, braking: 1.34, risk: 0.18 },
  { id: 'turbo', laneBias: 0.34, lookahead: 0.32, cornering: 0.86, pace: 1.14, acceleration: 1.16, braking: 0.78, risk: 0.88 },
  { id: 'blitz', laneBias: -0.34, lookahead: 0.52, cornering: 1.04, pace: 1.06, acceleration: 1.22, braking: 0.74, risk: 0.94 },
  { id: 'echo', laneBias: 0.06, lookahead: 0.94, cornering: 1.14, pace: 0.90, acceleration: 0.92, braking: 1.22, risk: 0.30 },
  { id: 'vortex', laneBias: 0.28, lookahead: 0.70, cornering: 0.92, pace: 1.04, acceleration: 1.02, braking: 0.88, risk: 0.76 },
  { id: 'sonic', laneBias: -0.22, lookahead: 0.28, cornering: 1.10, pace: 1.12, acceleration: 1.14, braking: 0.70, risk: 0.86 },
  { id: 'glitch', laneBias: 0.14, lookahead: 0.82, cornering: 0.84, pace: 0.98, acceleration: 1.06, braking: 1.08, risk: 0.62 },
  { id: 'spark', laneBias: -0.04, lookahead: 0.46, cornering: 1.26, pace: 0.94, acceleration: 1.10, braking: 1.18, risk: 0.42 },
  { id: 'phantom', laneBias: 0.22, lookahead: 0.62, cornering: 1.00, pace: 1.08, acceleration: 0.90, braking: 0.80, risk: 0.80 },
  { id: 'rocket', laneBias: -0.30, lookahead: 0.38, cornering: 0.80, pace: 1.16, acceleration: 1.24, braking: 0.66, risk: 1.00 },
  { id: 'cipher', laneBias: 0.10, lookahead: 0.98, cornering: 1.18, pace: 0.92, acceleration: 0.96, braking: 1.30, risk: 0.22 },
  { id: 'volt', laneBias: 0.32, lookahead: 0.22, cornering: 0.96, pace: 1.06, acceleration: 1.18, braking: 0.84, risk: 0.90 },
  { id: 'orbit', laneBias: -0.16, lookahead: 0.72, cornering: 1.06, pace: 0.96, acceleration: 0.86, braking: 1.12, risk: 0.34 },
].map((strategy) => Object.freeze(strategy)));

const STRATEGY_BY_ID = new Map(DRIVER_STRATEGIES.map((strategy) => [strategy.id, strategy]));

const DEFAULT_COLORS = Object.freeze([
  '#00f5d4', '#f15bb5', '#fee440', '#00bbf9', '#9b5de5',
  '#fb5607', '#80ed99', '#ff006e', '#3a86ff', '#caffbf',
]);

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Number.isFinite(value) ? value : 0));
}

function angleDelta(from, to) {
  let delta = (to - from + Math.PI) % (Math.PI * 2);
  if (delta < 0) delta += Math.PI * 2;
  return delta - Math.PI;
}

function seededRandom(seed) {
  let state = (Number(seed) >>> 0) || 0x9e3779b9;
  return () => {
    state += 0x6d2b79f5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function makeDrivers(seed, drivers = []) {
  const random = seededRandom(seed);
  return Array.from({ length: DRIVER_COUNT }, (_, index) => {
    const spec = drivers[index] ?? {};
    const slot = index % 10;
    // Two lanes per team, ten teams, aligned across the start/finish straight.
    const lane = Math.floor(index / 10);
    const defaultStrategy = DRIVER_STRATEGIES[index];
    const strategyId = String(spec.strategyId ?? defaultStrategy.id);
    const preset = STRATEGY_BY_ID.get(strategyId);
    if (!preset) throw new Error(`Unknown driver strategy: ${strategyId}`);
    const strategy = Object.freeze({ ...preset, ...(spec.strategy ?? {}) });
    const x = 300 + slot * 62;
    const y = lane === 0 ? 183 : 218;
    return {
      id: String(spec.id ?? `driver-${String(index + 1).padStart(2, '0')}`),
      name: String(spec.name ?? DRIVER_NAMES[index]),
      teamId: String(spec.teamId ?? `team-${String(index % TEAM_COUNT + 1).padStart(2, '0')}`),
      color: String(spec.color ?? DEFAULT_COLORS[index % TEAM_COUNT]),
      strategyId,
      strategy,
      x,
      y,
      heading: 0,
      speed: 0,
      lap: 0,
      nextCheckpoint: 0,
      progress: 0,
      finished: false,
      finishTick: null,
      place: null,
      faults: 0,
      // Stable, seeded differences for otherwise identical default policies.
      skill: 0.94 + random() * 0.12,
      policyState: spec.policyState ?? null,
    };
  });
}

/** Default strategy-aware waypoint policy; external policies may use the same signature. */
export function racingPolicy(driver, target, _tick, opponents = []) {
  const strategy = driver.strategy ?? STRATEGY_BY_ID.get(driver.strategyId) ?? DRIVER_STRATEGIES[0];
  // Never aim beyond the active checkpoint: doing so can make a car orbit a
  // waypoint without triggering its lap. Lookahead changes anticipatory
  // braking below; overtaking changes the line only near a rival.
  const next = TRACK[(driver.nextCheckpoint + 1) % TRACK.length];
  const segmentAngle = Math.atan2(next.y - target.y, next.x - target.x);
  const rivalDistance = opponents
    .filter((other) => other.id !== driver.id)
    .reduce((nearest, other) => Math.min(nearest, Math.hypot(other.x - driver.x, other.y - driver.y)), Infinity);
  const passUrgency = clamp((84 - rivalDistance) / 84, 0, 1);
  const passSide = Number.parseInt(driver.id.match(/\d+/)?.[0] ?? '0', 10) % 2 === 0 ? 1 : -1;
  // Presets predate the explicit overtake tuning field, so risk is the
  // deterministic fallback for how aggressively a driver changes its line.
  const passOffset = passSide * (strategy.overtake ?? strategy.risk) * passUrgency * 10;
  // Presets need a meaningful spread across a crowded 20-car field. A tiny
  // visual-scale offset keeps everyone on one line and creates persistent
  // pileups; this changes only the policy's chosen line, not collision physics.
  const lateralBias = strategy.laneBias * 75 + passOffset;
  const lineXWithBias = target.x - Math.sin(segmentAngle) * lateralBias;
  const lineYWithBias = target.y + Math.cos(segmentAngle) * lateralBias;
  const desired = Math.atan2(lineYWithBias - driver.y, lineXWithBias - driver.x);
  const delta = angleDelta(driver.heading, desired);
  const cornerLoad = Math.abs(delta);
  const distanceToTarget = Math.hypot(target.x - driver.x, target.y - driver.y);
  const cornerPenalty = Math.max(0, cornerLoad - 0.24) * (1.25 - strategy.risk) * strategy.braking;
  const lookaheadPenalty = Math.max(0, (190 - distanceToTarget) / 190) * strategy.lookahead * (0.5 + cornerLoad);
  const speedTarget = clamp(PHYSICS.maxSpeed * strategy.pace - cornerPenalty * 1.5 - lookaheadPenalty, 1.2, PHYSICS.maxSpeed * 1.12);
  const throttle = driver.speed < speedTarget
    ? clamp(strategy.acceleration * (1 + strategy.risk * 0.18), 0.25, 1)
    : -clamp(strategy.braking * cornerLoad * 0.52, 0.08, 1);
  return {
    steering: clamp((delta * strategy.cornering) / 0.42, -1, 1),
    throttle,
  };
}

function crossCheckpoint(driver, oldX, oldY) {
  const checkpoint = TRACK[driver.nextCheckpoint];
  const before = Math.hypot(checkpoint.x - oldX, checkpoint.y - oldY);
  const after = Math.hypot(checkpoint.x - driver.x, checkpoint.y - driver.y);
  if (after < 30 && after < before) {
    driver.nextCheckpoint = (driver.nextCheckpoint + 1) % TRACK.length;
    if (driver.nextCheckpoint === 0) driver.lap += 1;
  }
}

function publicDriver(driver) {
  const { skill, policyState, ...visible } = driver;
  return { ...visible, heading: Number(visible.heading.toFixed(4)), speed: Number(visible.speed.toFixed(3)) };
}

/** Resolve each unordered car pair once in stable array order after movement. */
function resolveCollisions(drivers, tick, events) {
  const active = drivers.filter((driver) => !driver.finished);
  const diameter = PHYSICS.collisionRadius * 2;
  for (let i = 0; i < active.length; i += 1) {
    const a = active[i];
    for (let j = i + 1; j < active.length; j += 1) {
      const b = active[j];
      let dx = b.x - a.x;
      let dy = b.y - a.y;
      let distance = Math.hypot(dx, dy);
      if (distance >= diameter) continue;

      // Coincident centers get a deterministic separating axis, never NaN.
      if (distance < 1e-9) {
        const angle = ((i + 1) * 17 + (j + 1) * 31) * 0.61803398875;
        dx = Math.cos(angle);
        dy = Math.sin(angle);
        distance = 1;
      }
      const nx = dx / distance;
      const ny = dy / distance;
      const overlap = diameter - Math.hypot(b.x - a.x, b.y - a.y);
      const correction = overlap / 2 + 0.001;
      a.x -= nx * correction;
      a.y -= ny * correction;
      b.x += nx * correction;
      b.y += ny * correction;

      // Keep the correction inside the arena; wall contacts slow and count as faults.
      for (const driver of [a, b]) {
        const x = clamp(driver.x, ARENA.margin, ARENA.width - ARENA.margin);
        const y = clamp(driver.y, ARENA.margin, ARENA.height - ARENA.margin);
        if (x !== driver.x || y !== driver.y) driver.faults += 1;
        driver.x = x;
        driver.y = y;
        driver.speed *= 0.78;
        driver.faults += 1;
      }
      events.push({
        tick,
        type: 'collision',
        driverIds: [a.id, b.id],
        overlap: Number(overlap.toFixed(3)),
      });
    }
  }
}

/** Create a JSON-safe initial race state. */
export function createRace({ seed = 1, laps = DEFAULT_LAPS, drivers } = {}) {
  const validLaps = Math.max(1, Math.floor(Number(laps) || DEFAULT_LAPS));
  const entries = makeDrivers(seed, drivers);
  const ids = new Set(entries.map((driver) => driver.id));
  if (ids.size !== DRIVER_COUNT) throw new Error('Driver ids must be unique');
  return {
    seed: Number(seed) >>> 0,
    laps: validLaps,
    tick: 0,
    status: 'running',
    drivers: entries,
    events: [{ tick: 0, type: 'race-start', driverCount: DRIVER_COUNT, teamCount: TEAM_COUNT }],
    history: [],
    results: [],
  };
}

/** Advance one deterministic fixed-duration simulation tick. */
export function stepRace(race, policy = racingPolicy) {
  if (race.status !== 'running') return race;
  race.tick += 1;
  const events = [];
  const previousPositions = new Map();
  for (const driver of race.drivers) {
    if (driver.finished) continue;
    const target = TRACK[driver.nextCheckpoint];
    let controls;
    try {
      const opponents = race.drivers.map((other) => publicDriver(other));
      controls = policy(publicDriver(driver), { ...target }, race.tick, opponents) ?? {};
    } catch {
      controls = {};
      driver.faults += 1;
    }
    const steering = clamp(controls.steering, -1, 1);
    const throttle = clamp(controls.throttle, -1, 1);
    const oldX = driver.x;
    const oldY = driver.y;
    previousPositions.set(driver.id, { x: oldX, y: oldY });
    driver.heading += steering * PHYSICS.turnRate * (0.35 + driver.speed / PHYSICS.maxSpeed);
    if (throttle >= 0) driver.speed += throttle * PHYSICS.acceleration * driver.skill;
    else driver.speed += throttle * PHYSICS.braking;
    driver.speed = clamp(driver.speed * PHYSICS.drag, 0, PHYSICS.maxSpeed * driver.skill);
    driver.x += Math.cos(driver.heading) * driver.speed;
    driver.y += Math.sin(driver.heading) * driver.speed;

    // Arena boundary is a safe deterministic slowdown, not an instant teleport.
    const min = ARENA.margin;
    const maxX = ARENA.width - min;
    const maxY = ARENA.height - min;
    if (driver.x < min || driver.x > maxX || driver.y < min || driver.y > maxY) {
      driver.x = clamp(driver.x, min, maxX);
      driver.y = clamp(driver.y, min, maxY);
      driver.speed *= 0.35;
      driver.faults += 1;
    }
  }

  resolveCollisions(race.drivers, race.tick, events);
  for (const driver of race.drivers) {
    if (driver.finished) continue;
    const previous = previousPositions.get(driver.id);
    if (previous) crossCheckpoint(driver, previous.x, previous.y);
    driver.progress = driver.lap * TRACK.length + driver.nextCheckpoint;
    if (driver.lap >= race.laps) {
      driver.finished = true;
      driver.finishTick = race.tick;
      events.push({ tick: race.tick, type: 'driver-finished', driverId: driver.id });
    }
  }

  // Stable rank order; driver ID is the final tie-breaker.
  const order = [...race.drivers].sort((a, b) =>
    Number(b.finished) - Number(a.finished)
      || (a.finished && b.finished ? a.finishTick - b.finishTick : b.progress - a.progress)
      || b.speed - a.speed
      || a.id.localeCompare(b.id));
  order.forEach((driver, index) => { driver.place = index + 1; });
  race.events.push(...events);
  race.history.push({
    tick: race.tick,
    drivers: order.map((driver) => ({ id: driver.id, x: Number(driver.x.toFixed(2)), y: Number(driver.y.toFixed(2)), heading: Number(driver.heading.toFixed(3)), speed: Number(driver.speed.toFixed(2)), lap: driver.lap, place: driver.place })),
  });
  if (race.drivers.every((driver) => driver.finished) || race.tick >= MAX_TICKS) {
    race.status = 'finished';
    race.results = order.map((driver, index) => ({
      place: index + 1,
      driverId: driver.id,
      driverName: driver.name,
      teamId: driver.teamId,
      laps: driver.lap,
      finishTick: driver.finishTick,
      faults: driver.faults,
      points: Math.max(0, DRIVER_COUNT - index),
    }));
    race.events.push({ tick: race.tick, type: 'race-finished', results: race.results });
  }
  return race;
}

/** Run to completion; maxTicks can cap work for a caller-controlled budget. */
export function runRace(options = {}) {
  const race = createRace(options);
  const limit = Math.min(MAX_TICKS, Math.max(1, options.maxTicks ?? MAX_TICKS));
  while (race.status === 'running' && race.tick < limit) stepRace(race, options.policy ?? racingPolicy);
  if (race.status === 'running') {
    race.status = 'finished';
    const order = [...race.drivers].sort((a, b) => b.progress - a.progress || b.speed - a.speed || a.id.localeCompare(b.id));
    race.results = order.map((driver, index) => ({ place: index + 1, driverId: driver.id, driverName: driver.name, teamId: driver.teamId, laps: driver.lap, finishTick: driver.finishTick, faults: driver.faults, points: Math.max(0, DRIVER_COUNT - index) }));
    race.events.push({ tick: race.tick, type: 'race-finished', results: race.results, reason: 'tick-limit' });
  }
  return race;
}

export function getTrack() {
  return TRACK.map((point) => ({ ...point }));
}
