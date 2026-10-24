import { useEffect, useMemo, useRef, useState } from "react";
import type { PlayerView } from "@playwithtv/protocol";
import type { GameProps } from "../types";
import type { QLang } from "../../content/trivia/types";
import { offeredLangs, textOf } from "../../content/trivia/packs";
import { ControlPlayers } from "../controlKit";
import { placings } from "../scoring";
import { currentLang } from "../../i18n";
import { NORMAL, QUICK as QUICK_T, newGame, round, skip, standings, wagerOf, type Game } from "./engine";
import { NORMAL_PLAN, QUICK_PLAN, makePlan, rng } from "./plan";
import { Director } from "./director";
import { DhamakaSfx } from "./sfx";
import { langOf, langSpec, waitSpec } from "./controls";
import { say } from "./strings";
import { Effects, Header, ScoreStrip, Timer } from "./stage";
import { Answered, Clues, Options, Prompt, ResultBanner, Spotlight, StealBanner } from "./rounds";
import { Board, CheckIn, Intro, Podium, RoundIntro, Wager, roundTitle } from "./shows";
import "./dhamaka.css";

/** ?quick=1 on the TV URL: a one-minute match (tests and demos). */
const QUICK = typeof location !== "undefined" && new URLSearchParams(location.search).get("quick") === "1";
/** Languages with enough approved questions for a whole match. */
const OFFERED = offeredLangs({ emoji: 12, mcq: 10, order: 2 });
const CHECKIN_MAX = QUICK ? 15_000 : 30_000;

/**
 * Emoji Dhamaka on the TV: a quiz show for 1–8 players. Emoji puzzles reveal one emoji at a time and players
 * buzz in on their phones; fact rounds, order rounds and a double-or-nothing final break them up.
 */
export function DhamakaGame({ players, bridge, paused, onFinish }: GameProps) {
  const ids = useRef(players.filter((p) => p.connected).slice(0, 8)).current;
  const [room, setRoom] = useState<QLang>(() => {
    const l = currentLang() as QLang;
    return OFFERED.includes(l) ? l : "en";
  });
  const kit = useRef<ControlPlayers | null>(null);
  kit.current ??= new ControlPlayers(bridge, ids.map((p) => p.id), langSpec(OFFERED, room));
  const sfx = useRef<DhamakaSfx | null>(null);
  sfx.current ??= new DhamakaSfx();
  const [langs, setLangs] = useState<Map<string, QLang>>(new Map());
  const [director, setDirector] = useState<Director | null>(null);
  const [countdown, setCountdown] = useState<number | null>(null);
  const startedAt = useRef(Date.now());
  const live = useRef({ langs, room, director });
  live.current = { langs, room, director };

  useEffect(() => {
    const k = kit.current!;
    const s = sfx.current!;
    k.start();
    s.load();
    return () => {
      k.dispose();
      s.close();
    };
  }, []);

  // phone buttons: languages while checking in, game moves after
  useEffect(() => kit.current!.onAction((id, action) => {
    const { director: d, room: r } = live.current;
    if (d) return d.action(id, action);
    const l = langOf(action);
    if (!l || !OFFERED.includes(l)) return;
    setLangs((m) => new Map(m).set(id, l));
    sfx.current!.play("select", 0.5);
    bridge.layout(id, "game", waitSpec(l, say(l, "pPicked")) as unknown as Record<string, unknown>);
    kit.current!.toast(id, `✓ ${say(l, "pPicked")}`, "good");
    void r;
  }), [bridge]);

  const begin = () => {
    if (live.current.director) return;
    const { langs: picked, room: r } = live.current;
    const plan = makePlan(QUICK ? QUICK_PLAN : NORMAL_PLAN, r, rng((Math.random() * 2 ** 31) | 0));
    const g = newGame(ids.map((p) => p.id), plan, QUICK ? QUICK_T : NORMAL);
    const d = new Director(g, kit.current!, bridge, r, new Map(picked), sfx.current!, () => {
      onFinish(placings(new Map(g.players.map((p) => [p.id, p.score]))), Date.now() - startedAt.current);
    });
    for (const p of ids) d.names.set(p.id, p.name);
    startedAt.current = Date.now();
    setDirector(d);
  };

  // check-in: starts when every connected player picked a language (short countdown), after a time limit,
  // or on OK from the remote
  const here = players.filter((p) => p.connected && ids.some((x) => x.id === p.id));
  const allIn = here.length > 0 && here.every((p) => langs.has(p.id));
  useEffect(() => {
    if (director) return;
    if (allIn && countdown === null) setCountdown(QUICK ? 1 : 3);
    if (!allIn && countdown !== null) setCountdown(null);
  }, [allIn, director]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (director || countdown === null) return;
    if (countdown <= 0) return begin();
    const id = setTimeout(() => setCountdown((c) => (c ?? 1) - 1), 1000);
    return () => clearTimeout(id);
  }, [countdown, director]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (director) return;
    const id = setTimeout(begin, CHECKIN_MAX);
    return () => clearTimeout(id);
  }, [director]); // eslint-disable-line react-hooks/exhaustive-deps

  // remote: OK starts the match from check-in, or skips the intro and leaderboards
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      if ((e.target as HTMLElement | null)?.closest?.("button")) return; // a focused button handles its own OK
      const d = live.current.director;
      if (!d) begin();
      else skip(d.g);
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // the show clock: 10 ticks a second, frozen while paused
  const [, render] = useState(0);
  useEffect(() => {
    if (!director || paused) return;
    let last = performance.now();
    const id = setInterval(() => {
      const now = performance.now();
      director.step(Math.min(250, now - last));
      last = now;
      render((n) => n + 1);
    }, 100);
    return () => clearInterval(id);
  }, [director, paused]);

  useEffect(() => {
    director?.setAway(players.filter((p) => !p.connected).map((p) => p.id));
  }, [director, players]);

  if (!director) {
    return (
      <div className="dk" lang={room}>
        <CheckIn players={here} langs={langs} room={room} offered={OFFERED} countdown={countdown}
          onRoom={(l) => {
            setRoom(l);
            sfx.current!.play("select", 0.5);
          }} />
      </div>
    );
  }
  return <Show d={director} players={players} paused={paused} />;
}

/** Everything on screen during the match. */
function Show({ d, players, paused }: { d: Director; players: PlayerView[]; paused: boolean }) {
  const g = d.g;
  const lang = d.room;
  const prev = useRef<string[]>([]);
  const lastPhase = useRef(g.phase);
  if (lastPhase.current === "board" && g.phase !== "board") prev.current = standings(g).map((p) => p.id);
  lastPhase.current = g.phase;
  const debug = useMemo(() => JSON.stringify(state(g, d, players)), [g.phase, g.t, g.ri]); // eslint-disable-line react-hooks/exhaustive-deps
  const shake = d.fx.some((f) => f.kind === "shake" && d.now - f.at < 500);
  const inRound = ["reveal", "answer", "steal", "all", "result"].includes(g.phase);
  return (
    <div className={`dk ${shake ? "shake" : ""}`} lang={lang} data-dhamaka={debug}>
      <Header lang={lang} host={d.host} roundText={inRound || g.phase === "round-intro" ? roundTitle(g, lang) : undefined} />
      <div className="dk-main">
        {g.phase === "intro" && <Intro lang={lang} />}
        {g.phase === "round-intro" && <RoundIntro g={g} lang={lang} />}
        {g.phase === "board" && <Board g={g} players={players} lang={lang} prev={prev.current} />}
        {g.phase === "wager" && <Wager g={g} players={players} lang={lang} paused={paused} />}
        {(g.phase === "podium" || g.phase === "over") && <Podium g={g} players={players} lang={lang} />}
        {inRound && <RoundView d={d} players={players} paused={paused} />}
      </div>
      {(inRound || g.phase === "wager") && <ScoreStrip g={g} players={players} showGains={g.phase === "result"} />}
      <Effects fx={d.fx} />
      {paused && <div className="dk-paused"><b>⏸</b></div>}
    </div>
  );
}

function RoundView({ d, players, paused }: { d: Director; players: PlayerView[]; paused: boolean }) {
  const g = d.g;
  const lang = d.room;
  const r = round(g);
  const timed = g.phase === "all";
  return (
    <div className={`dk-round k-${r.kind} p-${g.phase}`}>
      {r.kind === "final" && <div className="dk-chip dk-final-chip" lang={lang}>🎲 {say(lang, "finalTitle")}</div>}
      <Prompt g={g} lang={lang} />
      {r.kind === "emoji" && <Clues g={g} worth={d.worth()} />}
      {g.phase === "reveal" && <p className="dk-sub dk-buzz-now" lang={lang}>🔔 {say(lang, "buzzNow")}</p>}
      {g.phase === "answer" && <Spotlight g={g} players={players} lang={lang} paused={paused} />}
      {g.phase === "steal" && <StealBanner g={g} lang={lang} paused={paused} />}
      {g.phase === "all" && r.kind === "emoji" && <p className="dk-sub" lang={lang}>{say(lang, "noBuzz")}</p>}
      {g.phase === "all" && r.kind === "order" && <p className="dk-sub" lang={lang}>{say(lang, "orderHint")}</p>}
      {g.phase !== "reveal" && <Options g={g} players={players} lang={lang} />}
      {timed && (
        <div className="dk-timed">
          <Answered g={g} players={players} />
          <Timer msLeft={g.dur - g.t} total={g.dur} paused={paused} size={130} k={`t${g.ri}`} />
        </div>
      )}
      {g.phase === "result" && <ResultBanner g={g} players={players} lang={lang} />}
    </div>
  );
}

/** Small JSON debug state for browser tests (`data-dhamaka`). */
function state(g: Game, d: Director, players: PlayerView[]) {
  const name = (id: string | null) => players.find((p) => p.id === id)?.name ?? null;
  const r = round(g);
  return {
    phase: g.phase, round: g.ri, rounds: g.rounds.length, kind: r.kind, qid: r.q.id, correct: d.correct(), revealed: g.revealed,
    answers: r.order.map((a) => textOf(r.q, d.room).t.answers[a]),
    buzzer: name(g.buzzer), out: g.out, room: d.room,
    players: Object.fromEntries(g.players.map((p) => [name(p.id), {
      score: p.score, streak: p.streak, locked: p.locked, answered: !!p.answer?.done, wager: p.wagerFrac, bet: wagerOf(p), wagerLocked: p.wagerLocked, lang: d.lang(p.id),
    }])),
    outcome: g.outcome && { winners: g.outcome.winners.map(name), stealer: name(g.outcome.stealer), buzzerRight: g.outcome.buzzerRight },
  };
}
