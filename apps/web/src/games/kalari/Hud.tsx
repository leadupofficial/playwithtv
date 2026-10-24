import { character, type FighterId } from "./rules";

export interface HudFighter { id: string; name: string; color: string; char: FighterId; health: number; meter: number; wins: number; alive: boolean; cpu: boolean }
export interface HudState { phase: string; round: number; roundsToWin: number; left: number; fighters: HudFighter[] }

/**
 * The fighting-game HUD over the TV picture: one plate per fighter (name on their colour, fighter, health bar with
 * a trailing damage chunk, special meter that blazes when full, round-win pips) and the round clock in the middle.
 */
export function Hud({ state, trail }: { state: HudState; trail: Map<string, number> }) {
  const plates = state.fighters.map((f) => <Plate key={f.id} f={f} trail={trail.get(f.id) ?? f.health} roundsToWin={state.roundsToWin} />);
  const half = Math.ceil(plates.length / 2);
  const urgent = state.phase === "fight" && state.left <= 10;
  return (
    <div className="kalari-hud">
      <div className="kalari-side">{plates.slice(0, half)}</div>
      <div className={`kalari-clock ${urgent ? "urgent" : ""}`}>
        <b>{Math.ceil(state.left)}</b>
        <span>ROUND {state.round}</span>
      </div>
      <div className="kalari-side right">{plates.slice(half)}</div>
    </div>
  );
}

function Plate({ f, trail, roundsToWin }: { f: HudFighter; trail: number; roundsToWin: number }) {
  const c = character(f.char);
  const low = f.health < 30;
  return (
    <div className={`kalari-plate ${f.alive ? "" : "out"}`} data-hud={f.name} style={{ borderColor: f.color }}>
      <div className="kalari-plate-top">
        <span className="kalari-name" style={{ background: f.color }}>{f.name}{f.cpu ? " 🤖" : ""}</span>
        <span className="kalari-char" style={{ color: c.color }}>{c.name}</span>
        <span className="kalari-pips">{Array.from({ length: roundsToWin }, (_, i) => <i key={i} className={i < f.wins ? "won" : ""} />)}</span>
      </div>
      <div className="kalari-health">
        <div className="trail" style={{ width: `${trail}%` }} />
        <div className={`fill ${low ? "low" : ""}`} style={{ width: `${f.health}%` }} />
      </div>
      <div className={`kalari-meter ${f.meter >= 100 ? "full" : ""}`}>
        <div style={{ width: `${f.meter}%`, background: c.color }} />
      </div>
    </div>
  );
}
