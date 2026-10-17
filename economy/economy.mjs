/**
 * GRID PRIX's in-game team economy. This module is deliberately pure and
 * local-only: credits are demo game state, not Stripe money or payments.
 */

export const INITIAL_CREDITS = 1_000;
export const MAX_UPGRADE_LEVEL = 5;
export const DEFAULT_TEAM_IDS = Object.freeze(Array.from(
  { length: 10 },
  (_, index) => `team-${String(index + 1).padStart(2, '0')}`,
));

export const UPGRADES = Object.freeze({
  engine: Object.freeze({ label: 'Engine', baseCost: 250, effectPerLevel: 0.04 }),
  aerodynamics: Object.freeze({ label: 'Aerodynamics', baseCost: 225, effectPerLevel: 0.03 }),
  tires: Object.freeze({ label: 'Tires', baseCost: 200, effectPerLevel: 0.05 }),
  weight: Object.freeze({ label: 'Weight', baseCost: 275, effectPerLevel: 0.025 }),
});

const copyLevels = (levels = {}) => Object.fromEntries(
  Object.keys(UPGRADES).map((id) => [id, levels[id] ?? 0]),
);

export function createEconomy({ credits = INITIAL_CREDITS, upgrades = {} } = {}) {
  if (!Number.isSafeInteger(credits) || credits < 0) {
    throw new RangeError('credits must be a non-negative safe integer');
  }
  const unknownUpgrade = Object.keys(upgrades).find((id) => !Object.hasOwn(UPGRADES, id));
  if (unknownUpgrade) throw new RangeError(`unknown upgrade: ${unknownUpgrade}`);
  const levels = copyLevels(upgrades);
  for (const [id, level] of Object.entries(levels)) {
    if (!Number.isSafeInteger(level) || level < 0 || level > MAX_UPGRADE_LEVEL) {
      throw new RangeError(`${id} level must be an integer from 0 to ${MAX_UPGRADE_LEVEL}`);
    }
  }
  return Object.freeze({ credits, upgrades: Object.freeze(levels) });
}

/** Cost rises by 50% per purchased level (rounded up to whole credits). */
export function upgradeCost(upgradeId, currentLevel) {
  const upgrade = UPGRADES[upgradeId];
  if (!upgrade) throw new RangeError(`unknown upgrade: ${upgradeId}`);
  if (!Number.isSafeInteger(currentLevel) || currentLevel < 0 || currentLevel > MAX_UPGRADE_LEVEL) {
    throw new RangeError('currentLevel is out of range');
  }
  return Math.ceil(upgrade.baseCost * (1 + currentLevel * 0.5));
}

/** Returns a new state on success; failures leave the input untouched. */
export function purchaseUpgrade(state, upgradeId) {
  const level = state.upgrades[upgradeId];
  if (level === undefined) return { ok: false, error: 'unknown_upgrade', state };
  if (level >= MAX_UPGRADE_LEVEL) return { ok: false, error: 'max_level', state };

  const cost = upgradeCost(upgradeId, level);
  if (state.credits < cost) return { ok: false, error: 'insufficient_credits', state, cost };

  const nextUpgrades = { ...state.upgrades, [upgradeId]: level + 1 };
  return {
    ok: true,
    cost,
    state: createEconomy({ credits: state.credits - cost, upgrades: nextUpgrades }),
  };
}

/**
 * Award deterministic demo credits for a race finish. Every finisher receives
 * 100 credits; the top three earn a placement bonus. Inputs are validated so
 * untrusted UI/API values cannot inject negative or fractional currency.
 */
export function awardRaceCredits(state, { placement, cleanLaps = 0 } = {}) {
  if (!Number.isSafeInteger(placement) || placement < 1) {
    throw new RangeError('placement must be a positive integer');
  }
  if (!Number.isSafeInteger(cleanLaps) || cleanLaps < 0) {
    throw new RangeError('cleanLaps must be a non-negative integer');
  }
  const placementBonus = ({ 1: 300, 2: 200, 3: 100 })[placement] ?? 0;
  const reward = 100 + placementBonus + cleanLaps * 10;
  return { reward, state: createEconomy({ credits: state.credits + reward, upgrades: state.upgrades }) };
}

/** Multipliers are intended as a stable integration seam for the race engine. */
export function getUpgradeEffects(state) {
  return Object.freeze({
    enginePowerMultiplier: 1 + state.upgrades.engine * UPGRADES.engine.effectPerLevel,
    aerodynamicsMultiplier: 1 + state.upgrades.aerodynamics * UPGRADES.aerodynamics.effectPerLevel,
    tireGripMultiplier: 1 + state.upgrades.tires * UPGRADES.tires.effectPerLevel,
    weightMultiplier: 1 - state.upgrades.weight * UPGRADES.weight.effectPerLevel,
  });
}

/** Build a local ledger for the stable GRID PRIX team IDs. */
export function createLeagueEconomy({ teamIds = DEFAULT_TEAM_IDS, initialCredits = INITIAL_CREDITS } = {}) {
  if (!Array.isArray(teamIds) || teamIds.length === 0 || teamIds.some((id) => typeof id !== 'string' || !id.trim())) {
    throw new RangeError('teamIds must be a non-empty array of non-empty strings');
  }
  if (new Set(teamIds).size !== teamIds.length) throw new RangeError('teamIds must be unique');
  const teams = Object.fromEntries(teamIds.map((id) => [id, createEconomy({ credits: initialCredits })]));
  return Object.freeze({ teams: Object.freeze(teams) });
}

/** Purchase an upgrade from one team's bank without changing other teams. */
export function purchaseTeamUpgrade(league, teamId, upgradeId) {
  const team = league.teams[teamId];
  if (!team) return { ok: false, error: 'unknown_team', league };
  const result = purchaseUpgrade(team, upgradeId);
  if (!result.ok) return { ...result, league };
  return {
    ok: true,
    cost: result.cost,
    league: Object.freeze({
      teams: Object.freeze({ ...league.teams, [teamId]: result.state }),
    }),
  };
}

/**
 * Award the worker-1 simulation's race.results item directly. Placement pays
 * the normal podium reward; published race points are added one-for-one.
 */
export function awardRaceResult(league, result) {
  if (!result || typeof result.teamId !== 'string' || !league.teams[result.teamId]) {
    throw new RangeError('result.teamId must identify a known team');
  }
  if (!Number.isSafeInteger(result.place) || result.place < 1) {
    throw new RangeError('result.place must be a positive integer');
  }
  const points = result.points ?? 0;
  if (!Number.isSafeInteger(points) || points < 0) {
    throw new RangeError('result.points must be a non-negative integer');
  }
  const { reward, state } = awardRaceCredits(league.teams[result.teamId], {
    placement: result.place,
  });
  const totalReward = reward + points;
  return {
    reward: totalReward,
    league: Object.freeze({
      teams: Object.freeze({
        ...league.teams,
        [result.teamId]: createEconomy({ credits: state.credits + points, upgrades: state.upgrades }),
      }),
    }),
  };
}
