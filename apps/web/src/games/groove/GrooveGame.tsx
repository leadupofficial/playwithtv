/**
 * Groove Party: a dance game for the whole room. Everyone holds their phone in their right hand and copies
 * the coach on the TV; the phone feels each move (a flick, a punch, a twist, a shimmy) and stamps when it
 * peaked, so the TV judges your timing, not the Wi-Fi's. 1 to 8 dancers, a world tour of cities, original
 * music from the in-browser synthesiser, and nobody can fail a song.
 *
 * Without motion, the buttons or the touchpad play every move too. Camera mode (full body, the video stays
 * on the phone) comes next, through the same actions.
 */
import { useEffect, useRef, useState } from "react";
import type { ControlSpec, PlayerView } from "@playwithtv/protocol";
import { unwrapStamp } from "@playwithtv/motion";
import type { GameProps } from "../types";
import { ControlPlayers } from "../controlKit";
import { ControlTutorial } from "../ControlTutorial";
import { placings } from "../scoring";
import { getQuality } from "../../quality/store";
import { isOpen, load, nextReward, record, save, total, unlocked, type Progress } from "../kitgrid/progress";
import type { Reward } from "../kitgrid/types";
import { Synth, songBars, songMs } from "../beat-blade/music";
import { DanceRun, type DanceEvent, type Judgement } from "./engine";
import { GESTURE_OF_ACTION, MOVES } from "./moves";
import { DIFFICULTIES, forDifficulty, parseRoutine, type Difficulty, type Step } from "./routine";
import { CITIES, DANCES, REWARDS, type Dance } from "./songs";
import { GrooveView } from "./view";
import "./groove.css";

const QUICK = typeof location !== "undefined" && new URLSearchParams(location.search).get("quick") === "1";
/** ?quick=1 (tests): a 4-bar song with three bars of moves. */
const QUICK_ROUTINE = "intro: . . . .\nA: up - down - | left - right - | punch - shimmy -\nsong: intro A";
const MAX_DANCERS = 8;

export const CONTROLS: ControlSpec = {
  title: "Groove Party",
  modes: ["motion", "buttons", "touchpad"],
  stick: "none",
  actions: [
    { id: "up", label: "🙌 Up", color: "#ffd23f", gestures: ["flick-up"], swipes: ["swipe-up"] },
    { id: "down", label: "👇 Down", color: "#ff6b6b", gestures: ["flick-down"], swipes: ["swipe-down"] },
    { id: "left", label: "👈 Left", color: "#29d3ff", gestures: ["flick-left"], swipes: ["swipe-left"] },
    { id: "right", label: "👉 Right", color: "#3ddc97", gestures: ["flick-right"], swipes: ["swipe-right"] },
    { id: "punch", label: "👊 Punch", color: "#ff4fd8", gestures: ["push"], swipes: ["tap"] },
    { id: "pull", label: "💪 Pull", color: "#9b5cff", gestures: ["pull"] },
    { id: "twl", label: "🌀 Twist ⟲", color: "#ff9f1c", gestures: ["twist-left"] },
    { id: "twr", label: "🌀 Twist ⟳", color: "#ff9f1c", gestures: ["twist-right"] },
    { id: "shake", label: "✨ Shimmy", color: "#f15bb5", gestures: ["shake"] },
  ],
  hints: {
    motion: "Hold the phone in your RIGHT hand, screen facing you, and dance! Copy the coach: the phone feels every reach, punch, twist and shimmy",
    buttons: "Tap the move on the card as it reaches the ring",
    touchpad: "Swipe the way the move goes, tap for a punch",
  },
};

const CAMPAIGN = { id: "groove-party", levels: DANCES, rewards: REWARDS };
const OUTFIT: Record<string, [string, string]> = { "outfit-sparkle": ["#c0f4ff", "#5a189a"], "outfit-gold": ["#ffd166", "#2b2118"] };
const STAGE: Record<string, [string, string]> = { "stage-sunset": ["#ff7b54", "#2b0f2e"], "stage-galaxy": ["#1b1464", "#000000"] };
const DIFF_NAME: Record<Difficulty, string> = { easy: "Easy", normal: "Normal", hard: "Hard" };
const JUDGE_TEXT: Record<Judgement, string> = { perfect: "PERFECT", super: "SUPER", good: "GOOD", ok: "OK", miss: "MISS" };
/** Delay to take off a move's time: a stamped gesture still lags by the TV's picture; a relayed one also by the network. */
const OFFSET = { stamped: 50, relay: 85 };

export function GrooveGame({ players, bridge, paused, onFinish }: GameProps) {
  const ids = useRef(players.filter((p) => p.connected).slice(0, MAX_DANCERS)).current;
  const kit = useRef<ControlPlayers | null>(null);
  kit.current ??= new ControlPlayers(bridge, ids.map((p) => p.id), CONTROLS);
  const [practising, setPractising] = useState(true);
  useEffect(() => {
    kit.current!.start();
    return () => kit.current!.dispose();
  }, []);
  if (practising) {
    return (
      <div className="tv groove">
        <ControlTutorial title="🕺 Groove Party" players={ids} kit={kit.current} practice={["up", "punch", "right"]} quick={QUICK} onDone={() => setPractising(false)} />
      </div>
    );
  }
  return <Stage ids={ids} kit={kit.current} bridge={bridge} paused={paused} onFinish={onFinish} />;
}

type Phase = "menu" | "story" | "play" | "result";
interface Hud { score: number; streak: number; mult: number; pop: string; popTone: string; popAt: number }
interface Result { stars: number; best: boolean; fresh: Reward[]; per: Array<{ rating: string; score: number; acc: number; best: number; syncs: number }>; mvp: number }

function Stage({ ids, kit, bridge, paused, onFinish }: {
  ids: PlayerView[]; kit: ControlPlayers; bridge: GameProps["bridge"]; paused: boolean; onFinish: GameProps["onFinish"];
}) {
  const host = useRef<HTMLDivElement>(null);
  const [progress, setProgress] = useState<Progress>(() => load(CAMPAIGN));
  const [phase, setPhase] = useState<Phase>("menu");
  const [cursor, setCursor] = useState(() => {
    const first = load(CAMPAIGN).stars.findIndex((s) => s === 0);
    return first < 0 ? 0 : first;
  });
  const [diff, setDiff] = useState<Difficulty>(QUICK ? "easy" : "normal");
  const [hud, setHud] = useState<{ players: Hud[]; at: number; song: number; hype: number }>({ players: [], at: 0, song: 0, hype: 0.3 });
  const [result, setResult] = useState<Result | null>(null);
  const [testState, setTestState] = useState("");
  const scores = useRef(new Map(ids.map((p) => [p.id, 0])));
  const startedAt = useRef(Date.now());
  const finished = useRef(false);
  const items = DANCES.length + 1; // songs, then finish
  const live = useRef({ phase, cursor, diff, progress, paused });
  live.current = { phase, cursor, diff, progress, paused };

  const synthRef = useRef<Synth | null>(null);
  const viewRef = useRef<GrooveView | null>(null);
  const game = useRef<{ run: DanceRun; dance: Dance & { city: number }; steps: Step[]; songStart: number; pausedAt: number } | null>(null);
  const pops = useRef<Hud[]>(ids.map(() => ({ score: 0, streak: 0, mult: 1, pop: "", popTone: "", popAt: 0 })));

  useEffect(() => {
    const canvas = document.createElement("canvas");
    canvas.className = "groove-canvas";
    host.current!.appendChild(canvas);
    const view = new GrooveView(canvas, getQuality().profile);
    const s = new Synth();
    viewRef.current = view;
    synthRef.current = s;
    return () => {
      view.dispose();
      canvas.remove();
      viewRef.current = null;
      s.dispose();
      synthRef.current = null;
    };
  }, []);

  /** When player p's latest move happened, TV clock, corrected for their delay. */
  const moveTime = (p: number): number => {
    const now = performance.now();
    const r = kit.get(ids[p]!.id);
    const st = kit.mode(ids[p]!.id) === "motion" ? r.stamp : null;
    let t = st === null ? null : unwrapStamp(st, now);
    if (t !== null && (t < now - 1500 || t > now + 50)) t = null; // stale or nonsense
    return (t ?? now) - (t !== null ? OFFSET.stamped : OFFSET.relay);
  };

  const dance = DANCES[Math.min(cursor, DANCES.length - 1)]!;
  const city = CITIES[dance.city]!;
  const dress = () => {
    const pr = live.current.progress;
    viewRef.current?.setLook({
      top: OUTFIT[pr.skin]?.[0] ?? dance.coach[0], legs: OUTFIT[pr.skin]?.[1] ?? dance.coach[1],
      glow: city.glow, sky: STAGE[pr.theme] ?? city.sky,
    });
  };

  // ---- song lifecycle ----

  const begin = (index: number) => {
    const d = DANCES[index]!;
    const routine = parseRoutine(QUICK ? QUICK_ROUTINE : d.routine, d.bpm);
    const steps = forDifficulty(routine, live.current.diff, d.bpm);
    const bars = QUICK ? routine.bars : songBars(d);
    const lead = QUICK ? 800 : 2500;
    game.current = { run: new DanceRun(steps, ids.length, live.current.diff, songMs(d, bars)), dance: d, steps, songStart: performance.now() + lead, pausedAt: 0 };
    synthRef.current?.play(d, bars, lead);
    pops.current.forEach((x) => Object.assign(x, { score: 0, streak: 0, mult: 1, pop: "", popAt: 0 }));
    setResult(null);
    setPhase("play");
  };

  const finishSong = () => {
    const g = game.current;
    if (!g) return;
    synthRef.current?.stop();
    const { run } = g;
    const index = DANCES.findIndex((d) => d.id === g.dance.id);
    const stars = run.stars();
    ids.forEach((p, i) => scores.current.set(p.id, (scores.current.get(p.id) ?? 0) + run.dancers[i]!.score));
    const before = live.current.progress.stars[index] ?? 0;
    const { progress: next, fresh } = record(CAMPAIGN, live.current.progress, index, stars);
    save(CAMPAIGN, next);
    setProgress(next);
    const per = run.dancers.map((x, p) => ({ rating: run.rating(p), score: x.score, acc: run.accuracy(p), best: x.best, syncs: x.syncs }));
    // the crown goes to the top scorer only when nobody ties them
    const top = Math.max(...per.map((x) => x.score));
    const mvp = per.filter((x) => x.score === top).length === 1 && top > 0 ? per.findIndex((x) => x.score === top) : -1;
    setResult({ stars, best: stars > before, fresh, per, mvp });
    for (let i = 0; i < stars; i++) setTimeout(() => synthRef.current?.sfx("star"), 500 + i * 320);
    ids.forEach((p, i) => kit.toast(p.id, `${per[i]!.rating} · ${per[i]!.score} points`, per[i]!.acc >= 0.45 ? "good" : "info"));
    game.current = null;
    setPhase("result");
  };

  const finish = () => {
    if (finished.current) return;
    finished.current = true;
    synthRef.current?.stop();
    for (const p of ids) kit.outcome(p.id, `${scores.current.get(p.id) ?? 0} points`, "🕺");
    onFinish(placings(scores.current), Date.now() - startedAt.current);
  };

  // ---- the frame loop ----

  useEffect(() => {
    let raf = 0, lastHud = 0, lastTest = 0;
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const view = viewRef.current;
      if (!view) return;
      const g = game.current;
      if (g && live.current.phase === "play") {
        const beatMs = 60_000 / g.dance.bpm;
        if (live.current.paused) {
          if (!g.pausedAt) { g.pausedAt = now; synthRef.current?.pause(); }
          view.frame(g.pausedAt - g.songStart, beatMs, g.steps, () => false, g.run.hype);
          return;
        }
        if (g.pausedAt) {
          g.songStart += now - g.pausedAt;
          g.pausedAt = 0;
          synthRef.current?.resumeAt(now - g.songStart);
        }
        const t = now - g.songStart;
        synthRef.current?.tick(t);
        handle(g.run.update(t), now);
        view.frame(t, beatMs, g.steps, (i) => g.run.dancers.every((x) => x.done.has(i)), g.run.hype);
        if (now - lastHud > 100) {
          lastHud = now;
          g.run.dancers.forEach((x, i) => Object.assign(pops.current[i]!, { score: x.score, streak: x.streak, mult: g.run.mult(i) }));
          setHud({ players: pops.current.map((x) => ({ ...x })), at: now, song: Math.max(0, Math.min(1, t / g.run.end)), hype: g.run.hype });
        }
        if (QUICK && now - lastTest > 120) {
          lastTest = now;
          const next = g.steps.map((s, i) => ({ ...s, i })).filter((s) => s.t > t - 100 && !g.run.dancers[0]!.done.has(s.i)).slice(0, 3);
          setTestState(JSON.stringify({ t: Math.round(t), start: g.songStart, next: next.map((s) => ({ t: Math.round(s.t), move: s.move })), dancers: g.run.dancers.map((x) => ({ score: x.score, counts: x.counts })) }));
        }
        if (g.run.over(t)) finishSong();
        return;
      }
      // menus: the coach grooves on its own
      view.frame(now, 500, null, () => false, 0.3);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  });

  const handle = (evs: DanceEvent[], now: number) => {
    for (const e of evs) {
      if (e.kind === "judge") {
        const pop = pops.current[e.p]!;
        Object.assign(pop, { pop: e.judgement === "miss" ? "MISS" : `${JUDGE_TEXT[e.judgement]} +${e.points}`, popTone: e.judgement, popAt: now });
        if (e.judgement === "perfect") bridge.event(ids[e.p]!.id, "vibrate", { ms: 25 });
      } else if (e.kind === "sync") {
        viewRef.current?.flash("#ffffff");
        synthRef.current?.sfx("perfect");
        for (const p of e.players) Object.assign(pops.current[p]!, { pop: "💫 IN SYNC!", popTone: "sync", popAt: now });
      } else if (e.kind === "mult" && e.mult > 1) {
        viewRef.current?.flash(ids[e.p]!.color);
        Object.assign(pops.current[e.p]!, { pop: `🔥 ×${e.mult} STREAK`, popTone: "mult", popAt: now });
      }
    }
  };

  // ---- phone actions: dance moves in a song, navigation in the menus ----

  useEffect(() => kit.onAction((id, action) => {
    const L = live.current;
    const p = ids.findIndex((x) => x.id === id);
    const gesture = GESTURE_OF_ACTION[action];
    if (p < 0 || !gesture || L.paused || finished.current) return;
    const g = game.current;
    if (L.phase === "play" && g) {
      handle(g.run.dance(p, gesture, moveTime(p) - g.songStart), performance.now());
      return;
    }
    const sfx = (k: "move" | "select") => synthRef.current?.sfx(k);
    if (L.phase === "menu") {
      if (action === "left") { setCursor((c) => (c + items - 1) % items); sfx("move"); }
      else if (action === "right") { setCursor((c) => (c + 1) % items); sfx("move"); }
      else if (action === "up") { setDiff((d) => DIFFICULTIES[(DIFFICULTIES.indexOf(d) + 1) % DIFFICULTIES.length]!); sfx("move"); }
      else if (action === "punch" || action === "down") {
        if (L.cursor === DANCES.length) finish();
        else if (!isOpen(L.progress.stars, L.cursor)) kit.toast(id, "🔒 Clear the song before this one first", "info");
        else {
          sfx("select");
          const d = DANCES[L.cursor]!;
          if (!QUICK && CITIES[d.city]!.dances[0]!.id === d.id) setPhase("story");
          else begin(L.cursor);
        }
      }
      return;
    }
    if (L.phase === "story") {
      if (action === "punch" || action === "down") begin(L.cursor);
      else if (action === "pull" || action === "left") setPhase("menu");
      return;
    }
    if (L.phase === "result") {
      if (action === "punch" || action === "down") {
        const next = Math.min(DANCES.length - 1, L.cursor + 1);
        if (next !== L.cursor && isOpen(L.progress.stars, next)) setCursor(next);
        setPhase("menu");
      } else if (action === "up") begin(L.cursor);
      else if (action === "left") setPhase("menu");
    }
  }));

  // phone status follows the phase (sent only when it changes: no traffic during a song)
  useEffect(() => {
    const text = phase === "menu" ? "👈 👉 pick a song · 🙌 difficulty · 👊 punch to dance"
      : phase === "story" ? "👊 punch to start · 👈 back"
      : phase === "result" ? "👊 next song · 🙌 dance again · 👈 songs"
      : "Phone in your right hand · copy the coach! 🕺";
    for (const p of ids) kit.status(p.id, { text });
  }, [phase]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (phase !== "play") dress(); }, [phase, cursor, progress]); // eslint-disable-line react-hooks/exhaustive-deps

  const totalStars = total(progress.stars);
  const nextR = nextReward(CAMPAIGN, progress.stars);
  const owned = unlocked(CAMPAIGN, progress.stars);
  const g = game.current;
  return (
    <div className="tv groove" data-groove={JSON.stringify({ phase, cursor, diff, stars: progress.stars })} data-groove-play={testState}>
      <div ref={host} className="groove-host" />

      {phase === "play" && g && (
        <>
          <div className="groove-top">
            <span className="groove-song">{CITIES[g.dance.city]!.emoji} {g.dance.name} · {DIFF_NAME[g.run.difficulty]}</span>
            <span className="groove-bar"><span style={{ width: `${hud.song * 100}%` }} /></span>
            <span className="groove-hype" title="Crowd">🔥<span><span style={{ width: `${hud.hype * 100}%` }} /></span></span>
          </div>
          <div className={`groove-players n${Math.min(ids.length, 8)}`}>
            {ids.map((p, i) => {
              const h = hud.players[i];
              if (!h) return null;
              const fresh = hud.at - h.popAt < 650;
              return (
                <div key={p.id} className="groove-card" style={{ borderColor: p.color }}>
                  {fresh && h.pop && <div className={`groove-pop ${h.popTone}`}>{h.pop}</div>}
                  <div className="groove-name" style={{ color: p.color }}>{p.name}</div>
                  <div className="groove-score">{h.score.toLocaleString("en")}</div>
                  <div className="groove-streak">{h.streak > 1 ? `${h.streak} in a row` : "\u00a0"} {h.mult > 1 && <b>×{h.mult}</b>}</div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {phase === "menu" && (
        <div className="groove-panel">
          <div className="groove-head">
            <h1>🕺 Groove Party <small>World Tour</small></h1>
            <span className="groove-total">★ {totalStars} / {DANCES.length * 3}</span>
            <span className={`groove-diff ${diff}`}>🙌 {DIFF_NAME[diff]}</span>
          </div>
          <div className="groove-cities">
            {CITIES.map((c) => (
              <div key={c.id} className="groove-city" style={{ borderColor: c.glow }}>
                <div className="groove-cname" style={{ color: c.glow }}>{c.emoji} {c.name}</div>
                {c.dances.map((d) => {
                  const i = DANCES.findIndex((x) => x.id === d.id);
                  const open = isOpen(progress.stars, i);
                  return (
                    <div key={d.id} className={`groove-track ${cursor === i ? "on" : ""} ${open ? "" : "locked"}`} style={cursor === i ? { borderColor: c.glow, boxShadow: `0 0 2vh ${c.glow}` } : undefined}>
                      <span>{open ? d.name : "🔒 " + d.name}</span>
                      <span className="groove-stars">{[0, 1, 2].map((s) => <i key={s} className={s < (progress.stars[i] ?? 0) ? "on" : ""}>★</i>)}</span>
                      <small>{d.bpm} bpm</small>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
          <div className="groove-foot">
            <span className={`groove-btn ${cursor === DANCES.length ? "on" : ""}`}>✓ Finish</span>
            <span className="groove-rewards">
              {owned.map((r) => <span key={r.id} title={r.name}>{r.emoji}</span>)}
              {nextR && <span className="groove-next">Next: {nextR.emoji} {nextR.name} at ★ {nextR.stars}</span>}
            </span>
          </div>
          <p className="groove-hint">👈 👉 flick to choose · 👊 punch to dance · 🙌 flick up for difficulty · {ids.length > 1 ? <>{ids.length} dancers: hit the same move together for <b>IN SYNC</b> bonuses</> : "more phones can join for IN SYNC bonuses"}</p>
        </div>
      )}

      {phase === "story" && (
        <div className="groove-panel center story" style={{ borderColor: city.glow }}>
          <div className="groove-story-emoji">{city.emoji}</div>
          <h1 style={{ color: city.glow }}>{city.name}</h1>
          <p className="groove-lead">{city.story}</p>
          <p className="groove-hint">👊 punch to start <b>{dance.name}</b> · 👈 back</p>
        </div>
      )}

      {phase === "result" && result && (
        <div className="groove-panel center">
          <h1>{result.stars ? `${city.emoji} ${dance.name}: the crowd loved it!` : `${city.emoji} ${dance.name}: keep moving!`}</h1>
          <div className="groove-bigstars">{[0, 1, 2].map((s) => <i key={s} className={s < result.stars ? "on" : ""}>★</i>)}</div>
          {result.best && <p className="groove-lead">New best! {result.stars === 3 ? "The whole city is dancing." : "The crowd wants more."}</p>}
          <div className="groove-results">
            {result.per.map((r, i) => (
              <div key={ids[i]!.id} className={`groove-res ${i === result.mvp && ids.length > 1 ? "mvp" : ""}`} style={{ borderColor: ids[i]!.color }}>
                <div className="groove-rating">{i === result.mvp && ids.length > 1 ? "👑 " : ""}{r.rating}</div>
                <div className="groove-name" style={{ color: ids[i]!.color }}>{ids[i]!.name}</div>
                <div>{r.score.toLocaleString("en")} pts</div>
                <div>{Math.round(r.acc * 100)}% · best streak {r.best}{r.syncs ? ` · ${r.syncs} in sync` : ""}</div>
              </div>
            ))}
          </div>
          {result.fresh.length > 0 && <p className="groove-reward">Unlocked: {result.fresh.map((r) => `${r.emoji} ${r.name}`).join(", ")}</p>}
          <p className="groove-hint">👊 next song · 🙌 dance again · 👈 songs</p>
        </div>
      )}
      {/* moves for this song, so the TV can show what's coming even before the first card */}
      {phase === "play" && g && hud.song < 0.02 && <div className="groove-getready">Phone in your right hand · {MOVES[g.steps[0]?.move ?? "up"].emoji} get ready!</div>}
    </div>
  );
}
