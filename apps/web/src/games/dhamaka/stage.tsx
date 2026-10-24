import { useMemo } from "react";
import type { PlayerView } from "@playwithtv/protocol";
import type { QLang } from "../../content/trivia/types";
import { AVATARS } from "../../avatars";
import type { Game } from "./engine";
import { standings } from "./engine";
import { HOST, quip, type Moment } from "./host";
import { say } from "./strings";
import type { Fx } from "./director";

/** The show's shell: logo, round chip and the host's speech bubble. */
export function Header({ lang, roundText, host }: { lang: QLang; roundText?: string; host: { moment: Moment; n: number } }) {
  return (
    <div className="dk-top">
      <div className="dk-logo" lang={lang}><span className="dk-logo-boom">💥</span>{say(lang, "title")}</div>
      {roundText && <div className="dk-chip dk-round" lang={lang}>{roundText}</div>}
      <div className="dk-host">
        <div key={host.n} className="dk-bubble" lang={lang}>{quip(lang, host.moment, host.n)}</div>
        <div className="dk-host-face" aria-label={HOST.name[lang]}>{HOST.emoji}<span className="dk-mic">🎤</span></div>
      </div>
    </div>
  );
}

/**
 * Circular countdown. The ring drains with one CSS animation per phase (no per-frame work) and the
 * heartbeat pulse speeds up as time runs out.
 */
export function Timer({ msLeft, total, paused, size = 150, k }: { msLeft: number; total: number; paused: boolean; size?: number; k: string }) {
  const beat = msLeft < 2500 ? "fast" : msLeft < 5000 ? "mid" : "slow";
  return (
    <div className={`dk-timer beat-${beat} ${paused ? "paused" : ""}`} style={{ width: size, height: size }}>
      <svg viewBox="0 0 140 140" aria-hidden>
        <circle cx="70" cy="70" r="60" className="dk-timer-bg" />
        <circle key={k} cx="70" cy="70" r="60" className="dk-timer-fg" style={{ animationDuration: `${total}ms`, animationDelay: `${msLeft - total}ms` }} />
      </svg>
      <b>{Math.max(0, Math.ceil(msLeft / 1000))}</b>
    </div>
  );
}

/** Players along the bottom, sliding into rank order; floating gains and streak flames at the result. */
export function ScoreStrip({ g, players, showGains }: { g: Game; players: PlayerView[]; showGains: boolean }) {
  const ranked = standings(g);
  const n = ranked.length;
  const slot = Math.min(230, 1700 / Math.max(1, n));
  const left0 = (1760 - slot * n) / 2;
  return (
    <div className="dk-strip">
      {g.players.map((p) => {
        const v = players.find((x) => x.id === p.id);
        const rank = ranked.indexOf(p);
        const hot = p.streak >= 3;
        return (
          <div key={p.id} className={`dk-pchip ${hot ? "hot" : ""} ${g.away.has(p.id) ? "away" : ""} ${p.locked ? "locked" : ""}`}
            style={{ transform: `translateX(${left0 + rank * slot}px)`, width: slot - 14, borderColor: v?.color }}>
            <span className="dk-pav">{v ? AVATARS[v.avatar].emoji : "❔"}</span>
            <span className="dk-pname">{v?.name ?? "?"}</span>
            <span className="dk-pscore">{p.score}</span>
            {hot && <span className="dk-flame" aria-label={`streak ${p.streak}`}>🔥{p.streak}</span>}
            {p.answer?.done && !showGains && <span className="dk-tick">✓</span>}
            {showGains && p.gain !== 0 && <span key={`${g.ri}-${p.id}`} className={`dk-gain ${p.gain > 0 ? "up" : "down"}`}>{p.gain > 0 ? `+${p.gain}` : p.gain}</span>}
          </div>
        );
      })}
    </div>
  );
}

const CONFETTI_COLORS = ["#ff2e63", "#ffd23f", "#3ee08f", "#2f8cff", "#b45cff", "#ff8a3d"];

/** A short burst of confetti: 36 small transformed squares, removed after the animation. */
export function Confetti({ seed }: { seed: number }) {
  const bits = useMemo(() => Array.from({ length: 36 }, (_, i) => {
    const r = (k: number) => ((Math.sin(seed * 97 + i * 13.7 + k * 5.3) + 1) / 2);
    return { left: r(1) * 1920, delay: r(2) * 0.35, dur: 1.3 + r(3) * 0.7, rot: r(4) * 720 - 360, drift: r(5) * 300 - 150, color: CONFETTI_COLORS[i % CONFETTI_COLORS.length]! };
  }), [seed]);
  return (
    <div className="dk-confetti" aria-hidden>
      {bits.map((b, i) => (
        <span key={i} style={{
          left: b.left, background: b.color, animationDelay: `${b.delay}s`, animationDuration: `${b.dur}s`,
          ["--rot" as string]: `${b.rot}deg`, ["--drift" as string]: `${b.drift}px`,
        }} />
      ))}
    </div>
  );
}

/** Screen effects of the moment (confetti, flashes, a shake on a wrong buzz). */
export function Effects({ fx }: { fx: Fx[] }) {
  return (
    <>
      {fx.filter((f) => f.kind === "confetti").slice(-1).map((f) => <Confetti key={f.id} seed={f.id} />)}
      {fx.filter((f) => f.kind === "flash-good" || f.kind === "flash-bad").slice(-1).map((f) => <div key={f.id} className={`dk-flash ${f.kind}`} />)}
    </>
  );
}
