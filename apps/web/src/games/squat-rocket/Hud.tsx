/** Squat Rocket's TV overlay: phase banner, coach, announcer, per-player prompts and cards, shield, podium. */
import { AVATARS } from "../../avatars";
import type { PlayerView } from "@playwithtv/protocol";
import type { Award, Phase } from "./engine";

export interface CardState {
  id: string;
  reps: number;
  fuel: number;
  combo: number;
  score: number;
  /** "ok" tracking · "setup" phone setting up · "calib" calibrating · "lost" camera lost them */
  track: "ok" | "setup" | "calib" | "lost";
  icon: string;
  seated: boolean;
  pump: string;
}
export interface Prompt { id: string; x: number; y: number; text: string; urgency: number; color: string }
export interface Pop { key: number; x: number; y: number; text: string; color: string }

export const PHASE_TITLE: Record<Phase, string> = {
  warmup: "🔥 Warm-up", fuel: "⛽ Fuel up!", launch: "🚀 Lift-off!", climb: "☄️ Meteor climb", storm: "🛡️ Asteroid storm", finale: "🌌 Orbit!", done: "🏆 Results",
};

export function TopBar({ phase, left, total, coach, shield }: { phase: Phase; left: number; total: number; coach: string; shield: number | null }) {
  return (
    <div className="sr-top">
      <div className="sr-phase">
        <b>{PHASE_TITLE[phase]}</b>
        <span className="sr-timer"><span style={{ width: `${Math.round((total ? left / total : 0) * 100)}%` }} /></span>
        <span className="sr-secs">{Math.ceil(left)}s</span>
      </div>
      {shield !== null && (
        <div className={`sr-shield ${shield < 0.25 ? "low" : ""}`}>
          <span>🛡️ TEAM SHIELD</span>
          <span className="sr-shield-bar"><span style={{ width: `${Math.round(shield * 100)}%` }} /></span>
        </div>
      )}
      <div className="sr-coach" key={coach}>🧑‍🚀 {coach}</div>
    </div>
  );
}

export function Cards({ players, cards }: { players: PlayerView[]; cards: CardState[] }) {
  return (
    <div className="sr-cards">
      {cards.map((c) => {
        const p = players.find((x) => x.id === c.id)!;
        return (
          <div key={c.id} className={`sr-card track-${c.track}`} style={{ borderColor: p.color }} data-player={p.name}>
            <div className="sr-card-head">
              <span className="sr-av" style={{ background: p.color }}>{AVATARS[p.avatar].emoji}</span>
              <b>{p.name}</b>
              <span className="sr-icons">{c.icon}{c.seated ? " 🪑" : ""}</span>
            </div>
            <div className="sr-card-body">
              <div className="sr-reps"><b>{c.reps}</b><span>{c.pump}</span></div>
              <div className="sr-card-side">
                <span className="sr-fuel"><span style={{ width: `${Math.round(c.fuel * 100)}%`, background: p.color }} /></span>
                <span className="sr-score">{c.score} pts{c.combo > 1 ? <i className="sr-combo"> {c.combo}× combo</i> : null}</span>
              </div>
            </div>
            {c.track !== "ok" && (
              <div className="sr-warn">
                {c.track === "lost" ? "⚠️ Step back · move into the light" : c.track === "calib" ? "📷 Calibrating: stand tall…" : "📷 Setting up the camera…"}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function Prompts({ prompts, pops }: { prompts: Prompt[]; pops: Pop[] }) {
  return (
    <>
      {prompts.map((p) => (
        <div key={p.id} className={`sr-prompt ${p.urgency > 0.6 ? "hot" : ""}`} style={{ left: p.x, top: p.y, borderColor: p.color, transform: `translate(-50%, -100%) scale(${0.85 + p.urgency * 0.35})` }}>
          {p.text}
        </div>
      ))}
      {pops.map((p) => (
        <div key={p.key} className="sr-pop" style={{ left: p.x, top: p.y, color: p.color }}>{p.text}</div>
      ))}
    </>
  );
}

export function Podium({ players, ranking, awards, stats, team }: {
  players: PlayerView[];
  ranking: Array<{ id: string; score: number; place: number }>;
  awards: Award[];
  stats: Array<{ id: string; line: string }>;
  team: string;
}) {
  const who = (id: string) => players.find((p) => p.id === id)!;
  return (
    <div className="sr-podium" data-podium>
      <h1 className="big-title">🏆 Mission complete!</h1>
      <p className="sr-team">{team}</p>
      <div className="sr-podium-cols">
        <div className="sr-rank">
          {ranking.map((r) => (
            <div key={r.id} className={`sr-rank-row ${r.place === 1 ? "first" : ""}`} style={{ borderColor: who(r.id).color }}>
              <span className="place">{["🥇", "🥈", "🥉"][r.place - 1] ?? `${r.place}.`}</span>
              <span>{AVATARS[who(r.id).avatar].emoji} {who(r.id).name}</span>
              <b>{r.score}</b>
            </div>
          ))}
        </div>
        <div className="sr-awards">
          {awards.map((a) => (
            <div key={a.title} className="sr-award"><span className="sr-award-emoji">{a.emoji}</span><div><b>{a.title}</b><span>{a.line}</span></div></div>
          ))}
          {stats.map((s) => <div key={s.id} className="sr-stat">{s.line}</div>)}
        </div>
      </div>
    </div>
  );
}
