export type UpgradeId = "engine" | "aerodynamics" | "tires" | "weight";
export type TeamId = string;
export interface EconomyState { readonly credits: number; readonly upgrades: Readonly<Record<UpgradeId, number>> }
export interface LeagueEconomy { readonly teams: Readonly<Record<TeamId, EconomyState>> }
export const UPGRADES: Readonly<Record<UpgradeId, Readonly<{ label: string; baseCost: number; effectPerLevel: number }>>>;
export function createLeagueEconomy(options?: { teamIds?: readonly TeamId[]; initialCredits?: number }): LeagueEconomy;
export function purchaseTeamUpgrade(league: LeagueEconomy, teamId: TeamId, upgradeId: string): { ok: boolean; cost?: number; error?: string; league: LeagueEconomy };
export function awardRaceResult(league: LeagueEconomy, result: { place: number; teamId: TeamId; points?: number }): { reward: number; league: LeagueEconomy };
export function getUpgradeEffects(state: EconomyState): Readonly<{
  enginePowerMultiplier: number;
  aerodynamicsMultiplier: number;
  tireGripMultiplier: number;
  weightMultiplier: number;
}>;
