import type { PlayerView } from "@playwithtv/protocol";
import type { QLang } from "../../content/trivia/types";
import { textOf } from "../../content/trivia/packs";
import { AVATARS } from "../../avatars";
import { round, player, type Game } from "./engine";
import { correctPos, correctSeq } from "./plan";
import { COLORS, SHAPES } from "./controls";
import { say } from "./strings";
import { STEAL_FIRST } from "./scoring";
import { Timer } from "./stage";

const pv = (players: PlayerView[], id: string | null) => players.find((p) => p.id === id);
const avatar = (p?: PlayerView) => (p ? AVATARS[p.avatar].emoji : "❔");

/** The emoji clues: revealed ones pop in, the rest wait as glowing question cards. */
export function Clues({ g, worth }: { g: Game; worth: number }) {
  const q = round(g).q;
  const clues = q.emoji ?? [];
  const showWorth = g.phase === "reveal" || g.phase === "answer";
  return (
    <div className="dk-clues-wrap">
      <div className="dk-clues">
        {clues.map((e, i) => (
          <div key={i} className={`dk-clue ${i < g.revealed ? "on" : ""}`}>
            {i < g.revealed ? <span key="e" className="dk-emoji">{e}</span> : <span className="dk-q">?</span>}
          </div>
        ))}
      </div>
      {showWorth && <div key={worth} className="dk-worth">{worth}</div>}
    </div>
  );
}

/** The four answers in the TV's colours, with what happened to each at the result. */
export function Options({ g, players, lang }: { g: Game; players: PlayerView[]; lang: QLang }) {
  const r = round(g);
  const { lang: tl, t } = textOf(r.q, lang);
  const result = g.phase === "result";
  const right = r.kind === "order" ? -1 : correctPos(r);
  const seq = r.kind === "order" ? correctSeq(r) : [];
  return (
    <div className={`dk-options ${r.kind === "order" ? "order" : ""} ${result ? "result" : ""}`} lang={tl}>
      {r.order.map((a, pos) => {
        const out = g.out.includes(pos);
        const state = result ? (r.kind === "order" ? "placed" : pos === right ? "right" : "wrong") : out ? "out" : "";
        const pickers = g.players.filter((p) => (r.kind === "order" ? false : p.answer?.pos === pos));
        const slot = result && r.kind === "order" ? seq.indexOf(pos) : pos;
        return (
          <div key={pos} className={`dk-opt ${state}`} style={{ background: COLORS[pos], ["--slot" as string]: slot }}>
            <span className="dk-shape">{result && r.kind === "order" ? slot + 1 : SHAPES[pos]}</span>
            <span className="dk-opt-text">{t.answers[a]}</span>
            {result && r.q.values && <span className="dk-value">{r.q.values[a]}</span>}
            {result && pickers.length > 0 && (
              <span className="dk-pickers">{pickers.map((p) => <span key={p.id}>{avatar(pv(players, p.id))}</span>)}</span>
            )}
            {out && <span className="dk-cross">✕</span>}
          </div>
        );
      })}
    </div>
  );
}

/** The question line (fact rounds) or the puzzle hint (emoji rounds). */
export function Prompt({ g, lang }: { g: Game; lang: QLang }) {
  const r = round(g);
  const { lang: tl, t } = textOf(r.q, lang);
  if (r.kind === "emoji") {
    return (
      <div className="dk-prompt small" lang={tl}>
        <span className="dk-hint">{t.hint}</span> {t.prompt}
      </div>
    );
  }
  const icon = { movies: "🎬", music: "🎵", sports: "🏏", general: "🧠", science: "🔬", geography: "🌍", food: "🍛" }[r.q.category];
  return (
    <>
      {r.kind !== "order" && <div className="dk-cat" aria-hidden>{icon}</div>}
      <div className="dk-prompt" lang={tl}>{t.prompt}</div>
    </>
  );
}

/** Who buzzed, big, with the heartbeat timer. */
export function Spotlight({ g, players, lang, paused }: { g: Game; players: PlayerView[]; lang: QLang; paused: boolean }) {
  const p = pv(players, g.buzzer);
  return (
    <div className="dk-spot" style={{ borderColor: p?.color }}>
      <span className="dk-spot-av" style={{ background: p?.color }}>{avatar(p)}</span>
      <span className="dk-spot-name" lang={lang}>{say(lang, "buzzed", { name: p?.name ?? "" })}</span>
      <Timer msLeft={g.dur - g.t} total={g.dur} paused={paused} size={130} k={`a${g.ri}`} />
    </div>
  );
}

/** The STEAL banner. */
export function StealBanner({ g, lang, paused }: { g: Game; lang: QLang; paused: boolean }) {
  return (
    <div className="dk-steal">
      <span className="dk-steal-word" lang={lang}>{say(lang, "steal")}</span>
      <span className="dk-steal-hint" lang={lang}>{say(lang, "stealHint", { pts: STEAL_FIRST })}</span>
      <Timer msLeft={g.dur - g.t} total={g.dur} paused={paused} size={130} k={`s${g.ri}`} />
    </div>
  );
}

/** Who got it (or stole it), shown at the result. */
export function ResultBanner({ g, players, lang }: { g: Game; players: PlayerView[]; lang: QLang }) {
  const o = g.outcome;
  if (!o) return null;
  const r = round(g);
  const name = (id: string) => pv(players, id)?.name ?? "";
  let text: string;
  let tone = "good";
  if (o.stealer) text = say(lang, "stole", { name: name(o.stealer) });
  else if (o.buzzerRight && o.buzzer) text = say(lang, "got", { name: name(o.buzzer) });
  else if (o.winners.length === 1) text = say(lang, "got", { name: name(o.winners[0]!) });
  else if (o.winners.length > 1) text = o.winners.map(name).join(" · ");
  else {
    text = say(lang, "nobody");
    tone = "bad";
  }
  const { lang: tl, t } = textOf(r.q, lang);
  const answer = r.kind === "order" ? null : t.answers[r.q.correct as number];
  const streak = o.winners.map((id) => ({ id, n: o.streaks[id] ?? 0 })).filter((s) => s.n >= 3).sort((a, b) => b.n - a.n)[0];
  return (
    <div className={`dk-result ${tone}`}>
      {answer && <span className="dk-result-label" lang={lang}>{say(lang, "answerWas")}: <b lang={tl}>{answer}</b> ·</span>}
      {!answer && <span className="dk-result-label" lang={lang}>{say(lang, "correctOrder")} ·</span>}
      <span className="dk-result-text" lang={lang}>{text}</span>
      {o.comeback.length > 0 && <span className="dk-badge cb" lang={lang}>🚀 {say(lang, "comeback")}</span>}
      {streak && <span className="dk-badge fire" lang={lang}>🔥 {name(streak.id)}: {say(lang, "streak", { n: streak.n })}</span>}
    </div>
  );
}

/** Answered-so-far avatars during all-answer rounds. */
export function Answered({ g, players }: { g: Game; players: PlayerView[] }) {
  return (
    <div className="dk-answered">
      {g.players.map((p) => {
        const v = pv(players, p.id);
        const done = !!player(g, p.id)?.answer?.done;
        return <span key={p.id} className={`dk-ans ${done ? "in" : ""} ${p.locked ? "locked" : ""}`} style={{ borderColor: v?.color }}>{avatar(v)}</span>;
      })}
    </div>
  );
}
