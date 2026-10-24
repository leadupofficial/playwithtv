import type { Phase } from "./rules";

export interface HudState {
  phase: Phase;
  round: number;
  maxRounds: number;
  roundsToWin: number;
  left: number;
  fighters: Array<{ id: string; name: string; color: string; wins: number; alive: boolean; cpu: boolean }>;
}

/** Sofa-readable strip at the top: each fighter's name and round-win stars, the round and the clock. */
export function Hud({ state }: { state: HudState }) {
  if (state.phase === "podium" || state.phase === "intro") return null;
  const secs = Math.ceil(state.left);
  const clock = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;
  const half = Math.ceil(state.fighters.length / 2);
  const chip = (f: HudState["fighters"][number]) => (
    <div key={f.id} data-hud-player={f.name} style={{
      display: "flex", alignItems: "center", gap: 10, padding: "6px 18px", borderRadius: 999, background: "rgba(20,14,48,.82)",
      border: `4px solid ${f.color}`, opacity: f.alive ? 1 : 0.6, fontSize: 30, fontWeight: 800, color: "#fff",
    }}>
      <span style={{ width: 18, height: 18, borderRadius: 9, background: f.color, display: "inline-block" }} />
      <span>{f.alive ? "" : "👻 "}{f.name}</span>
      <span style={{ color: "#ffd23f", letterSpacing: 2 }}>{"★".repeat(f.wins)}<span style={{ opacity: 0.3 }}>{"★".repeat(Math.max(0, state.roundsToWin - f.wins))}</span></span>
    </div>
  );
  return (
    <div style={{ position: "absolute", left: 30, right: 30, top: 22, display: "flex", justifyContent: "space-between", alignItems: "flex-start", pointerEvents: "none" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 10, alignItems: "flex-start" }}>{state.fighters.slice(0, half).map(chip)}</div>
      <div style={{ textAlign: "center", color: "#fff", fontWeight: 900, textShadow: "0 4px 0 rgba(0,0,0,.45)" }}>
        <div style={{ fontSize: 30, letterSpacing: 3, opacity: 0.9 }}>ROUND {state.round} / {state.maxRounds}</div>
        <div data-clock style={{ fontSize: 64, color: secs <= 10 && state.phase === "fight" ? "#ff5d73" : "#fff" }}>{clock}</div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10, alignItems: "flex-end" }}>{state.fighters.slice(half).map(chip)}</div>
    </div>
  );
}
