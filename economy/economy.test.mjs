import test from 'node:test';
import assert from 'node:assert/strict';
import {
  UPGRADES,
  MAX_UPGRADE_LEVEL,
  awardRaceCredits,
  awardRaceResult,
  createLeagueEconomy,
  createEconomy,
  getUpgradeEffects,
  purchaseUpgrade,
  purchaseTeamUpgrade,
  upgradeCost,
} from './economy.mjs';

test('starts each team with a fresh, immutable budget and zero upgrades', () => {
  const state = createEconomy();
  assert.equal(state.credits, 1_000);
  assert.deepEqual(state.upgrades, { engine: 0, aerodynamics: 0, tires: 0, weight: 0 });
  assert.equal(Object.isFrozen(state), true);
  assert.equal(Object.isFrozen(state.upgrades), true);
});

test('exposes exactly the required four upgrade categories', () => {
  assert.deepEqual(Object.keys(UPGRADES), ['engine', 'aerodynamics', 'tires', 'weight']);
  assert.deepEqual(Object.values(UPGRADES).map(({ label }) => label), [
    'Engine', 'Aerodynamics', 'Tires', 'Weight',
  ]);
});

test('upgrade purchases debit the escalating cost and do not mutate prior state', () => {
  const initial = createEconomy();
  const first = purchaseUpgrade(initial, 'engine');
  assert.deepEqual(first, {
    ok: true,
    cost: 250,
    state: createEconomy({ credits: 750, upgrades: { engine: 1 } }),
  });
  const second = purchaseUpgrade(first.state, 'engine');
  assert.equal(second.cost, 375);
  assert.equal(second.state.credits, 375);
  assert.equal(initial.credits, 1_000);
  assert.equal(initial.upgrades.engine, 0);
});

test('rejects unaffordable, unknown, and max-level purchases without state changes', () => {
  const poor = createEconomy({ credits: 10 });
  assert.equal(purchaseUpgrade(poor, 'tires').error, 'insufficient_credits');
  assert.equal(purchaseUpgrade(poor, 'warp').error, 'unknown_upgrade');
  const maxed = createEconomy({ upgrades: { weight: MAX_UPGRADE_LEVEL } });
  assert.equal(purchaseUpgrade(maxed, 'weight').error, 'max_level');
  assert.equal(maxed.credits, 1_000);
});

test('race rewards are deterministic and add placement and clean-lap bonuses', () => {
  const state = createEconomy({ credits: 500 });
  const winner = awardRaceCredits(state, { placement: 1, cleanLaps: 3 });
  assert.equal(winner.reward, 430);
  assert.equal(winner.state.credits, 930);
  assert.equal(state.credits, 500);
  assert.equal(awardRaceCredits(state, { placement: 4 }).reward, 100);
});

test('upgrade effects provide stable multipliers for engine integration', () => {
  const state = createEconomy({ upgrades: { engine: 2, aerodynamics: 1, tires: 3, weight: 2 } });
  assert.deepEqual(getUpgradeEffects(state), {
    enginePowerMultiplier: 1.08,
    aerodynamicsMultiplier: 1.03,
    tireGripMultiplier: 1.15,
    weightMultiplier: 0.95,
  });
});

test('validates currency, levels, placements, and lap counts', () => {
  assert.throws(() => createEconomy({ credits: -1 }), /credits/);
  assert.throws(() => createEconomy({ upgrades: { engine: 1.5 } }), /level/);
  assert.throws(() => createEconomy({ upgrades: { handling: 1 } }), /unknown upgrade/);
  assert.throws(() => createEconomy({ upgrades: { shield: 1 } }), /unknown upgrade/);
  assert.throws(() => upgradeCost('engine', MAX_UPGRADE_LEVEL + 1), /currentLevel/);
  assert.throws(() => awardRaceCredits(createEconomy(), { placement: 0 }), /placement/);
  assert.throws(() => awardRaceCredits(createEconomy(), { placement: 1, cleanLaps: -1 }), /cleanLaps/);
});

test('creates a ten-team budget ledger and purchases only from the selected team', () => {
  const league = createLeagueEconomy();
  assert.equal(Object.keys(league.teams).length, 10);
  assert.equal(league.teams['team-01'].credits, 1_000);
  const result = purchaseTeamUpgrade(league, 'team-01', 'aerodynamics');
  assert.equal(result.ok, true);
  assert.equal(result.league.teams['team-01'].credits, 775);
  assert.equal(result.league.teams['team-01'].upgrades.aerodynamics, 1);
  assert.equal(result.league.teams['team-02'].credits, 1_000);
  assert.equal(league.teams['team-01'].credits, 1_000);
  assert.equal(purchaseTeamUpgrade(league, 'missing', 'engine').error, 'unknown_team');
});

test('race result adapter consumes simulation place/teamId/points contract', () => {
  const league = createLeagueEconomy();
  const award = awardRaceResult(league, {
    place: 1,
    teamId: 'team-03',
    driverId: 'driver-7',
    driverName: 'Neon Fox',
    laps: 12,
    finishTick: 420,
    faults: 0,
    points: 50,
  });
  assert.equal(award.reward, 450);
  assert.equal(award.league.teams['team-03'].credits, 1_450);
  assert.equal(award.league.teams['team-01'].credits, 1_000);
  assert.throws(() => awardRaceResult(league, { place: 1, teamId: 'unknown' }), /teamId/);
});
