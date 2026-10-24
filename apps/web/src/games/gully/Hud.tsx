import { describePlan } from "./sim/delivery";
import { overs, type BoardState } from "./board";
import "./gully.css";

export interface Pop { id: number; text: string; color: string; big?: boolean; sub?: string }
export interface Line { id: number; en: string; sub: string; lang: "ta" | "hi" }
export interface Card { id: number; title: string; sub?: string; color?: string }

/** The TV graphics: scoreboard, ball-by-ball, chase equation, commentary ticker, big words, phase cards. */
export function Hud({ s, pop, line, card }: { s: BoardState | null; pop: Pop | null; line: Line | null; card: Card | null }) {
  if (!s) return null;
  const t = s.teams[s.batting]!;
  const other = s.teams[s.batting === 0 ? 1 : 0]!;
  const showBoard = s.phase !== "intro" && s.phase !== "podium";
  return (
    <div className="gso-hud">
      {showBoard && s.stage <= 1 && (
        <div className="gso-board" style={{ ["--team" as string]: t.color }}>
          <div className="gso-board-top">
            <span className="gso-bat">🏏</span>
            <span className="gso-team">{t.name}</span>
            <span className="gso-score" data-score={`${t.runs}/${t.wickets}`}>{t.runs}<small>/{t.wickets}</small></span>
            <span className="gso-overs">{overs(t.balls)}<small> / {overs(s.perInnings)}</small></span>
          </div>
          <div className="gso-board-mid">
            {s.need ? <b className="gso-need">{s.need}</b> : <span className="gso-first">{other.name} chase next</span>}
          </div>
          <div className="gso-board-row">
            {s.batter && <span><i style={{ background: s.batter.color }} />{s.batter.name} <b>{s.batter.runs}</b>({s.batter.balls})</span>}
            {s.bowler && <span className="gso-bowler"><i style={{ background: s.bowler.color }} />⚾ {s.bowler.name} <b>{s.bowler.figures}</b></span>}
          </div>
          <div className="gso-dots">
            {Array.from({ length: s.perInnings }, (_, i) => {
              const d = s.dots[i];
              const cls = d === "W" ? "w" : d === "6" || d === "8" ? "six" : d === "4" ? "four" : d ? "" : "empty";
              return <span key={i} className={`gso-dot ${cls}`}>{d ?? ""}</span>;
            })}
          </div>
        </div>
      )}
      {showBoard && s.bowlOut && (
        <div className="gso-board gso-bowlout" data-bowlout>
          <div className="gso-board-top"><span className="gso-bat">🧱</span><span className="gso-team">BOWL-OUT</span></div>
          {s.teams.map((tm, k) => {
            const balls = s.bowlOut!.balls[k] ?? 0, hits = s.bowlOut!.hits[k] ?? 0;
            return (
              <div key={k} className="gso-bo-row" style={{ ["--team" as string]: tm.color }}>
                <span className="gso-bo-name">{tm.name}</span>
                {Array.from({ length: Math.max(3, balls) }, (_, i) => (
                  <span key={i} className={`gso-dot ${i < balls ? "" : "empty"}`}>{i < balls ? "●" : ""}</span>
                ))}
                <b>{hits}</b>
              </div>
            );
          })}
        </div>
      )}
      {s.aimingName && (
        <div className="gso-aiming">
          🎯 <b>{s.aimingName}</b> is lining up…
          {s.aim && <PitchMap aim={s.aim} />}
        </div>
      )}
      {s.replay && <div className="gso-replay"><span className="gso-rec" />REPLAY <small>slow-mo</small></div>}
      {pop && (
        <div key={pop.id} className={`gso-pop ${pop.big ? "big" : ""}`} style={{ color: pop.color }} data-pop={pop.text}>
          {pop.text}
          {pop.sub && <small>{pop.sub}</small>}
        </div>
      )}
      {card && (
        <div key={card.id} className="gso-card" style={{ ["--team" as string]: card.color ?? "#ffd23f" }} data-card={card.title}>
          <div className="gso-card-title">{card.title}</div>
          {card.sub && <div className="gso-card-sub">{card.sub}</div>}
        </div>
      )}
      {line && s.phase !== "intro" && (
        <div key={line.id} className="gso-ticker">
          <span className="gso-mic">📻</span>
          <span className="gso-en">{line.en}</span>
          <span className="gso-sub" lang={line.lang}>{line.sub}</span>
        </div>
      )}
    </div>
  );
}

/** A little pitch map of the bowler's aim (shown only when a CPU bats, so no human gets a peek). */
function PitchMap({ aim }: { aim: { line: number; length: number; kind: string } }) {
  const d = describePlan({ line: aim.line, length: aim.length, kind: aim.kind as "pace" | "spin" });
  return (
    <div className="gso-pitchmap">
      <div className="gso-strip">
        <i style={{ left: `${50 - aim.line * 30}%`, top: `${12 + aim.length * 70}%` }} />
      </div>
      <span>{aim.kind === "spin" ? "🌀" : "⚡"} {d.length} · {d.line}</span>
    </div>
  );
}
