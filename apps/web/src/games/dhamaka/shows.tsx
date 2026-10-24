import { useEffect, useState } from "react";
import type { PlayerView } from "@playwithtv/protocol";
import type { QLang } from "../../content/trivia/types";
import { AVATARS } from "../../avatars";
import { round, standings, wagerOf, type Game } from "./engine";
import { awards } from "./awards";
import { AWARD_TEXT, LANG_NAME, say } from "./strings";
import { Timer } from "./stage";
import type { Kind } from "./plan";

const pv = (players: PlayerView[], id: string) => players.find((p) => p.id === id);
const avatar = (p?: PlayerView) => (p ? AVATARS[p.avatar].emoji : "❔");

/** Before the match: everyone picks a language on their phone; the TV's own language is picked here. */
export function CheckIn({ players, langs, room, offered, onRoom, countdown }: {
  players: PlayerView[]; langs: Map<string, QLang>; room: QLang; offered: QLang[]; onRoom(l: QLang): void; countdown: number | null;
}) {
  return (
    <div className="dk-center dk-checkin" data-checkin>
      <h1 className="dk-mega" lang={room}><span className="dk-logo-boom">💥</span>{say(room, "title")}</h1>
      <p className="dk-tagline" lang={room}>{say(room, "tagline")}</p>
      <h2 className="dk-h2" lang={room}>{say(room, "checkin")}</h2>
      <div className="dk-cards">
        {players.map((p, i) => {
          const l = langs.get(p.id);
          return (
            <div key={p.id} className={`dk-card ${l ? "in" : ""}`} style={{ borderColor: p.color, animationDelay: `${i * 0.08}s` }} data-player={p.name}>
              <span className="dk-card-av" style={{ background: p.color }}>{avatar(p)}</span>
              <b>{p.name}</b>
              <span lang={l ?? room}>{l ? `✓ ${LANG_NAME[l]}` : say(room, "checkinHint")}</span>
            </div>
          );
        })}
      </div>
      <div className="dk-langs">
        <span lang={room}>{say(room, "roomLang")}:</span>
        {offered.map((l) => (
          <button key={l} data-nav className={`dk-lang ${l === room ? "on" : ""}`} lang={l} onClick={() => onRoom(l)}>{LANG_NAME[l]}</button>
        ))}
      </div>
      <p className="dk-sub" lang={room}>{countdown !== null ? say(room, "startingIn", { n: countdown }) : `${say(room, "ownLang")} · ${say(room, "pressOk")}`}</p>
    </div>
  );
}

export function Intro({ lang }: { lang: QLang }) {
  const rows: Array<[string, Parameters<typeof say>[1]]> = [["🔔", "how1"], ["🦹", "how2"], ["⚡", "how3"], ["🎲", "how4"]];
  return (
    <div className="dk-center">
      <h1 className="dk-mega" lang={lang}><span className="dk-logo-boom">💥</span>{say(lang, "title")}</h1>
      <h2 className="dk-h2" lang={lang}>{say(lang, "howTitle")}</h2>
      <ul className="dk-how">
        {rows.map(([icon, key], i) => (
          <li key={key} style={{ animationDelay: `${0.2 + i * 0.25}s` }}><span>{icon}</span><span lang={lang}>{say(lang, key)}</span></li>
        ))}
      </ul>
    </div>
  );
}

const KIND_KEY: Record<Kind, "emojiRound" | "mcqRound" | "orderRound" | "finalRound"> = { emoji: "emojiRound", mcq: "mcqRound", order: "orderRound", final: "finalRound" };
const KIND_ICON: Record<Kind, string> = { emoji: "🔔", mcq: "⚡", order: "⏳", final: "🎲" };

/** Big title card between rounds. */
export function RoundIntro({ g, lang }: { g: Game; lang: QLang }) {
  const r = round(g);
  return (
    <div className="dk-center">
      <div className={`dk-roundcard k-${r.kind}`}>
        <span className="dk-roundcard-icon">{KIND_ICON[r.kind]}</span>
        <span className="dk-roundcard-n" lang={lang}>{say(lang, "round", { n: g.ri + 1, total: g.rounds.length })}</span>
        <span className="dk-roundcard-title" lang={lang}>{say(lang, KIND_KEY[r.kind])}</span>
        {r.kind === "order" && <span className="dk-sub" lang={lang}>{say(lang, "orderHint")}</span>}
      </div>
    </div>
  );
}

export const roundTitle = (g: Game, lang: QLang) =>
  `${say(lang, "round", { n: g.ri + 1, total: g.rounds.length })} · ${say(lang, KIND_KEY[round(g).kind])}`;

/** The leaderboard: rows start in the last board's order and shuffle into the new one. */
export function Board({ g, players, lang, prev }: { g: Game; players: PlayerView[]; lang: QLang; prev: string[] }) {
  const ranked = standings(g);
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    const id = setTimeout(() => setSettled(true), 700);
    return () => clearTimeout(id);
  }, []);
  const rowH = Math.min(96, 640 / Math.max(1, ranked.length));
  const top = ranked[0]?.score ?? 0;
  return (
    <div className="dk-center">
      <h2 className="dk-h2" lang={lang}>🏆 {say(lang, "leaderboard")}</h2>
      <div className="dk-board" style={{ height: rowH * ranked.length }}>
        {ranked.map((p, i) => {
          const v = pv(players, p.id);
          const before = prev.indexOf(p.id);
          const at = settled || before < 0 ? i : before;
          return (
            <div key={p.id} className={`dk-row ${i === 0 && settled ? "lead" : ""}`} style={{ transform: `translateY(${at * rowH}px)`, height: rowH - 12, borderColor: v?.color }}>
              <span className="dk-row-rank">{i + 1}</span>
              <span className="dk-row-av" style={{ background: v?.color }}>{avatar(v)}</span>
              <span className="dk-row-name">{v?.name}</span>
              {p.streak >= 3 && <span className="dk-flame">🔥{p.streak}</span>}
              <span className="dk-row-bar"><span style={{ transform: `scaleX(${top > 0 ? p.score / top : 0})` }} /></span>
              <span className="dk-row-score">{p.score}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Final wager: every player's bet as a live bar. */
export function Wager({ g, players, lang, paused }: { g: Game; players: PlayerView[]; lang: QLang; paused: boolean }) {
  return (
    <div className="dk-center">
      <h2 className="dk-h2" lang={lang}>🎲 {say(lang, "wagerTitle")}</h2>
      <p className="dk-sub" lang={lang}>{say(lang, "wagerHint")}</p>
      <div className="dk-wagers">
        {standings(g).map((p) => {
          const v = pv(players, p.id);
          return (
            <div key={p.id} className={`dk-wager ${p.wagerLocked ? "locked" : ""}`} style={{ borderColor: v?.color }}>
              <span className="dk-row-av" style={{ background: v?.color }}>{avatar(v)}</span>
              <span className="dk-row-name">{v?.name}</span>
              <span className="dk-wager-bar"><span style={{ transform: `scaleX(${p.wagerFrac})` }} /></span>
              <span className="dk-wager-pts" lang={lang}>{say(lang, "wagered", { pts: wagerOf(p) })}</span>
              <span className="dk-wager-lock">{p.wagerLocked ? "🔒" : "…"}</span>
            </div>
          );
        })}
      </div>
      <Timer msLeft={g.dur - g.t} total={g.dur} paused={paused} size={140} k={`w${g.ri}`} />
    </div>
  );
}

/** The finale: a podium for the top three, everyone else below, and the funny awards. */
export function Podium({ g, players, lang }: { g: Game; players: PlayerView[]; lang: QLang }) {
  const ranked = standings(g);
  const order = [ranked[1], ranked[0], ranked[2]];
  const heights = [300, 400, 230];
  const medals = ["🥈", "🥇", "🥉"];
  const list = awards(g);
  return (
    <div className="dk-center dk-final">
      <h2 className="dk-h2" lang={lang}>{say(lang, "podium")}</h2>
      <div className="dk-podium">
        {order.map((p, i) => {
          if (!p) return <div key={i} className="dk-step empty" />;
          const v = pv(players, p.id);
          return (
            <div key={p.id} className={`dk-step s${i}`} style={{ animationDelay: `${[0.4, 0.8, 0.1][i]}s` }}>
              <span className="dk-step-av" style={{ background: v?.color }}>{avatar(v)}</span>
              <span className="dk-step-name">{v?.name}</span>
              <span className="dk-step-score">{p.score}</span>
              <div className="dk-step-block" style={{ height: heights[i] }}><span>{medals[i]}</span></div>
            </div>
          );
        })}
      </div>
      {ranked.length > 3 && (
        <div className="dk-rest">{ranked.slice(3).map((p, i) => <span key={p.id}>{i + 4}. {avatar(pv(players, p.id))} {pv(players, p.id)?.name} · {p.score}</span>)}</div>
      )}
      {list.length > 0 && (
        <div className="dk-awards">
          {list.map((a, i) => {
            const [title, line] = AWARD_TEXT[lang][a.id]!;
            const v = pv(players, a.playerId);
            const n = a.id === "fastest" ? Math.max(0.1, a.value / 1000).toFixed(1) + "s" : a.value;
            return (
              <div key={a.id} className="dk-award" style={{ animationDelay: `${0.9 + i * 0.3}s` }}>
                <b lang={lang}>{title}</b>
                <span className="dk-award-who">{avatar(v)} {v?.name}</span>
                <span className="dk-award-line" lang={lang}>{line.replace("{n}", String(n))}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
