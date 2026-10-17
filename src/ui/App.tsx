import { useMemo, useState } from "react";
import { RaceCanvas } from "./RaceCanvas";
import type { DriverView, EvolutionAgentView, EvolutionView, InferenceUsage, RaceView, TeamView } from "./types";
import "./app.css";

export interface AppProps {
  race: RaceView;
  evolution: EvolutionView;
  teams: TeamView[];
  onStart: () => void;
  onPause: () => void;
  onReset: () => void;
  onStep?: () => void;
  onReplayTick?: (tick: number) => void;
  onEvolve?: () => void;
  onUpgrade?: (team: string, upgrade: string) => void;
}

const number = new Intl.NumberFormat("en-US");

export function App({
  race,
  evolution,
  teams,
  onStart,
  onPause,
  onReset,
  onStep,
  onReplayTick,
  onEvolve,
  onUpgrade,
}: AppProps) {
  const [selectedDriverId, setSelectedDriverId] = useState<string>();
  const [selectedEvolutionAgentId, setSelectedEvolutionAgentId] = useState<string>();
  const [selectedRevision, setSelectedRevision] = useState("current");
  const [replayFrameIndex, setReplayFrameIndex] = useState<number>();
  const frame = replayFrameIndex == null ? undefined : race.history[replayFrameIndex];
  const visibleDrivers = frame?.drivers ?? race.drivers;
  const orderedDrivers = useMemo(
    () => [...visibleDrivers].sort((left, right) => left.place - right.place),
    [visibleDrivers],
  );
  const selectedDriver = visibleDrivers.find((driver) => driver.id === selectedDriverId);
  const running = race.status === "running";
  const inReplay = frame != null;
  const frameLap = frame ? Math.max(0, ...frame.drivers.map((driver) => driver.lap)) : race.lap;
  const raceStateLabel = inReplay ? "RACE REPLAY" : race.status === "running" ? "RACE IN PROGRESS" : race.status === "paused" ? "RACE PAUSED" : race.status === "finished" ? "RACE FINISHED" : "RACE ENGINE READY";
  const trackStateLabel = inReplay ? "REPLAY" : race.status === "running" ? "LIVE" : race.status === "paused" ? "PAUSED" : race.status === "finished" ? "FINISHED" : "STANDBY";
  const classificationLabel = inReplay ? "REPLAY CLASSIFICATION" : running ? "LIVE CLASSIFICATION" : race.status === "ready" ? "STANDBY CLASSIFICATION" : race.status === "paused" ? "PAUSED CLASSIFICATION" : "FINAL CLASSIFICATION";
  const timingLabel = inReplay ? "REPLAY TIMING" : running ? "LIVE TIMING" : race.status === "ready" ? "TIMING STANDBY" : race.status === "paused" ? "TIMING PAUSED" : "FINAL TIMING";
  const positionLabel = inReplay ? "REPLAY POSITIONS" : running ? "POSITION UPDATES EVERY TICK" : race.status === "ready" ? "GRID ORDER · STANDBY" : race.status === "paused" ? "POSITIONS PAUSED" : "FINAL CLASSIFICATION";
  const evolutionAvailable = evolution.available === true;
  const evolutionAgents: EvolutionAgentView[] = evolution.agents?.length ? evolution.agents : [{
    driverId: "legacy-policy",
    driverName: "Current policy",
    status: evolution.status,
    candidateName: evolution.candidateName,
    beforeScore: evolution.beforeScore,
    afterScore: evolution.afterScore,
    accepted: evolution.status === "succeeded",
    currentSource: evolution.source,
    history: [],
    usage: undefined,
  }];
  const activeEvolutionAgent = evolutionAgents.find((agent) => agent.driverId === selectedEvolutionAgentId) ?? evolutionAgents[0];
  const activeRevision = selectedRevision === "current" ? undefined : activeEvolutionAgent.history[Number(selectedRevision)];
  const evolutionSource = activeRevision
    ? activeRevision.source
    : activeEvolutionAgent.currentSource ?? (activeEvolutionAgent.driverId === "legacy-policy" ? evolution.source : undefined);
  const evolutionCandidateName = activeRevision
    ? activeRevision.name ?? activeRevision.candidateName
    : activeEvolutionAgent.candidateName ?? (activeEvolutionAgent.driverId === "legacy-policy" ? evolution.candidateName : undefined);
  const evolutionAfterScore = activeRevision
    ? activeRevision.validationScore ?? activeRevision.afterScore
    : activeEvolutionAgent.afterScore ?? (activeEvolutionAgent.driverId === "legacy-policy" ? evolution.afterScore : undefined);
  const evolutionBeforeScore = activeRevision
    ? activeRevision.beforeScore
    : activeEvolutionAgent.beforeScore ?? (activeEvolutionAgent.driverId === "legacy-policy" ? evolution.beforeScore : undefined);
  const legacyUsage = !evolution.agents?.length;
  const usages = legacyUsage ? [evolution.usage] : evolutionAgents.map((agent) => agent.usage);
  const usageCount = usages.filter((usage) => usage != null).length;
  const expectedUsageCount = legacyUsage ? 1 : 20;
  const hasCompleteUsage = usages.length === expectedUsageCount
    && usages.every((usage) => usage != null && hasCompleteUsageCounters(usage));
  const totalUsage = hasCompleteUsage ? summarizeUsage(usages) : undefined;

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="#race" aria-label="Grid Prix home">
          <span className="brand-mark">G<span>✳</span></span>
          <span className="brand-word">GRID<span>PRIX</span></span>
        </a>
        <div className="topbar-actions">
          <div className="topbar-right"><span className="connection-indicator" /> {raceStateLabel}</div>
          {running ? <button className="button button-primary topbar-cta" onClick={onPause} type="button"><span className="pause-icon">Ⅱ</span> Pause race</button> : <button className="button button-primary topbar-cta" onClick={onStart} type="button"><span className="play-icon">▶</span> {race.status === "paused" ? "Resume race" : "Start race"}</button>}
        </div>
      </header>

      <section className="page-heading" id="race">
        <div className="hero-copy">
          <h1>GRID<span> PRIX</span></h1>
          <div className="hero-subtitle">AI RACING EVOLUTION</div>
        </div>
        <div className="heading-actions" aria-hidden="true" />
      </section>

      <section className="process-panel" aria-label="Policy evolution process">
        <ol className="process-rail">
          <li><span aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M3 13h5l2-7 4 13 2-6h5" /></svg></span><strong>Telemetry</strong><small>Race data in</small></li>
          <li><span aria-hidden="true"><svg viewBox="0 0 24 24"><path d="m8 7-5 5 5 5M16 7l5 5-5 5M14 5l-4 14" /></svg></span><strong>AI to code</strong><small>Agent writes policy</small></li>
          <li><span aria-hidden="true"><svg viewBox="0 0 24 24"><path d="m8 5 12 7-12 7z" /></svg></span><strong>Sandbox</strong><small>CreateOS execution</small></li>
          <li><span aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M5 19v-6m7 6V8m7 11V4" /></svg></span><strong>Evaluation</strong><small>Held-out tracks</small></li>
        </ol>
      </section>

      <section className="race-layout">
        <div className="main-column">
          <section className="panel track-panel" aria-labelledby="track-title">
            <div className="panel-heading">
              <div><div className="panel-kicker">SEED {race.seed}</div><h2 id="track-title">Neon Circuit</h2></div>
              <span className={`live-tag ${running && !inReplay ? "is-live" : ""}`}><i /> {trackStateLabel}</span>
            </div>
            <RaceCanvas drivers={visibleDrivers} track={race.track} status={inReplay ? "replay" : race.status} tick={frame?.tick ?? race.tick} onSelectDriver={setSelectedDriverId} selectedDriverId={selectedDriverId} />
            <div className="track-footer"><span><i className="legend-dot legend-mint" /> START / FINISH</span><span><i className="legend-dot legend-white" /> {selectedDriver ? `FOCUS: ${selectedDriver.name}` : "CLICK A DRIVER TO INSPECT"}</span><span className="track-seed">LAP {String(frameLap).padStart(2, "0")} / {String(race.totalLaps).padStart(2, "0")}</span><button className="button button-quiet" onClick={onReset} type="button">Reset</button>{onStep && !running && <button className="button button-step" onClick={onStep} type="button" aria-label="Advance one simulation tick">Step</button>}</div>
          </section>

          <section className="panel replay-panel" aria-label="Race replay controls">
            <div className="replay-label"><span className="panel-kicker">RACE REPLAY</span><strong>{number.format(frame?.tick ?? race.tick)} <small>/ {number.format(race.tick)}</small></strong></div>
            <input aria-label="Scrub race replay" type="range" min="0" max={Math.max(0, race.history.length - 1)} value={replayFrameIndex ?? Math.max(0, race.history.length - 1)} onChange={(event) => { const index = Number(event.currentTarget.value); const selected = race.history[index]; if (!selected) return; setReplayFrameIndex(index === race.history.length - 1 ? undefined : index); onReplayTick?.(selected.tick); }} />
            <button type="button" className="replay-live" onClick={() => { setReplayFrameIndex(undefined); onReplayTick?.(race.tick); }}><i /> {inReplay && running ? "LIVE" : "LATEST"}</button>
          </section>

          <section className="panel evolution-panel" aria-labelledby="evolution-title">
            <div className="panel-heading evolution-heading">
              <div><div className="panel-kicker">SANDBOX CODE EVOLUTION</div><h2 id="evolution-title">The pit wall <span className="panel-heading-meta">/ POLICY LAB</span></h2></div>
              <button className="button button-outline" onClick={onEvolve} disabled={!evolutionAvailable || evolution.status === "running"} type="button" title={evolutionAvailable ? undefined : "Sandbox evolution is unavailable until a live integration is connected."}><span>↗</span> {evolution.status === "running" ? "Evolution running" : evolutionAvailable ? "Evolve policy" : "Sandbox unavailable"}</button>
            </div>
            <div className="evolution-grid">
              <div className="evolution-summary">
                <div className={`evolution-state state-${evolution.status}`}><span className="state-orb" /> {!evolutionAvailable ? "SANDBOX NOT CONNECTED" : evolution.status === "running" ? "EVOLUTION REQUEST IN PROGRESS" : evolution.status === "succeeded" ? `${evolution.agents?.filter((agent) => agent.accepted).length ?? 1} POLICIES PROMOTED` : evolution.status === "rejected" ? "CANDIDATES TESTED · BASELINES RETAINED" : evolution.status === "error" ? "EVOLUTION ERROR" : "AWAITING NEXT RUN"}</div>
                <h3>{evolutionCandidateName ?? (activeEvolutionAgent.driverId === "legacy-policy" ? "No candidate selected" : "No candidate generated")}</h3>
                <p>{evolution.summary ?? (evolutionAvailable ? "A candidate policy will appear here after a sandbox-backed evolution run." : "Evolution stays disabled until a credential-backed sandbox integration is connected.")}</p>
                <div className="generation-line"><span>GENERATION</span><b>{String(evolution.generation).padStart(2, "0")}</b><span className="generation-rule" /></div>
              </div>
              <div className="evolution-agent-workspace">
                <div className="evolution-selectors">
                  <label>DRIVER POLICY
                    <select aria-label="Select evolution driver" value={activeEvolutionAgent.driverId} onChange={(event) => { setSelectedEvolutionAgentId(event.currentTarget.value); setSelectedRevision("current"); }}>
                      {evolutionAgents.map((agent) => <option value={agent.driverId} key={agent.driverId}>{agent.driverName} · {agent.status}</option>)}
                    </select>
                  </label>
                  <label>POLICY HISTORY
                    <select aria-label="Select policy history" value={selectedRevision} onChange={(event) => setSelectedRevision(event.currentTarget.value)}>
                      <option value="current">Current policy</option>
                      {activeEvolutionAgent.history.map((revision, index) => <option value={String(index)} key={`${revision.generation ?? index}-${revision.name ?? index}`}>Gen {revision.generation ?? index + 1} · {revision.name ?? revision.candidateName ?? "Policy revision"}{revision.accepted === false ? " · rejected" : ""}</option>)}
                    </select>
                  </label>
                </div>
                <div className="code-card">
                  <div className="code-card-top"><span><i /> {activeEvolutionAgent.driverName} / {activeRevision ? "revision_policy.py" : evolutionCandidateName ? "generated_policy.py" : "current_policy.py"}</span><span>PYTHON 3</span></div>
                  <pre><code>{evolutionSource ?? <span className="code-comment"># No policy source has been recorded for this driver.</span>}</code></pre>
                </div>
              </div>
              <div className="fitness-card">
                <div className="fitness-label">HELD-OUT STEERING AGREEMENT</div>
                <div className="fitness-values"><span>{formatScore(evolutionBeforeScore)}</span><i>→</i><strong>{formatScore(evolutionAfterScore)}</strong></div>
                <div className="fitness-bar"><i style={{ width: `${scoreWidth(evolutionAfterScore)}%` }} /></div>
                <span className="fitness-caption">BEFORE → CANDIDATE · SAME SCENARIOS</span>
              </div>
            </div>
            <div className="evolution-usage" aria-label="Inference usage summary">
              <span>{evolution.provider ?? "PROVIDER NOT REPORTED"}{evolution.model ? ` · ${evolution.model}` : ""}</span>
              <span>{evolution.sequential === true ? "SEQUENTIAL INFERENCE" : evolution.sequential === false ? "PARALLEL INFERENCE" : "EXECUTION MODE UNREPORTED"}</span>
              <span>{evolution.sandboxExecutions == null ? "SANDBOX RUNS UNREPORTED" : `${number.format(evolution.sandboxExecutions)} SANDBOX RUNS · ONE VM REUSED`}</span>
              <span>{usageCount}/{expectedUsageCount} {legacyUsage ? "POLICIES" : "DRIVERS"} REPORTED</span>
              <span>{totalUsage ? number.format(totalUsage.totalTokens) : "—"} TOKENS</span>
              <span>{totalUsage ? `${number.format(totalUsage.requests)} REQUESTS · ${number.format(totalUsage.attempts)} ATTEMPTS` : usageCount ? "PARTIAL USAGE · TOTALS UNAVAILABLE" : "NO USAGE RECORDED"}</span>
              <span>{totalUsage ? `${number.format(totalUsage.promptTokens)} IN / ${number.format(totalUsage.completionTokens)} OUT` : "— IN / — OUT"}</span>
            </div>
            {evolution.log.length > 0 && <div className="evolution-log" aria-label="Evolution log">{evolution.log.slice(-20).map((line, index) => <span key={`${index}-${line}`}><i />{line}</span>)}</div>}
          </section>

          {teams.length > 0 && <section className="panel teams-panel" aria-labelledby="teams-title">
            <div className="panel-heading"><div><div className="panel-kicker">TEAM GARAGES</div><h2 id="teams-title">Constructor standings <span className="panel-heading-meta">/ TEAM ECONOMY</span></h2></div><span className="teams-count">{String(teams.length).padStart(2, "0")} TEAMS</span></div>
            <div className="team-grid">{teams.map((team) => <article className="team-card" key={team.name}>
              <div className="team-card-top"><span className="team-swatch" style={{ background: team.color }} /><strong>{team.name}</strong><b>{number.format(team.points)} <small>PTS</small></b></div>
              <div className="team-budget">AVAILABLE BUDGET <strong>${number.format(team.budget)}</strong></div>
              <div className="upgrade-list">{team.upgrades.length ? team.upgrades.map((upgrade) => <span key={upgrade} className="upgrade-pill">{upgrade}</span>) : <span className="upgrade-empty">No upgrades installed</span>}
                {onUpgrade && team.upgradeIds?.map((upgrade) => <button className="upgrade-action" type="button" key={upgrade} onClick={() => onUpgrade(team.name, upgrade)} aria-label={`Purchase ${upgrade} for ${team.name}`}>+ {upgrade}</button>)}
              </div>
            </article>)}</div>
          </section>}
        </div>

        <aside className="side-column">
          <section className="hero-facts" aria-label="Race status">
            <div><span>DRIVERS</span><strong>{race.drivers.length}</strong></div>
            <div><span>LAP</span><strong>{String(frameLap).padStart(2, "0")} <small>/ {String(race.totalLaps).padStart(2, "0")}</small></strong></div>
            <div><span>STATUS</span><strong className="fact-status"><i />{inReplay ? "Replay" : race.status === "running" ? "Live" : race.status === "finished" ? "Finished" : race.status === "paused" ? "Paused" : "Ready"}</strong></div>
          </section>
        </aside>
      </section>

      <details className="more-race-data">
        <summary>Race data <span>Leaderboard · telemetry · controls</span></summary>
        <div className="more-race-grid">
          <div className="side-column">
            <details className="leaderboard-disclosure">
              <summary>Leaderboard <span>{String(race.drivers.length).padStart(2, "0")} drivers</span></summary>
              <section className="panel leaderboard-panel" aria-labelledby="leaderboard-title">
            <div className="panel-heading"><div><div className="panel-kicker">{classificationLabel}</div><h2 id="leaderboard-title">Leaderboard</h2></div><span className="count-badge">{String(race.drivers.length).padStart(2, "0")}</span></div>
            <div className="leaderboard-head"><span>POS / DRIVER</span><span>LAP</span><span>SPEED</span></div>
            <div className="leaderboard-list">
              {orderedDrivers.length ? orderedDrivers.slice(0, 20).map((driver, index) => <DriverRow key={driver.id} driver={driver} position={index + 1} selected={driver.id === selectedDriverId} onSelect={() => setSelectedDriverId(driver.id)} />) : <div className="list-empty"><span>—</span><p>Drivers will line up here<br />when the race starts.</p></div>}
            </div>
            <div className="leaderboard-footer"><span>{positionLabel}</span><i /> {timingLabel}</div>
              </section>
            </details>

            <section className="panel telemetry-panel" aria-labelledby="telemetry-title">
              <div className="panel-heading"><div><div className="panel-kicker">DRIVER TELEMETRY</div><h2 id="telemetry-title">{selectedDriver?.name ?? "Telemetry"}</h2></div><span className="telemetry-id">{selectedDriver ? selectedDriver.id.toUpperCase() : "—"}</span></div>
              {selectedDriver ? <div className="telemetry-content">
                <div className="telemetry-team"><i style={{ background: selectedDriver.color }} />{selectedDriver.team}<span>{selectedDriver.status.toUpperCase()}</span></div>
                <div className="telemetry-stats"><div><span>CURRENT LAP</span><strong>{String(selectedDriver.lap).padStart(2, "0")}<small> / {race.totalLaps}</small></strong></div><div><span>VELOCITY</span><strong>{number.format(selectedDriver.speed)}<small> U/TICK</small></strong></div></div>
                <div className="telemetry-chart"><TelemetryBars samples={selectedDriver.speedHistory ?? []} color={selectedDriver.color} /></div>
                <div className="telemetry-chart-caption"><span>SPEED / RECENT SAMPLES</span><span>{inReplay ? "REPLAY" : running ? "LIVE" : "RECORDED"}</span></div>
              </div> : <div className="telemetry-empty"><span>◎</span><p>Select any driver on the track or leaderboard to inspect telemetry.</p></div>}
            </section>

            <section className="panel race-control-panel"><div className="panel-kicker">RACE CONTROL</div><div className="control-seed"><span>DETERMINISTIC SEED</span><strong>{race.seed}</strong></div><div className="control-seed"><span>SIMULATION TICK</span><strong>{number.format(race.tick)}</strong></div><div className="control-seed"><span>RECORDED FRAMES</span><strong>{number.format(race.history.length)}</strong></div>
              <div className="race-events"><div className="panel-kicker">RACE EVENTS</div>{race.events.slice(-4).reverse().map((event, index) => <div className="race-event" key={`${event.tick}-${index}`}><span>{number.format(event.tick).padStart(4, "0")}</span><p>{event.message}</p></div>)}</div>
            </section>
          </div>
        </div>
      </details>

      <details className="recorded-run" aria-label="Recorded evolution run results">
        <summary>Recorded evolution · Seed 2026 <span>Details</span></summary>
        <div className="recorded-heading"><span className="recorded-mark">RUN RECORD</span><div><strong>RECORDED RUN · SEED 2026</strong><small>Verified Groq + CreateOS Sandbox evolution results</small></div></div>
        <div className="recorded-metrics">
          <div><strong>20</strong><span>GROQ REQUESTS</span></div>
          <div><strong>36</strong><span>SANDBOX EXECUTIONS</span></div>
          <div><strong>18</strong><span>POLICIES EVALUATED</span></div>
          <div><strong>02</strong><span>POLICIES PROMOTED</span></div>
        </div>
        <p>Promotion was based on measured held-out steering agreement—not lap-time improvement. This is a recorded run, not live activity.</p>
      </details>

      <footer className="app-footer"><span>GRID PRIX <i>×</i> CREATEOS SANDBOX <i>×</i> STRIPE PROJECTS</span><span>BUILT FOR AUTONOMOUS PROGRESS <b>◆</b></span></footer>
    </main>
  );
}

function DriverRow({ driver, position, selected, onSelect }: { driver: DriverView; position: number; selected: boolean; onSelect: () => void }) {
  return <button className={`driver-row ${selected ? "is-selected" : ""}`} onClick={onSelect} type="button">
    <span className={`position ${position === 1 ? "position-first" : ""}`}>{String(position).padStart(2, "0")}</span>
    <span className="driver-name-cell"><i style={{ background: driver.color }} /><span><strong>{driver.name}</strong><small>{driver.team}</small></span></span>
    <span className="driver-lap">{String(driver.lap).padStart(2, "0")}</span>
    <span className="driver-speed">{number.format(Math.round(driver.speed))}</span>
  </button>;
}

function TelemetryBars({ samples, color }: { samples: number[]; color: string }) {
  const recent = samples.slice(-32);
  const max = Math.max(1, ...recent);
  const bars = recent.map((sample, index) => {
    const height = Math.max(3, Math.round((sample / max) * 50));
    return <i key={index} style={{ height: `${height}px`, background: color, opacity: 0.35 + ((index + 1) / recent.length) * 0.65 }} />;
  });
  return <div className="telemetry-bars">{bars}</div>;
}

function formatScore(score?: number) {
  return score == null ? "—" : score.toFixed(1);
}

function scoreWidth(score?: number) {
  return score == null ? 0 : Math.min(100, Math.max(0, score));
}

function summarizeUsage(usages: Array<InferenceUsage | undefined>) {
  return usages.reduce<Required<InferenceUsage>>((total, usage) => ({
    promptTokens: total.promptTokens + (usage?.promptTokens ?? 0),
    completionTokens: total.completionTokens + (usage?.completionTokens ?? 0),
    totalTokens: total.totalTokens + (usage?.totalTokens ?? 0),
    requests: total.requests + (usage?.requests ?? 0),
    attempts: total.attempts + (usage?.attempts ?? 0),
  }), { promptTokens: 0, completionTokens: 0, totalTokens: 0, requests: 0, attempts: 0 });
}

function hasCompleteUsageCounters(usage: InferenceUsage): boolean {
  return usage.promptTokens != null
    && usage.completionTokens != null
    && usage.totalTokens != null
    && usage.requests != null
    && usage.attempts != null;
}
