import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { RaceCanvas } from "./RaceCanvas";
import type { DriverView, EvolutionView, RaceView, TeamView } from "./types";
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
  const evolutionAvailable = evolution.available === true;

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="#race" aria-label="Grid Prix home">
          <span className="brand-mark">G<span>✳</span></span>
          <span className="brand-word">GRID<span>PRIX</span></span>
        </a>
        <div className="topbar-center"><span className="live-dot" /> AUTONOMOUS RACING SERIES <span className="topbar-divider">/</span> SEASON 01</div>
        <div className="topbar-right"><span className="connection-indicator" /> RACE ENGINE READY <span className="topbar-clock">TICK {number.format(race.tick)}</span></div>
      </header>

      <section className="page-heading" id="race">
        <div>
          <div className="eyebrow">CHAMPIONSHIP CONTROL <span>·</span> ROUND 01</div>
          <h1>Neon Circuit <span>Grand Prix</span></h1>
          <p>Twenty autonomous drivers. One deterministic race. Every line of code earns its place.</p>
        </div>
        <div className="heading-actions">
          <button className="button button-quiet" onClick={onReset} type="button">Reset race</button>
          {running ? (
            <button className="button button-primary" onClick={onPause} type="button"><span className="pause-icon">Ⅱ</span> Pause race</button>
          ) : (
            <button className="button button-primary" onClick={onStart} type="button"><span className="play-icon">▶</span> {race.status === "paused" ? "Resume race" : "Start race"}</button>
          )}
          {onStep && !running && <button className="button button-step" onClick={onStep} type="button" aria-label="Advance one simulation tick">+1 tick</button>}
        </div>
      </section>

      <section className="stat-strip" aria-label="Race statistics">
        <Stat label="GRID" value={String(race.drivers.length).padStart(2, "0")} suffix="DRIVERS" accent="mint" />
        <Stat label="LAP" value={String(race.lap).padStart(2, "0")} suffix={`/ ${String(race.totalLaps).padStart(2, "0")}`} />
        <Stat label="SIMULATION TICK" value={number.format(race.tick)} suffix="DETERMINISTIC" />
        <Stat label="RACE STATUS" value={inReplay ? "REPLAY" : race.status.toUpperCase()} suffix={<span className={`status-chip status-${inReplay ? "paused" : race.status}`}>{inReplay ? "SCRUBBING" : race.status === "running" ? "LIVE" : race.status}</span>} />
        <Stat label="SEED" value={String(race.seed)} suffix="REPLAYABLE" />
      </section>

      <section className="race-layout">
        <div className="main-column">
          <section className="panel track-panel" aria-labelledby="track-title">
            <div className="panel-heading">
              <div><div className="panel-kicker">LIVE TRACK FEED</div><h2 id="track-title">Neon Circuit <span className="panel-heading-meta">/ SECTOR 01–03</span></h2></div>
              <span className={`live-tag ${running ? "is-live" : ""}`}><i /> {running ? "LIVE" : "STANDBY"}</span>
            </div>
            <RaceCanvas drivers={visibleDrivers} track={race.track} status={inReplay ? "replay" : race.status} tick={frame?.tick ?? race.tick} onSelectDriver={setSelectedDriverId} selectedDriverId={selectedDriverId} />
            <div className="track-footer"><span><i className="legend-dot legend-mint" /> START / FINISH</span><span><i className="legend-dot legend-white" /> {selectedDriver ? `FOCUS: ${selectedDriver.name}` : "CLICK A DRIVER TO INSPECT"}</span><span className="track-seed">SEED {race.seed}</span></div>
          </section>

          <section className="panel replay-panel" aria-label="Race replay controls">
            <div className="replay-label"><span className="panel-kicker">RACE REPLAY</span><strong>{number.format(frame?.tick ?? race.tick)} <small>/ {number.format(race.tick)}</small></strong></div>
            <input aria-label="Scrub race replay" type="range" min="0" max={Math.max(0, race.history.length - 1)} value={replayFrameIndex ?? Math.max(0, race.history.length - 1)} onChange={(event) => { const index = Number(event.currentTarget.value); const selected = race.history[index]; if (!selected) return; setReplayFrameIndex(index === race.history.length - 1 ? undefined : index); onReplayTick?.(selected.tick); }} />
            <button type="button" className="replay-live" onClick={() => { setReplayFrameIndex(undefined); onReplayTick?.(race.tick); }}><i /> LIVE</button>
          </section>

          <section className="panel evolution-panel" aria-labelledby="evolution-title">
            <div className="panel-heading evolution-heading">
              <div><div className="panel-kicker">SANDBOX CODE EVOLUTION</div><h2 id="evolution-title">The pit wall <span className="panel-heading-meta">/ POLICY LAB</span></h2></div>
              <button className="button button-outline" onClick={onEvolve} disabled={!evolutionAvailable || evolution.status === "running"} type="button" title={evolutionAvailable ? undefined : "Sandbox evolution is unavailable until a live integration is connected."}><span>↗</span> {evolution.status === "running" ? "Evolution running" : evolutionAvailable ? "Evolve policy" : "Sandbox unavailable"}</button>
            </div>
            <div className="evolution-grid">
              <div className="evolution-summary">
                <div className={`evolution-state state-${evolution.status}`}><span className="state-orb" /> {!evolutionAvailable ? "SANDBOX NOT CONNECTED" : evolution.status === "running" ? "SANDBOX EXECUTION" : evolution.status === "succeeded" ? "CANDIDATE ACCEPTED" : evolution.status === "rejected" ? "CANDIDATE REJECTED" : evolution.status === "error" ? "SANDBOX ERROR" : "AWAITING NEXT RUN"}</div>
                <h3>{evolution.candidateName ?? "No candidate selected"}</h3>
                <p>{evolution.summary ?? (evolutionAvailable ? "A candidate policy will appear here after a sandbox-backed evolution run." : "Evolution stays disabled until a credential-backed sandbox integration is connected.")}</p>
                <div className="generation-line"><span>GENERATION</span><b>{String(evolution.generation).padStart(2, "0")}</b><span className="generation-rule" /></div>
              </div>
              <div className="code-card">
                <div className="code-card-top"><span><i /> candidate.py</span><span>PYTHON 3</span></div>
                <pre><code>{evolution.source ?? <span className="code-comment"># No candidate source loaded yet.</span>}</code></pre>
              </div>
              <div className="fitness-card">
                <div className="fitness-label">VALIDATION FITNESS</div>
                <div className="fitness-values"><span>{formatScore(evolution.beforeScore)}</span><i>→</i><strong>{formatScore(evolution.afterScore)}</strong></div>
                <div className="fitness-bar"><i style={{ width: `${scoreWidth(evolution.afterScore)}%` }} /></div>
                <span className="fitness-caption">TRAINING + HELD-OUT SCENARIOS</span>
              </div>
            </div>
            {evolution.log.length > 0 && <div className="evolution-log" aria-label="Evolution log">{evolution.log.slice(-3).map((line, index) => <span key={`${index}-${line}`}><i />{line}</span>)}</div>}
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
          <section className="panel leaderboard-panel" aria-labelledby="leaderboard-title">
            <div className="panel-heading"><div><div className="panel-kicker">LIVE CLASSIFICATION</div><h2 id="leaderboard-title">Leaderboard</h2></div><span className="count-badge">{String(race.drivers.length).padStart(2, "0")}</span></div>
            <div className="leaderboard-head"><span>POS / DRIVER</span><span>LAP</span><span>SPEED</span></div>
            <div className="leaderboard-list">
              {orderedDrivers.length ? orderedDrivers.slice(0, 20).map((driver, index) => <DriverRow key={driver.id} driver={driver} position={index + 1} selected={driver.id === selectedDriverId} onSelect={() => setSelectedDriverId(driver.id)} />) : <div className="list-empty"><span>—</span><p>Drivers will line up here<br />when the race starts.</p></div>}
            </div>
            <div className="leaderboard-footer"><span>POSITION UPDATES EVERY TICK</span><i /> LIVE TIMING</div>
          </section>

          <section className="panel telemetry-panel" aria-labelledby="telemetry-title">
            <div className="panel-heading"><div><div className="panel-kicker">DRIVER TELEMETRY</div><h2 id="telemetry-title">{selectedDriver?.name ?? "Telemetry"}</h2></div><span className="telemetry-id">{selectedDriver ? selectedDriver.id.toUpperCase() : "—"}</span></div>
            {selectedDriver ? <div className="telemetry-content">
              <div className="telemetry-team"><i style={{ background: selectedDriver.color }} />{selectedDriver.team}<span>{selectedDriver.status.toUpperCase()}</span></div>
              <div className="telemetry-stats"><div><span>CURRENT LAP</span><strong>{String(selectedDriver.lap).padStart(2, "0")}<small> / {race.totalLaps}</small></strong></div><div><span>VELOCITY</span><strong>{number.format(selectedDriver.speed)}<small> U/TICK</small></strong></div></div>
              <div className="telemetry-chart"><TelemetryBars samples={selectedDriver.speedHistory ?? []} color={selectedDriver.color} /></div>
              <div className="telemetry-chart-caption"><span>PACE / RECENT TICKS</span><span>LIVE</span></div>
            </div> : <div className="telemetry-empty"><span>◎</span><p>Select any driver on the track or leaderboard to inspect live telemetry.</p></div>}
          </section>

          <section className="panel race-control-panel"><div className="panel-kicker">RACE CONTROL</div><div className="control-seed"><span>DETERMINISTIC SEED</span><strong>{race.seed}</strong></div><div className="control-seed"><span>SIMULATION TICK</span><strong>{number.format(race.tick)}</strong></div><div className="control-seed"><span>RECORDED FRAMES</span><strong>{number.format(race.history.length)}</strong></div>
            <div className="race-events"><div className="panel-kicker">RACE EVENTS</div>{race.events.slice(-4).reverse().map((event, index) => <div className="race-event" key={`${event.tick}-${index}`}><span>{number.format(event.tick).padStart(4, "0")}</span><p>{event.message}</p></div>)}</div>
          </section>
        </aside>
      </section>

      <footer className="app-footer"><span>GRID PRIX <i>×</i> CREATEOS SANDBOX <i>×</i> STRIPE PROJECTS</span><span>BUILT FOR AUTONOMOUS PROGRESS <b>◆</b></span></footer>
    </main>
  );
}

function Stat({ label, value, suffix, accent }: { label: string; value: string; suffix: ReactNode; accent?: string }) {
  return <div className={`stat ${accent ? `stat-${accent}` : ""}`}><span>{label}</span><strong>{value}</strong><small>{suffix}</small></div>;
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
