import type { HudState } from "./session";

/**
 * The platformer HUD over the TV picture: a card per hero (name on their colour, hearts, gems, score, power-up),
 * the level clock in the middle, a boss health bar during boss fights, and the big level cards (intro, clear,
 * time up).
 */
export function Hud({ state, emoji }: { state: HudState; emoji: string }) {
  if (state.phase === "podium") return null;
  const urgent = state.clock <= 15 && state.phase === "play";
  return (
    <div className="plat-hud">
      <div className="plat-heroes">
        {state.heroes.map((h) => (
          <div key={h.slot} className={`plat-card ${h.down ? "down" : ""}`} data-hud={h.name} style={{ borderColor: h.color }}>
            <span className="plat-name" style={{ background: h.color }}>{h.name}{h.finished ? (h.place ? ` 🏁${h.place}` : " 🏁") : ""}</span>
            <span className="plat-hearts">{Array.from({ length: h.maxHearts }, (_, i) => <i key={i} className={i < h.hearts ? "on" : ""}>♥</i>)}</span>
            <span className="plat-gems">💎 {h.gems}</span>
            <span className="plat-score">{h.score.toLocaleString("en-IN")}</span>
          </div>
        ))}
      </div>
      <div className={`plat-clock ${urgent ? "urgent" : ""}`}>
        <b>{Math.ceil(state.clock)}</b>
        <span>{emoji} {state.level}/{state.levels}</span>
      </div>
      {state.boss && (
        <div className="plat-boss">
          <span>{state.boss.name}</span>
          <div className="bar"><div style={{ width: `${(state.boss.hp / state.boss.max) * 100}%` }} /></div>
        </div>
      )}
      {state.card && (
        <div className="plat-levelcard" key={state.card.title}>
          <b>{state.card.title}</b>
          <span>{state.card.sub}</span>
        </div>
      )}
    </div>
  );
}
