import { StrictMode, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { UpgradeId } from "../economy/economy.mjs";
import { awardRaceResult, createLeagueEconomy, purchaseTeamUpgrade, UPGRADES } from "../economy/economy.mjs";
import { App } from "./ui/App";
import { useRaceController } from "./ui/useRaceController";
import type { EvolutionView, TeamView } from "./ui/types";

const TEAM_COLORS = ["#00f5d4", "#f15bb5", "#fee440", "#00bbf9", "#9b5de5", "#fb5607", "#80ed99", "#ff006e", "#3a86ff", "#caffbf"];
const TEAM_NAMES = ["NEON APEX", "VOLT RACING", "PHOTON GP", "NIGHTSHIFT", "VECTOR LABS", "GHOSTLINE", "PULSEWORKS", "CHROME UNION", "AFTERBURN", "SPECTRUM"];

function Championship() {
  const { race, start, pause, reset, step } = useRaceController(2026, 3);
  const [evolution, setEvolution] = useState<EvolutionView>({
    available: false,
    status: "idle",
    generation: 0,
    summary: "Configure the LLM and CreateOS sandbox credentials to enable real policy evolution.",
    log: [],
  });
  const [league, setLeague] = useState(createLeagueEconomy());
  const [championshipPoints, setChampionshipPoints] = useState<Record<string, number>>({});
  const paidOut = useRef<number>();

  useEffect(() => {
    let active = true;
    fetch("/api/evolve/status")
      .then((response) => response.ok ? response.json() : Promise.reject(new Error(`Evolution API status ${response.status}`)))
      .then((status) => {
        if (active) setEvolution((current) => ({
          ...current,
          available: status.available === true,
          summary: status.message ?? (status.available ? "LLM + CreateOS Sandbox ready" : "Real LLM and CreateOS credentials are required."),
        }));
      })
      .catch(() => {
        if (active) setEvolution((current) => ({ ...current, available: false, summary: "Start the local evolution service and configure LLM + CreateOS credentials." }));
      });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (race.status !== "finished" || paidOut.current === race.seed) return;
    paidOut.current = race.seed;
    const ordered = [...race.drivers].sort((a, b) => a.place - b.place);
    setLeague((current) => ordered.reduce((next, driver, index) => awardRaceResult(next, {
      place: index + 1,
      teamId: driver.team,
      points: Math.max(0, 20 - index),
    }).league, current));
    setChampionshipPoints((current) => ordered.reduce((next, driver, index) => {
      const points = Math.max(0, 20 - index);
      return { ...next, [driver.team]: (next[driver.team] ?? 0) + points };
    }, current));
  }, [race]);

  const teams: TeamView[] = Object.entries(league.teams).map(([, state], index) => ({
    name: TEAM_NAMES[index],
    color: TEAM_COLORS[index],
    points: championshipPoints[`team-${String(index + 1).padStart(2, "0")}`] ?? 0,
    budget: state.credits,
    upgrades: Object.entries(state.upgrades).flatMap(([key, level]) => level ? [`${UPGRADES[key as UpgradeId].label} Lv ${level}`] : []),
    upgradeIds: Object.entries(state.upgrades).flatMap(([key, level]) => level < 5 ? [key] : []),
  }));

  const evolve = async () => {
    if (!evolution.available) return;
    setEvolution((current) => ({ ...current, status: "running", summary: "Submitting telemetry for agent analysis…", log: [...current.log, "Evolution request started"] }));
    try {
      const response = await fetch("/api/evolve", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ seed: race.seed, race: race.drivers, telemetry: race.history.slice(-120) }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? `Evolution service responded ${response.status}`);
      setEvolution(result);
    } catch (error) {
      setEvolution((current) => ({
        ...current,
        available: false,
        status: "error",
        summary: error instanceof Error ? error.message : "Evolution service unavailable",
        log: [...current.log, "No candidate accepted; current policies unchanged"],
      }));
    }
  };

  const upgrade = (teamName: string, upgradeId: string) => {
    const index = TEAM_NAMES.indexOf(teamName);
    if (index < 0 || !(upgradeId in UPGRADES)) return;
    const result = purchaseTeamUpgrade(league, `team-${String(index + 1).padStart(2, "0")}`, upgradeId as UpgradeId);
    if (result.ok) setLeague(result.league);
  };

  return <App race={race} evolution={evolution} teams={teams} onStart={start} onPause={pause} onReset={reset} onStep={step} onEvolve={evolve} onUpgrade={upgrade} />;
}

createRoot(document.getElementById("root")!).render(<StrictMode><Championship /></StrictMode>);
