/**
 * Beat Blade on the TV.
 *
 *   practice (each cut once) → calibrate (swing to a metronome, once per player, saved) → song select
 *   → district story → song → result → song select … → Finish
 *
 * One phone is one saber. In motion mode the phone reads cuts from its gyroscope (saber mode, see
 * @playwithtv/motion saber.ts) and stamps each cut's peak in TV time over the direct link (beat.ts), so
 * judging uses when you swung, not when the packet arrived. Menus are played with cuts too: ◀ ▶ move,
 * ▼ chooses, ▲ changes the difficulty.
 */
import { useEffect, useRef, useState } from "react";
import type { ControlSpec, PlayerView } from "@playwithtv/protocol";
import { LatencyCalibrator, unwrapStamp } from "@playwithtv/motion";
import type { GameProps } from "../types";
import { ControlPlayers } from "../controlKit";
import { ControlTutorial } from "../ControlTutorial";
import { placings } from "../scoring";
import { getQuality } from "../../quality/store";
import { isOpen, load, nextReward, record, save, total, unlocked, type Progress } from "../kitgrid/progress";
import type { Reward } from "../kitgrid/types";
import { DIFFICULTIES, generate, parseMap, type Difficulty, type Dir, type Note } from "./beatmap";
import { AHEAD, BeatRun, laneOf, type Rank, type RunEvent } from "./engine";
import { Synth, songBars } from "./music";
import { DISTRICTS, REWARDS, TRACKS, type Track } from "./songs";
import { BeatView } from "./view";
import "./beat.css";

const QUICK = typeof location !== "undefined" && new URLSearchParams(location.search).get("quick") === "1";
const QUICK_BARS = 6;
type Cut = Exclude<Dir, "o">;
const CUT_OF: Record<string, Cut> = { cu: "u", cd: "d", cl: "l", cr: "r" };

export const CONTROLS: ControlSpec = {
  title: "Beat Blade",
  modes: ["motion", "buttons", "touchpad"],
  stick: "joystick",
  tilt: "aim",
  saber: true,
  grip: "any",
  actions: [
    { id: "cu", label: "⬆ Cut up", color: "#29d3ff", gestures: ["flick-up"], swipes: ["swipe-up"] },
    { id: "cd", label: "⬇ Cut down", color: "#ff4fd8", gestures: ["flick-down"], swipes: ["swipe-down"] },
    { id: "cl", label: "⬅ Cut left", color: "#ff9f1c", gestures: ["flick-left"], swipes: ["swipe-left"] },
    { id: "cr", label: "➡ Cut right", color: "#7cff6b", gestures: ["flick-right"], swipes: ["swipe-right"] },
  ],
  hints: {
    motion: "Hold the phone like a sword hilt. Tilt to aim, and flick your wrist the way the arrow points: the gyroscope feels every cut",
    buttons: "The joystick aims your blade, the arrow buttons cut that way",
    touchpad: "Your finger aims the blade: swipe the way the arrow points",
  },
};

const CAMPAIGN = { id: "beat-blade", levels: TRACKS, rewards: REWARDS };
const SKY: Record<string, string> = { "": "#05040c", "arena-dusk": "#1c0a26", "arena-aurora": "#03181c" };
const SKIN: Record<string, string> = { "saber-cyan": "#29d3ff", "saber-gold": "#ffd166", "saber-rainbow": "rainbow", "saber-white": "#ffffff" };
const DIFF_NAME: Record<Difficulty, string> = { easy: "Easy", normal: "Normal", hard: "Hard" };
const JUDGE_TEXT = { perfect: "PERFECT", great: "GREAT", good: "GOOD" } as const;

export function BeatBladeGame({ players, bridge, paused, onFinish }: GameProps) {
  const ids = useRef(players.filter((p) => p.connected).slice(0, 4)).current;
  const kit = useRef<ControlPlayers | null>(null);
  kit.current ??= new ControlPlayers(bridge, ids.map((p) => p.id), CONTROLS);
  const [practising, setPractising] = useState(true);
  useEffect(() => {
    kit.current!.start();
    return () => kit.current!.dispose();
  }, []);
  if (practising) {
    return (
      <div className="tv beat">
        <ControlTutorial title="🎵 Beat Blade" players={ids} kit={kit.current} practice={["cu", "cd", "cl", "cr"]} quick={QUICK} onDone={() => setPractising(false)} />
      </div>
    );
  }
  return <Stage ids={ids} kit={kit.current} bridge={bridge} paused={paused} onFinish={onFinish} />;
}

// ---- per-player delay, saved on this TV by name and link kind ----

const CAL_KEY = "pwtv.beatblade.cal";
/** Defaults before calibrating: a stamped cut still lags by the TV's picture delay; a relayed one also by the network. */
const DEFAULT_OFFSET = { stamped: 50, relay: 85 };

function loadCal(): Record<string, number> {
  try {
    const v = JSON.parse(localStorage.getItem(CAL_KEY) ?? "{}") as Record<string, number>;
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
}
function saveCal(c: Record<string, number>) {
  try {
    localStorage.setItem(CAL_KEY, JSON.stringify(c));
  } catch {
    /* not kept */
  }
}

type Phase = "calibrate" | "menu" | "story" | "play" | "result";
interface PlayerHud { score: number; combo: number; mult: number; health: number; failed: boolean; pop: string; popTone: string; popAt: number }
interface Result { stars: number; best: boolean; fresh: Reward[]; per: Array<{ rank: Rank; score: number; acc: number; combo: number; full: boolean; failed: boolean }> }

function Stage({ ids, kit, bridge, paused, onFinish }: {
  ids: PlayerView[]; kit: ControlPlayers; bridge: GameProps["bridge"]; paused: boolean; onFinish: GameProps["onFinish"];
}) {
  const host = useRef<HTMLDivElement>(null);
  const [progress, setProgress] = useState<Progress>(() => load(CAMPAIGN));
  const cal = useRef(loadCal());
  const needCal = !QUICK && ids.some((p) => cal.current[`${p.name}:stamped`] === undefined && cal.current[`${p.name}:relay`] === undefined);
  const [phase, setPhase] = useState<Phase>(needCal ? "calibrate" : "menu");
  const [cursor, setCursor] = useState(() => {
    const first = load(CAMPAIGN).stars.findIndex((s) => s === 0);
    return first < 0 ? 0 : first;
  });
  const [diff, setDiff] = useState<Difficulty>(QUICK ? "easy" : "normal");
  const [hud, setHud] = useState<{ players: PlayerHud[]; at: number; song: number }>(() => ({ players: [], at: 0, song: 0 }));
  const [calView, setCalView] = useState<{ beat: number; counts: number[]; done: string[] | null }>({ beat: -1, counts: ids.map(() => 0), done: null });
  const [result, setResult] = useState<Result | null>(null);
  const [testState, setTestState] = useState("");
  const scores = useRef(new Map(ids.map((p) => [p.id, 0])));
  const startedAt = useRef(Date.now());
  const finished = useRef(false);
  const items = TRACKS.length + 2; // songs, recalibrate, finish
  const live = useRef({ phase, cursor, diff, progress, paused });
  live.current = { phase, cursor, diff, progress, paused };

  // one synth and one 3D view for the whole visit; both made in the effect (a fresh canvas each time: a
  // context lost on unmount can't be reused, and React's dev double-mount would otherwise hit exactly that)
  const synthRef = useRef<Synth | null>(null);
  const viewRef = useRef<BeatView | null>(null);
  const game = useRef<{
    run: BeatRun; track: Track & { district: number }; notes: Note[]; songStart: number; ahead: number; pausedAt: number; nextBeat: number;
  } | null>(null);
  const calRef = useRef<{ start: number; beats: number; period: number; cals: LatencyCalibrator[]; kinds: Array<"stamped" | "relay"> } | null>(null);
  const aims = useRef(ids.map(() => [] as Array<[number, number, number]>)); // [tvMs, x, y] history (half a second)
  const pops = useRef<PlayerHud[]>(ids.map(() => ({ score: 0, combo: 0, mult: 1, health: 0.6, failed: false, pop: "", popTone: "", popAt: 0 })));

  useEffect(() => {
    const canvas = document.createElement("canvas");
    canvas.className = "beat-canvas";
    host.current!.appendChild(canvas);
    const view = new BeatView(canvas, getQuality().profile, ids.map((p) => p.color));
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
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const offsetFor = (p: number, stamped: boolean) => {
    const name = ids[p]!.name;
    return cal.current[`${name}:${stamped ? "stamped" : "relay"}`] ?? DEFAULT_OFFSET[stamped ? "stamped" : "relay"];
  };

  /** When player p's latest cut happened, TV clock, corrected for their delay. */
  const cutTime = (p: number): { t: number; stamped: boolean } => {
    const now = performance.now();
    const r = kit.get(ids[p]!.id);
    const st = kit.mode(ids[p]!.id) === "motion" ? r.stamp : null;
    let t = st === null ? null : unwrapStamp(st, now);
    if (t !== null && (t < now - 1500 || t > now + 50)) t = null; // stale (an old gesture) or nonsense
    const stamped = t !== null;
    return { t: (t ?? now) - offsetFor(p, stamped), stamped };
  };

  /** Player p's aim at TV time t (from the last half second of aims). */
  const aimAt = (p: number, t: number): [number, number] => {
    const h = aims.current[p]!;
    for (let i = h.length - 1; i >= 0; i--) if (h[i]![0] <= t) return [h[i]![1], h[i]![2]];
    const r = kit.get(ids[p]!.id);
    return [r.x, r.y];
  };

  const district = DISTRICTS[TRACKS[Math.min(cursor, TRACKS.length - 1)]!.district]!;
  const theme = () => {
    const lit = total(live.current.progress.stars) / (TRACKS.length * 3);
    viewRef.current?.setTheme(district.glow, SKY[live.current.progress.theme] ?? SKY[""]!, lit);
  };

  // ---- song lifecycle ----

  const begin = (index: number) => {
    const track = TRACKS[index]!;
    const d = live.current.diff;
    const bars = QUICK ? QUICK_BARS : songBars(track);
    const notes = track.maps?.[d] && !QUICK ? parseMap(track.maps[d]!, track.bpm) : generate(track, d, bars);
    const ahead = AHEAD[d];
    const lead = ahead + (QUICK ? 600 : 2000);
    game.current = { run: new BeatRun(notes, ids.length, d), track, notes, songStart: performance.now() + lead, ahead, pausedAt: 0, nextBeat: 0 };
    synthRef.current?.play(track, bars, lead);
    pops.current.forEach((x) => Object.assign(x, { score: 0, combo: 0, mult: 1, health: 0.6, failed: false, pop: "", popAt: 0 }));
    setResult(null);
    setPhase("play");
  };

  const finishSong = () => {
    const g = game.current;
    if (!g) return;
    synthRef.current?.stop();
    const { run } = g;
    const index = TRACKS.findIndex((t) => t.id === g.track.id);
    const stars = run.teamStars();
    ids.forEach((p, i) => scores.current.set(p.id, (scores.current.get(p.id) ?? 0) + run.runners[i]!.score));
    const before = live.current.progress.stars[index] ?? 0;
    const { progress: next, fresh } = record(CAMPAIGN, live.current.progress, index, stars); // wears new sabers/skies
    save(CAMPAIGN, next);
    setProgress(next);
    setResult({
      stars, best: stars > before, fresh,
      per: run.runners.map((r, p) => ({ rank: run.rank(p), score: r.score, acc: run.accuracy(p), combo: r.maxCombo, full: run.fullCombo(p), failed: r.failed })),
    });
    for (let i = 0; i < stars; i++) setTimeout(() => synthRef.current?.sfx("star"), 500 + i * 320);
    ids.forEach((p, i) => kit.toast(p.id, run.runners[i]!.failed ? "💥 Out of power. Try again!" : `${run.rank(i)} rank · ${run.runners[i]!.score} points`, run.runners[i]!.failed ? "bad" : "good"));
    game.current = null;
    setPhase("result");
  };

  const finish = () => {
    if (finished.current) return;
    finished.current = true;
    synthRef.current?.stop();
    for (const p of ids) kit.outcome(p.id, `${scores.current.get(p.id) ?? 0} points`, "🎵");
    onFinish(placings(scores.current), Date.now() - startedAt.current);
  };

  // ---- calibration: swing down on every click ----

  const startCalibration = () => {
    const period = 600;
    calRef.current = {
      start: performance.now() + 1500, beats: 12, period,
      cals: ids.map(() => new LatencyCalibrator()), kinds: ids.map(() => "relay"),
    };
    for (let k = 0; k < 12; k++) synthRef.current?.clickAt(1500 + k * period, k % 4 === 0);
    setCalView({ beat: -1, counts: ids.map(() => 0), done: null });
    setPhase("calibrate");
  };

  const endCalibration = () => {
    const c = calRef.current;
    if (!c) return;
    calRef.current = null;
    const lines = ids.map((p, i) => {
      const k = c.cals[i]!;
      if (k.ready) {
        cal.current[`${p.name}:${c.kinds[i]}`] = Math.round(k.offset);
        return `${p.name}: ${Math.round(k.offset)} ms delay, steady ✓`;
      }
      return k.count < 4 ? `${p.name}: not enough swings, using the default` : `${p.name}: swings were uneven, using the default`;
    });
    saveCal(cal.current);
    setCalView((v) => ({ ...v, done: lines }));
    setTimeout(() => live.current.phase === "calibrate" && setPhase("menu"), QUICK ? 300 : 3200);
  };

  useEffect(() => {
    if (phase === "calibrate" && !calRef.current && calView.done === null) startCalibration();
  }, [phase]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- the frame loop ----

  useEffect(() => {
    let raf = 0, last = performance.now(), lastHud = 0, lastTest = 0;
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const view = viewRef.current;
      if (!view) return;
      // aims: smoothed on screen, remembered for judging
      ids.forEach((p, i) => {
        const r = kit.get(p.id);
        const h = aims.current[i]!;
        h.push([now, r.x, r.y]);
        while (h.length && h[0]![0] < now - 500) h.shift();
        view.aim(i, r.x, r.y);
      });
      const skin = SKIN[live.current.progress.skin];
      view.setSkin(skin === "rainbow" ? `hsl(${Math.round((now / 40) % 360)}, 100%, 62%)` : skin ?? null);

      const g = game.current;
      if (g && live.current.phase === "play") {
        if (live.current.paused) {
          if (!g.pausedAt) { g.pausedAt = now; synthRef.current?.pause(); }
          view.frame(now - g.songStart, dt, g.notes, 0, g.ahead, () => false, () => false, DISTRICTS[g.track.district]!.glow);
          return;
        }
        if (g.pausedAt) {
          g.songStart += now - g.pausedAt;
          g.pausedAt = 0;
          synthRef.current?.resumeAt(now - g.songStart);
        }
        const t = now - g.songStart;
        synthRef.current?.tick(t);
        const beatMs = 60_000 / g.track.bpm;
        if (t >= g.nextBeat * beatMs) { view.beat(); g.nextBeat = Math.floor(t / beatMs) + 1; }
        const evs = g.run.update(t, ids.map((_, i) => aimAt(i, now)[0]));
        handle(evs, g, now);
        const active = g.run.runners.filter((r) => !r.failed);
        view.frame(t, dt, g.notes, 0, g.ahead,
          (i) => active.length > 0 && active.every((r) => r.done.has(i)) && g.notes[i]!.kind !== "wall",
          (i) => g.run.runners.some((r) => r.done.has(i)), DISTRICTS[g.track.district]!.glow);
        if (now - lastHud > 100) {
          lastHud = now;
          g.run.runners.forEach((r, i) => Object.assign(pops.current[i]!, { score: r.score, combo: r.combo, mult: g.run.mult(i), health: r.health, failed: r.failed }));
          setHud({ players: pops.current.map((x) => ({ ...x })), at: now, song: Math.max(0, Math.min(1, t / (g.run.end - 1200))) });
        }
        if (QUICK && now - lastTest > 120) {
          lastTest = now;
          const next = g.notes.map((n, i) => ({ ...n, i })).filter((n) => n.kind === "block" && n.t > t - 100 && !g.run.runners[0]!.done.has(n.i)).slice(0, 3);
          setTestState(JSON.stringify({ t: Math.round(t), start: g.songStart, next: next.map((n) => ({ t: Math.round(n.t), dir: n.dir, lane: n.lane })), runners: g.run.runners.map((r) => ({ score: r.score, hits: r.hits, misses: r.misses })) }));
        }
        if (g.run.over(t)) finishSong();
        return;
      }
      // menus and calibration: the track idles
      const c = calRef.current;
      if (c && live.current.phase === "calibrate") {
        const beat = Math.floor((now - c.start) / c.period);
        if (beat >= 0 && beat < c.beats && beat !== calView.beat) setCalView((v) => (v.beat === beat ? v : { ...v, beat }));
        if (beat >= 0 && (now - c.start) % c.period < dt * 1000) view.beat();
        if (now > c.start + c.beats * c.period + 500) endCalibration();
      }
      view.frame(now * 0.6, dt, [], 0, 1300, () => false, () => false, district.glow);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }); // re-bound each render so it sees fresh closures; the loop itself is cheap to restart

  const handle = (evs: RunEvent[], g: NonNullable<typeof game.current>, now: number) => {
    const view = viewRef.current;
    if (!view) return;
    for (const e of evs) {
      const p = ids[e.p]!;
      const pop = pops.current[e.p]!;
      if (e.kind === "hit") {
        view.burst(g.notes[e.note]!, p.color, e.judgement === "perfect");
        synthRef.current?.sfx(e.judgement);
        Object.assign(pop, { pop: `${JUDGE_TEXT[e.judgement]} +${e.points}`, popTone: e.judgement, popAt: now });
      } else if (e.kind === "miss") {
        synthRef.current?.sfx("miss");
        Object.assign(pop, { pop: e.bad ? "WRONG WAY" : "MISS", popTone: "miss", popAt: now });
      } else if (e.kind === "bomb") {
        view.burst(g.notes[e.note]!, "#ff3355", true);
        synthRef.current?.sfx("bomb");
        Object.assign(pop, { pop: "💥 BOMB", popTone: "miss", popAt: now });
        bridge.event(p.id, "vibrate", { ms: 300 });
      } else if (e.kind === "wall") {
        synthRef.current?.sfx("wall");
        Object.assign(pop, { pop: "🧱 LEAN AWAY", popTone: "miss", popAt: now });
        bridge.event(p.id, "vibrate", { ms: 200 });
      } else if (e.kind === "mult" && e.mult > 1) {
        Object.assign(pop, { pop: `×${e.mult}!`, popTone: "mult", popAt: now });
      } else if (e.kind === "fail") {
        kit.toast(p.id, "💥 Out of power! Watch the others finish", "bad");
      }
    }
  };

  // ---- phone actions ----

  useEffect(() => kit.onAction((id, action) => {
    const L = live.current;
    const p = ids.findIndex((x) => x.id === id);
    const dir = CUT_OF[action];
    if (p < 0 || !dir || L.paused || finished.current) return;
    const g = game.current;
    if (L.phase === "play" && g) {
      const { t } = cutTime(p);
      const [ax] = aimAt(p, t);
      viewRef.current?.swing(p, dir);
      handle(g.run.cut(p, dir, t - g.songStart, laneOf(ax)), g, performance.now());
      return;
    }
    if (L.phase === "calibrate") {
      const c = calRef.current;
      if (!c) return;
      const ct = cutTime(p);
      const raw = ct.t + offsetFor(p, ct.stamped); // calibration measures the delay, so undo the current one
      const k = Math.round((raw - c.start) / c.period);
      if (k < 0 || k >= c.beats) return;
      c.kinds[p] = ct.stamped ? "stamped" : "relay";
      c.cals[p]!.add(raw - (c.start + k * c.period));
      viewRef.current?.swing(p, dir);
      setCalView((v) => ({ ...v, counts: v.counts.map((n, i) => (i === p ? n + 1 : n)) }));
      return;
    }
    if (L.phase === "menu") {
      if (dir === "l") { setCursor((c) => (c + items - 1) % items); synthRef.current?.sfx("move"); }
      else if (dir === "r") { setCursor((c) => (c + 1) % items); synthRef.current?.sfx("move"); }
      else if (dir === "u") { setDiff((d) => DIFFICULTIES[(DIFFICULTIES.indexOf(d) + 1) % DIFFICULTIES.length]!); synthRef.current?.sfx("move"); }
      else if (dir === "d") {
        if (L.cursor === TRACKS.length) { synthRef.current?.sfx("select"); startCalibration(); }
        else if (L.cursor === TRACKS.length + 1) finish();
        else if (!isOpen(L.progress.stars, L.cursor)) kit.toast(id, "🔒 Clear the song before this one first", "info");
        else {
          synthRef.current?.sfx("select");
          const tr = TRACKS[L.cursor]!;
          // a district's story plays before its first song
          if (!QUICK && DISTRICTS[tr.district]!.tracks[0]!.id === tr.id) setPhase("story");
          else begin(L.cursor);
        }
      }
      return;
    }
    if (L.phase === "story") {
      if (dir === "d") begin(L.cursor);
      else if (dir === "u") setPhase("menu");
      return;
    }
    if (L.phase === "result") {
      if (dir === "d") {
        const next = Math.min(TRACKS.length - 1, L.cursor + 1);
        if (isOpen(L.progress.stars, next) && next !== L.cursor) { setCursor(next); setPhase("menu"); }
        else setPhase("menu");
      } else if (dir === "u") begin(L.cursor);
      else setPhase("menu");
    }
  }));

  // phone status follows the phase (sent only when it changes: no traffic during a song)
  useEffect(() => {
    const text = phase === "menu" ? "◀ ▶ pick a song · ▲ difficulty · ▼ play"
      : phase === "calibrate" ? "Swing DOWN on every click 🎯"
      : phase === "story" ? "▼ start the song · ▲ back"
      : phase === "result" ? "▼ next song · ▲ play again · ◀ songs"
      : "Cut the blocks the way the arrows point!";
    for (const p of ids) kit.status(p.id, { text });
  }, [phase]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (phase !== "play") theme(); }, [phase, cursor, progress]); // eslint-disable-line react-hooks/exhaustive-deps

  const track = TRACKS[Math.min(cursor, TRACKS.length - 1)]!;
  const totalStars = total(progress.stars);
  const nextR = nextReward(CAMPAIGN, progress.stars);
  const owned = unlocked(CAMPAIGN, progress.stars);
  const g = game.current;
  return (
    <div className="tv beat" data-beat={JSON.stringify({ phase, cursor, diff, stars: progress.stars, cal: cal.current })} data-beat-play={testState}>
      <div ref={host} className="beat-host" />

      {phase === "play" && g && (
        <>
          <div className="beat-top">
            <span className="beat-song">{DISTRICTS[g.track.district]!.emoji} {g.track.name} · {DIFF_NAME[g.run.difficulty]}</span>
            <span className="beat-bar"><span style={{ width: `${hud.song * 100}%` }} /></span>
          </div>
          <div className="beat-players">
            {ids.map((p, i) => {
              const h = hud.players[i];
              if (!h) return null;
              const fresh = hud.at - h.popAt < 650;
              return (
                <div key={p.id} className={`beat-card ${h.failed ? "out" : ""}`} style={{ borderColor: p.color }}>
                  {fresh && h.pop && <div className={`beat-pop ${h.popTone}`}>{h.pop}</div>}
                  <div className="beat-name" style={{ color: p.color }}>{p.name}</div>
                  <div className="beat-score">{h.score.toLocaleString("en")}</div>
                  <div className="beat-combo">{h.combo > 1 ? `${h.combo} combo` : "\u00a0"} <b>×{h.mult}</b></div>
                  <div className="beat-health"><span style={{ width: `${h.health * 100}%`, background: h.health < 0.25 ? "#ff3355" : p.color }} /></div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {phase === "calibrate" && (
        <div className="beat-panel center">
          <h1>🎯 Find your timing</h1>
          {calView.done ? (
            <ul className="beat-cal-done">{calView.done.map((l) => <li key={l}>{l}</li>)}</ul>
          ) : (
            <>
              <p className="beat-lead">Swing <b>down</b> on every click. Beat Blade learns your phone and TV's delay, so every cut lands on the beat.</p>
              <div className={`beat-metro ${calView.beat % 2 ? "b" : "a"}`} key={calView.beat}>{calView.beat < 0 ? "Get ready" : 12 - calView.beat}</div>
              <div className="beat-chips">{ids.map((p, i) => <span key={p.id} className="beat-chip" style={{ borderColor: p.color }}>{p.name} · {calView.counts[i]} swings</span>)}</div>
            </>
          )}
        </div>
      )}

      {phase === "menu" && (
        <div className="beat-panel">
          <div className="beat-head">
            <h1>🎵 Beat Blade</h1>
            <span className="beat-total">★ {totalStars} / {TRACKS.length * 3}</span>
            <span className={`beat-diff ${diff}`}>▲ {DIFF_NAME[diff]}</span>
          </div>
          <div className="beat-districts">
            {DISTRICTS.map((d) => (
              <div key={d.id} className="beat-district" style={{ borderColor: d.glow }}>
                <div className="beat-dname" style={{ color: d.glow }}>{d.emoji} {d.name}</div>
                {d.tracks.map((t) => {
                  const i = TRACKS.findIndex((x) => x.id === t.id);
                  const open = isOpen(progress.stars, i);
                  return (
                    <div key={t.id} className={`beat-track ${cursor === i ? "on" : ""} ${open ? "" : "locked"}`} style={cursor === i ? { borderColor: d.glow, boxShadow: `0 0 2vh ${d.glow}` } : undefined}>
                      <span>{open ? t.name : "🔒 " + t.name}</span>
                      <span className="beat-stars">{[0, 1, 2].map((s) => <i key={s} className={s < (progress.stars[i] ?? 0) ? "on" : ""}>★</i>)}</span>
                      <small>{t.bpm} bpm</small>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
          <div className="beat-foot">
            <span className={`beat-btn ${cursor === TRACKS.length ? "on" : ""}`}>🎯 Recalibrate</span>
            <span className={`beat-btn ${cursor === TRACKS.length + 1 ? "on" : ""}`}>✓ Finish</span>
            <span className="beat-rewards">
              {owned.map((r) => <span key={r.id} title={r.name}>{r.emoji}</span>)}
              {nextR && <span className="beat-next">Next: {nextR.emoji} {nextR.name} at ★ {nextR.stars}</span>}
            </span>
          </div>
          <p className="beat-hint">◀ ▶ cut to move · ▼ cut to play · ▲ cut for difficulty · now: <b>{track.name}</b> ({DISTRICTS[track.district]!.name})</p>
        </div>
      )}

      {phase === "story" && (
        <div className="beat-panel center story" style={{ borderColor: district.glow }}>
          <div className="beat-story-emoji">{district.emoji}</div>
          <h1 style={{ color: district.glow }}>{district.name}</h1>
          <p className="beat-lead">{district.story}</p>
          <p className="beat-hint">▼ cut down to start <b>{track.name}</b></p>
        </div>
      )}

      {phase === "result" && result && (
        <div className="beat-panel center">
          <h1>{result.stars ? `${DISTRICTS[track.district]!.emoji} ${track.name} cleared!` : "💥 The power ran out"}</h1>
          <div className="beat-bigstars">{[0, 1, 2].map((s) => <i key={s} className={s < result.stars ? "on" : ""}>★</i>)}</div>
          {result.best && <p className="beat-lead">New best! {result.stars === 3 ? "The district shines." : "More windows light up."}</p>}
          <div className="beat-results">
            {result.per.map((r, i) => (
              <div key={ids[i]!.id} className="beat-res" style={{ borderColor: ids[i]!.color }}>
                <div className="beat-rank">{r.failed ? "✖" : r.rank}</div>
                <div className="beat-name" style={{ color: ids[i]!.color }}>{ids[i]!.name}</div>
                <div>{r.score.toLocaleString("en")} pts</div>
                <div>{Math.round(r.acc * 100)}% · max combo {r.combo}{r.full ? " · FULL COMBO" : ""}</div>
              </div>
            ))}
          </div>
          {result.fresh.length > 0 && <p className="beat-reward">Unlocked: {result.fresh.map((r) => `${r.emoji} ${r.name}`).join(", ")}</p>}
          <p className="beat-hint">▼ next song · ▲ play again · ◀ songs</p>
        </div>
      )}
    </div>
  );
}
