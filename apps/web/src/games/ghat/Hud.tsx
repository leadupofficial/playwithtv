import type { ItemKind } from "./items";
import type { Phase } from "./race";
import type { ViewRect } from "./layout";
import type { Award } from "./awards";

const ITEM_EMOJI: Record<ItemKind, string> = { coconut: "🥥", splash: "💦", chai: "☕", horn: "📯" };
const ORD = (n: number) => `${n}${n === 1 ? "ST" : n === 2 ? "ND" : n === 3 ? "RD" : "TH"}`;
const LEVEL = ["", "#41b8ff", "#ff9a1f", "#d04bff"];

export interface PlayerHud {
  id: string; name: string; color: string; rect: ViewRect;
  place: number; field: number; lap: number; laps: number; kmh: number; meter: number;
  item: ItemKind | null; rolling: boolean; level: number; drifting: boolean;
  blind: number; wrecked: boolean; by: string | null; finished: boolean;
  /** Boosting (speed lines) and whether screen effects are affordable (not on the lite tier). */
  boost: boolean; fx: boolean;
  msgs: Array<{ key: number; text: string; color: string; big?: boolean }>;
}

export interface HudState {
  phase: Phase;
  count: number | null;
  players: PlayerHud[];
  /** Stage height share of the smallest view, to scale text. */
  results: Array<{ name: string; color: string; time: string }> | null;
  replay: { by: string; victim: string; byColor: string } | null;
  awards: Array<Award & { name: string; color: string }> | null;
  podium: Array<{ name: string; color: string }> | null;
}

function PlayerPanel({ p, phase }: { p: PlayerHud; phase: Phase }) {
  const big = Math.round(Math.min(p.rect.w * 1920 * 0.11, p.rect.h * 1080 * 0.2));
  const segs = [0, 1, 2].map((i) => Math.max(0, Math.min(1, p.meter * 3 - i)));
  return (
    <div className="gr-view gr-shadow" data-hud-player={p.name} style={{ left: `${p.rect.x * 100}%`, top: `${p.rect.y * 100}%`, width: `${p.rect.w * 100}%`, height: `${p.rect.h * 100}%`, ["--big" as string]: `${big}px`, ["--col" as string]: p.color }}>
      {p.fx && p.boost && phase === "race" && <div className="gr-speedlines" />}
      {p.blind > 0 && <div className="gr-blind" style={{ opacity: Math.min(1, p.blind / 0.8) }} />}
      <div className="gr-name">{p.name}</div>
      {phase !== "intro" && (
        <>
          <div className="gr-place"><b>{ORD(p.place)}</b><small>/{p.field}</small>
            <div className={`gr-lap${p.lap === p.laps && p.laps > 1 ? " final" : ""}`}>{p.lap === p.laps && p.laps > 1 ? "FINAL LAP" : `LAP ${p.lap}/${p.laps}`}</div>
          </div>
          <div className={`gr-item${p.item ? (p.rolling ? " rolling" : " ready") : " empty"}`}><span>{p.item ? ITEM_EMOJI[p.item] : "🎁"}</span></div>
          <div className="gr-speed">{p.kmh}<small>km/h</small></div>
          <div className="gr-meter-label">BOOST</div>
          <div className="gr-meter">
            {segs.map((v, i) => <div key={i} className={`gr-seg${v >= 1 ? " full" : ""}`}><i style={{ transform: `scaleX(${v})` }} /></div>)}
          </div>
          {p.drifting && (
            <div className="gr-drift">
              {[1, 2, 3].map((l) => <i key={l} className={p.level >= l ? "on" : ""} style={{ ["--c" as string]: LEVEL[l] }} />)}
            </div>
          )}
          <div className="gr-msgs">
            {p.msgs.map((m) => <div key={m.key} className={`gr-msg${m.big ? " big" : ""}`} style={{ color: m.color }}>{m.text}</div>)}
          </div>
          {p.wrecked && <div className="gr-wreck"><div>{p.by ? `TAKEN DOWN BY ${p.by}!` : "WRECKED!"}</div></div>}
          {p.finished && phase === "race" && <div className="gr-done">FINISHED {ORD(p.place)}!</div>}
        </>
      )}
    </div>
  );
}

export function Hud({ s }: { s: HudState }) {
  return (
    <>
      {(s.phase === "race" || s.phase === "countdown" || s.phase === "results") && s.players.map((p) => <PlayerPanel key={p.id} p={p} phase={s.phase} />)}
      {s.phase === "intro" && (
        <div className="gr-center">
          <div className="gr-title">
            <h1>GHAT RUSH</h1>
            <p>Monsoon racing down the Western Ghats</p>
            <div className="tag">🌀 Drift · 🔥 Boost · 💥 Takedowns · 🐐 Mind the goats</div>
          </div>
        </div>
      )}
      {s.phase === "countdown" && s.count !== null && (
        <div className="gr-center"><div key={s.count} className={`gr-count gr-shadow${s.count === 0 ? " go" : ""}`}>{s.count === 0 ? "GO!" : s.count}</div></div>
      )}
      {s.phase === "race" && s.count === 0 && <div className="gr-center"><div className="gr-count go gr-shadow">GO!</div></div>}
      {s.phase === "results" && s.results && (
        <div className="gr-center">
          <div className="gr-results">
            <h2>RESULTS</h2>
            {s.results.map((r, i) => (
              <div key={r.name + i} className="gr-row"><span className="p">{ORD(i + 1)}</span><span style={{ color: r.color }}>{r.name}</span><span className="t">{r.time}</span></div>
            ))}
          </div>
        </div>
      )}
      {s.phase === "replay" && s.replay && (
        <div className="gr-letterbox" style={{ position: "absolute", inset: 0 }}>
          <div className="gr-rec">● REPLAY</div>
          <div className="gr-replay gr-shadow"><b>BEST TAKEDOWN!</b><span><span style={{ color: s.replay.byColor }}>{s.replay.by}</span> takes out {s.replay.victim}</span></div>
        </div>
      )}
      {s.phase === "podium" && (
        <>
          <div className="gr-podium-title">🏆 {s.podium?.[0]?.name ?? ""} RULES THE GHAT!</div>
          {s.awards && (
            <div className="gr-awards">
              {s.awards.map((a, i) => (
                <div key={a.title} className="gr-award" style={{ ["--col" as string]: a.color, animationDelay: `${0.3 + i * 0.35}s` }}>
                  <div className="e">{a.emoji}</div><div className="t">{a.title}</div><div className="n" style={{ color: a.color }}>{a.name}</div><div className="d">{a.detail}</div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </>
  );
}
