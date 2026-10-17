import test from 'node:test';
import assert from 'node:assert/strict';
import { createRace, getTrack, runRace, stepRace, DRIVER_COUNT, TEAM_COUNT, ARENA, PHYSICS, DRIVER_STRATEGIES, racingPolicy } from '../../src/simulation/index.mjs';

test('race creates twenty unique drivers across ten stable teams', () => {
  const race = createRace({ seed: 42 });
  assert.equal(race.drivers.length, DRIVER_COUNT);
  assert.equal(new Set(race.drivers.map((driver) => driver.id)).size, DRIVER_COUNT);
  assert.equal(new Set(race.drivers.map((driver) => driver.teamId)).size, TEAM_COUNT);
  assert.equal(race.status, 'running');
  assert.equal(race.tick, 0);
});

test('same seed and policy produce byte-identical race output', () => {
  const first = runRace({ seed: 817 });
  const second = runRace({ seed: 817 });
  assert.deepEqual(first, second);
  assert.equal(first.status, 'finished');
  assert.equal(first.results.length, DRIVER_COUNT);
  assert.deepEqual(first.results.map((result) => result.place), Array.from({ length: DRIVER_COUNT }, (_, i) => i + 1));
});

test('seed 2026 completes all laps with deterministic collisions active', () => {
  const first = runRace({ seed: 2026 });
  const second = runRace({ seed: 2026 });
  assert.equal(first.status, 'finished');
  assert.equal(first.results.length, DRIVER_COUNT);
  assert.ok(first.results.every((result) => result.finishTick !== null && result.laps === first.laps));
  assert.ok(first.events.some((event) => event.type === 'collision'), 'collision response remains enabled');
  assert.deepEqual(first.results, second.results);
});

test('physics clamps controls, speed, and arena bounds', () => {
  const race = createRace({ seed: 1 });
  const first = race.drivers[0];
  const before = first.x;
  for (let i = 0; i < 300; i += 1) stepRace(race, () => ({ steering: 0, throttle: 900 }));
  assert.ok(first.x >= ARENA.margin && first.x <= ARENA.width - ARENA.margin);
  assert.ok(first.y >= ARENA.margin && first.y <= ARENA.height - ARENA.margin);
  assert.ok(first.speed <= PHYSICS.maxSpeed * first.skill);
  assert.notEqual(first.x, before);
  assert.ok(first.faults > 0, 'boundary contact is recorded');
});

test('policy errors degrade to deterministic coasting and are counted', () => {
  const race = createRace({ seed: 5, laps: 99 });
  stepRace(race, () => { throw new Error('policy unavailable'); });
  assert.ok(race.drivers.every((driver) => driver.faults === 1));
  assert.ok(race.drivers.every((driver) => driver.speed === 0));
});

test('track points are returned as safe copies', () => {
  const points = getTrack();
  points[0].x = -1;
  assert.notEqual(getTrack()[0].x, -1);
  assert.equal(points.length, 8);
});

test('driver specs select 20 distinct deterministic executable strategies', () => {
  const first = createRace({ seed: 77 });
  const second = createRace({ seed: 77 });
  const strategyIds = first.drivers.map((driver) => driver.strategyId);
  assert.equal(new Set(strategyIds).size, DRIVER_COUNT);
  assert.deepEqual(strategyIds, DRIVER_STRATEGIES.map((strategy) => strategy.id));
  assert.deepEqual(first.drivers.map((driver) => driver.strategy), second.drivers.map((driver) => driver.strategy));

  const rival = { id: 'rival', x: first.drivers[0].x + 20, y: first.drivers[0].y };
  const controls = first.drivers.map((driver) => racingPolicy(driver, { x: 920, y: 148 }, 1, [rival]));
  const repeatControls = second.drivers.map((driver) => racingPolicy(driver, { x: 920, y: 148 }, 1, [rival]));
  assert.ok(controls.every((control) => Number.isFinite(control.steering) && Number.isFinite(control.throttle)));
  assert.ok(controls.some((control) => control.steering !== 0), 'strategy steering remains active near rivals');
  assert.ok(new Set(controls.map((control) => JSON.stringify(control))).size > 1);
  assert.deepEqual(controls, repeatControls);
  const selected = createRace({ seed: 77, drivers: [{ strategyId: 'rocket' }] });
  assert.equal(selected.drivers[0].strategyId, 'rocket');
  assert.deepEqual(selected.drivers[0].strategy, DRIVER_STRATEGIES.find((strategy) => strategy.id === 'rocket'));
});

test('collision response resolves each pair once, separates cars, slows them, and records faults', () => {
  const race = createRace({ seed: 12, laps: 99 });
  const [a, b] = race.drivers;
  a.x = b.x = 500;
  a.y = b.y = 400;
  a.speed = b.speed = 0;
  stepRace(race, () => ({ steering: 0, throttle: 0 }));

  const collisions = race.events.filter((event) => event.type === 'collision');
  assert.equal(collisions.length, 1, 'unordered pair is processed once');
  assert.deepEqual(collisions[0].driverIds, [a.id, b.id]);
  assert.ok(Math.hypot(a.x - b.x, a.y - b.y) >= PHYSICS.collisionRadius * 2);
  assert.equal(a.faults, 1);
  assert.equal(b.faults, 1);
  assert.equal(a.speed, 0);
  assert.equal(b.speed, 0);
});

test('collision resolution is deterministic for coincident drivers', () => {
  const makeCollision = () => {
    const race = createRace({ seed: 99, laps: 99 });
    race.drivers[0].x = race.drivers[1].x = 600;
    race.drivers[0].y = race.drivers[1].y = 380;
    stepRace(race, () => ({ steering: 0, throttle: 0 }));
    return race;
  };
  assert.deepEqual(makeCollision(), makeCollision());
});
