export type UpgradeId = 'engine' | 'aerodynamics' | 'tires' | 'weight';
export type TeamId = string;
export type EconomyState = Readonly<{
  credits: number;
  upgrades: Readonly<Record<UpgradeId, number>>;
}>;
export const INITIAL_CREDITS: number;
export const MAX_UPGRADE_LEVEL: number;
export const DEFAULT_TEAM_IDS: readonly TeamId[];
export const UPGRADES: Readonly<Record<UpgradeId, Readonly<{
  label: string;
  baseCost: number;
  effectPerLevel: number;
}>>>;
export function createEconomy(options?: { credits?: number; upgrades?: Partial<Record<UpgradeId, number>> }): EconomyState;
export function upgradeCost(upgradeId: UpgradeId, currentLevel: number): number;
export function purchaseUpgrade(state: EconomyState, upgradeId: UpgradeId):
  | { ok: true; cost: number; state: EconomyState }
  | { ok: false; error: 'unknown_upgrade' | 'max_level' | 'insufficient_credits'; state: EconomyState; cost?: number };
export function awardRaceCredits(state: EconomyState, result: { placement: number; cleanLaps?: number }):
  { reward: number; state: EconomyState };
export function getUpgradeEffects(state: EconomyState): Readonly<{
  enginePowerMultiplier: number;
  aerodynamicsMultiplier: number;
  tireGripMultiplier: number;
  weightMultiplier: number;
}>;
export type LeagueEconomy = Readonly<{ teams: Readonly<Record<TeamId, EconomyState>> }>;
export function createLeagueEconomy(options?: { teamIds?: readonly TeamId[]; initialCredits?: number }): LeagueEconomy;
export function purchaseTeamUpgrade(league: LeagueEconomy, teamId: TeamId, upgradeId: string):
  | { ok: true; cost: number; league: LeagueEconomy }
  | { ok: false; error: 'unknown_team' | 'unknown_upgrade' | 'max_level' | 'insufficient_credits'; state?: EconomyState; cost?: number; league: LeagueEconomy };
export function awardRaceResult(league: LeagueEconomy, result: {
  place: number;
  teamId: TeamId;
  driverId?: string;
  driverName?: string;
  laps?: number;
  finishTick?: number;
  faults?: number;
  points?: number;
}): { reward: number; league: LeagueEconomy };
