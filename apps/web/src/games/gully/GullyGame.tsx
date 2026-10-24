import { useEffect, useRef, useState } from "react";
import type { ControlSpec, PlayerView } from "@playwithtv/protocol";
import type { GameProps } from "../types";
import { ControlPlayers } from "../controlKit";
import { ControlTutorial } from "../ControlTutorial";
import { showAwards } from "../kit3d/podium";
import { useQuality } from "../../quality/store";
import { newGame, step, type Game, type GameEvent, type Inputs } from "./sim/game";
import { makeTeams, playerScores, TEAM_LOOKS } from "./sim/match";
import { awards } from "./sim/awards";
import { commentary } from "./sim/commentary";
import { describePlan } from "./sim/delivery";
import { AimLatch, BAT_SPEC, BOWL_SPEC, TUTORIAL_SPEC, WATCH_SPEC, swingFrom } from "./controls";
import { boardState, MOMENT_WORDS, TIMING_WORDS, type BoardState } from "./board";
import { Hud, type Card, type Line, type Pop } from "./Hud";
import { GullySound } from "./audio";
import { loadLaneMeta, type GullyView, type Look } from "./view/types";

export { BAT_SPEC as CONTROLS };
const QUICK = typeof location !== "undefined" && new URLSearchParams(location.search).get("quick") === "1";
const DT = 1 / 60;
const CPU_NAMES = ["Chintu", "Pinky", "Golu", "Munni", "Bablu", "Tinku", "Kavya", "Arjun"];
const MAX = 8;

/** Gully Super Over on the TV: 2 teams of street cricketers, a super over each, a bowl-out if tied. */
export function GullyGame({ players, bridge, paused, onFinish }: GameProps) {
  const humans = useRef(players.filter((p) => p.connected).slice(0, MAX)).current;
  const kit = useRef<ControlPlayers | null>(null);
  kit.current ??= new ControlPlayers(bridge, humans.map((p) => p.id), TUTORIAL_SPEC);
  const [practising, setPractising] = useState(true);
  useEffect(() => {
    kit.current!.start();
    return () => kit.current!.dispose();
  }, []);
  if (practising) {
    return (
      <div className="tv" style={{ background: "#2a1830" }}>
        <ControlTutorial title="🏏 Gully Super Over" players={humans} kit={kit.current} practice={["swing"]} quick={QUICK} onDone={() => setPractising(false)} />
      </div>
    );
  }
  return <Match humans={humans} kit={kit.current} bridge={bridge} paused={paused} onFinish={onFinish} />;
}

function Match({ humans, kit, bridge, paused, onFinish }: { humans: PlayerView[]; kit: ControlPlayers; bridge: GameProps["bridge"]; paused: boolean; onFinish: GameProps["onFinish"] }) {
  const { profile, tier, ready } = useQuality();
  const canvas = useRef<HTMLCanvasElement>(null);
  const overlay = useRef<HTMLDivElement>(null);
  const backdrop = useRef<HTMLImageElement>(null);
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const [debug, setDebug] = useState("");
  const [board, setBoard] = useState<BoardState | null>(null);
  const [pop, setPop] = useState<Pop | null>(null);
  const [line, setLine] = useState<Line | null>(null);
  const [card, setCard] = useState<Card | null>(null);
  const [intro, setIntro] = useState(true);
  const [progress, setProgress] = useState(0);
  const [failed, setFailed] = useState("");

  useEffect(() => {
    if (!ready) return;
    let alive = true, raf = 0, view: GullyView | null = null;
    const members = makeTeams(humans.map((p) => ({ id: p.id, name: p.name, color: p.color })), CPU_NAMES);
    const perInnings = QUICK ? 3 : humans.length > 4 ? 12 : 6;
    const g: Game = newGame(members, { ballsPerInnings: perInnings, bowlOutBalls: 3, maxSuddenDeath: 4 }, { quick: QUICK, seed: (Math.random() * 2 ** 31) >>> 0 });
    const looks = new Map<string, Look>(members.map((m, i) => [m.id, {
      name: m.name, team: m.team, color: m.cpu ? TEAM_LOOKS[m.team]!.color : m.color, teamColor: TEAM_LOOKS[m.team]!.color, model: i % 3, cpu: m.cpu,
    }]));
    const human = (id: string | null | undefined) => !!id && !g.match.members.get(id)?.cpu;
    const sound = new GullySound();
    void sound.load();
    const latch = new AimLatch();
    let pending: Inputs = {};
    const got = new Map<string, Record<string, number>>(humans.map((p) => [p.id, {}]));
    const specs = new Map<string, string>();
    let lastTiming = "", popId = 0, results: string[] = [];
    const startedAt = Date.now();

    const offAction = kit.onAction((id, action) => {
      const c = got.get(id);
      if (c) c[action] = (c[action] ?? 0) + 1;
      const b = g.ball;
      if (!b) return;
      if (id === b.bowler && g.phase === "aim") {
        if (action === "pace" || action === "spin") {
          latch.kind = action;
          kit.toast(id, action === "pace" ? "⚡ Pace" : "🌀 Spin", "info");
        }
        if (action === "bowl") pending = { ...pending, aim: latch.release(performance.now() / 1000), release: true };
      }
      if (id === b.batter && (action === "swing" || action === "defend") && (g.phase === "runup" || g.phase === "delivery")) {
        const r = kit.get(id);
        const mode = kit.mode(id) === "motion" ? "motion" : "buttons";
        pending = { ...pending, swing: swingFrom(action, mode, r.gesture, { x: r.x, y: r.y }) };
      }
      if (action === "cheer") sound.roar(0.25);
    });

    const say = (text: string, color: string, big = false, sub?: string) => setPop({ id: ++popId, text, color, big, sub });
    const sendRoles = () => {
      const b = g.ball;
      for (const p of humans) {
        const spec: ControlSpec = b && p.id === b.bowler ? BOWL_SPEC : b && p.id === b.batter ? BAT_SPEC : WATCH_SPEC;
        if (specs.get(p.id) === spec.title) continue;
        specs.set(p.id, spec.title);
        bridge.layout(p.id, "game", spec as unknown as Record<string, unknown>);
      }
    };

    const onEvents = (events: GameEvent[]) => {
      sound.handle(events);
      for (const e of events) {
        if (e.kind === "phase") {
          if (e.phase === "aim") {
            latch.reset();
            sendRoles();
            const b = g.ball!;
            if (b.batter && g.match.teams[g.match.batting].balls === g.match.cfg.ballsPerInnings - 1 && g.match.stage <= 1) {
              const c = commentary("last-ball", b.n);
              setLine({ id: ++popId, ...c });
            }
          }
          if (e.phase !== "intro") setIntro(false);
        }
        if (e.kind === "innings") {
          const m = g.match;
          const team = m.teams[e.batting];
          const sub = m.stage === 1 ? `Target ${m.teams[m.firstBat].runs + 1} off ${m.cfg.ballsPerInnings} balls` : m.stage === 2 ? "Bowl-out: hit the bricks!" : `${m.cfg.ballsPerInnings} balls · everyone bats`;
          setCard(m.stage === 2 ? { id: ++popId, title: "TIE! BOWL-OUT", sub, color: "#ffd23f" } : { id: ++popId, title: `${team.name} bat`, sub, color: team.color });
          const c = commentary(m.stage === 2 ? "tie" : m.stage === 1 ? "chase" : "innings", g.count);
          setLine({ id: ++popId, ...c });
          setTimeout(() => alive && setCard(null), QUICK ? 1300 : 2500);
        }
        if (e.kind === "swing") {
          lastTiming = e.timing;
          const w = TIMING_WORDS[e.timing];
          if (e.contact || e.timing === "miss") say(w.text, w.color);
          if (human(e.batter)) kit.toast(e.batter, w.text, e.timing === "perfect" || e.timing === "good" ? "good" : "bad");
        }
        if (e.kind === "hit" && human(e.ball.batter)) bridge.event(e.ball.batter!, "vibrate", { ms: e.shot.timing === "perfect" ? 120 : 50 });
        if (e.kind === "result") {
          const w = MOMENT_WORDS[e.moment];
          const shot = e.ball.shot?.contact ? e.ball.shot.name : "";
          if (w) say(w.text, w.color, w.big, w.big && shot ? shot : undefined);
          const c = commentary(e.moment, e.ball.n);
          setLine({ id: ++popId, ...c });
          results.push(e.moment);
          if (human(e.ball.bowler) && e.ball.result?.wicket) kit.toast(e.ball.bowler, "WICKET! 🎉", "good");
        }
        if (e.kind === "over") finish();
      }
    };

    const finish = () => {
      const m = g.match;
      const win = m.winner ?? 0;
      const team = m.teams[win];
      setCard({ id: ++popId, title: `${team.name} WIN!`, sub: m.decided === "bowl-out" ? "in the bowl-out!" : m.decided === "toss" ? "on the coin toss!" : m.decided === "runs" ? `by ${m.teams[win].runs - m.teams[win === 0 ? 1 : 0].runs} runs` : "chased it down!", color: team.color });
      setLine({ id: ++popId, ...commentary("win", 0) });
      setTimeout(() => {
        if (!alive) return;
        setCard(null);
        const list = awards(m).map((a) => ({ emoji: a.emoji, title: a.title, name: m.members.get(a.playerId)!.name, color: looks.get(a.playerId)!.color, detail: a.detail }));
        if (overlay.current) showAwards(overlay.current, `🏆 ${team.name}`, list, QUICK ? 300 : 700);
      }, QUICK ? 1500 : 3000);
      for (const p of humans) {
        const mine = m.members.get(p.id)!.team === win;
        kit.outcome(p.id, mine ? `${team.name} win! 🏏` : `${team.name} win`, mine ? "🏆" : "🏏");
      }
      const scores = playerScores(m);
      setTimeout(() => {
        if (!alive) return;
        onFinish(humans.map((p) => ({ playerId: p.id, score: scores.get(p.id) ?? 0, place: m.members.get(p.id)!.team === win ? 1 : 2 })), Date.now() - startedAt);
      }, QUICK ? 7000 : 12000);
    };

    const make = profile.prerendered
      ? import("./view/lite").then((mod) => loadLaneMeta().then((lane) => mod.createLite(canvas.current!, overlay.current!, backdrop.current!, profile, lane, looks, setProgress)))
      : import("./view/scene3d").then((mod) => loadLaneMeta().then((lane) => mod.createScene3D(canvas.current!, overlay.current!, profile, lane, looks, setProgress)));

    make.then((v) => {
      if (!alive) return v.dispose();
      view = v;
      let last = performance.now(), acc = 0, frames = 0, fps = 0, fpsT = last, lastDebug = 0, lastPhone = 0;
      const frame = (now: number) => {
        raf = requestAnimationFrame(frame);
        frames++;
        if (now - fpsT >= 1000) { fps = Math.round((frames * 1000) / (now - fpsT)); frames = 0; fpsT = now; }
        const real = Math.min(0.1, (now - last) / 1000);
        last = now;
        const events: GameEvent[] = [];
        if (!pausedRef.current) {
          // the human bowler's aim follows their pad / stick / tilt
          const b = g.ball;
          if (b && g.phase === "aim" && human(b.bowler)) {
            const r = kit.get(b.bowler);
            const mode = kit.mode(b.bowler);
            latch.feed(r.x, r.y, now / 1000, mode === "motion" || mode === "hybrid");
            pending.aim ??= { ...latch.aim, kind: latch.kind };
          }
          acc += real;
          let n = 0;
          while (acc >= DT && n++ < 6) {
            acc -= DT;
            const input = pending;
            pending = {};
            events.push(...step(g, DT, input));
          }
          if (acc > DT * 6) acc = 0;
          if (events.length) onEvents(events);
        }
        v.frame(g, pausedRef.current ? 0 : real, events);

        if (now - lastDebug > 100) {
          lastDebug = now;
          const b = g.ball;
          const st = v.stats();
          const eta = b?.delivery ? Math.round(((g.phase === "runup" ? g.timings.runup - g.pt : 0) + b.delivery.tContact - (g.phase === "delivery" ? b.t : 0)) * 1000) : null;
          setDebug(JSON.stringify({
            phase: g.phase, stage: g.match.stage, batting: g.match.batting, tier, fps, calls: st.calls, tris: st.tris, camera: st.camera,
            ball: b ? { n: b.n, batter: b.batter, bowler: b.bowler, bowlOut: b.bowlOut, eta: g.phase === "runup" || g.phase === "delivery" ? eta : null, contactAt: eta !== null && (g.phase === "runup" || g.phase === "delivery") ? Date.now() + eta : null, kind: b.delivery?.plan.kind ?? null } : null,
            teams: g.match.teams.map((t) => ({ runs: t.runs, wickets: t.wickets, balls: t.balls })), winner: g.match.winner, decided: g.match.decided,
            timing: lastTiming, results, got: Object.fromEntries(got), humans: humans.map((p) => ({ id: p.id, name: p.name, team: g.match.members.get(p.id)!.team })),
          }));
          setBoard(boardState(g));
        }
        if (now - lastPhone > 300) {
          lastPhone = now;
          const b = g.ball;
          for (const p of humans) {
            if (!b || g.phase === "podium") continue;
            if (p.id === b.bowler && g.phase === "aim") {
              const d = describePlan({ ...latch.aim, kind: latch.kind });
              kit.status(p.id, { text: `🎯 ${d.length} · ${d.line} · ${latch.kind === "pace" ? "⚡ Pace" : "🌀 Spin"}`, bars: [
                { label: "Length", value: latch.aim.length, color: "#ffb703" }, { label: "Line", value: (latch.aim.line + 1.4) / 2.8, color: "#2f9bff" },
              ] });
            } else if (p.id === b.batter) kit.status(p.id, { text: g.phase === "aim" ? "🏏 Get ready…" : "🏏 Watch the ball — swing!" });
            else if (p.id === b.bowler) kit.status(p.id, { text: "⚾ Bowling…" });
            else {
              const t = g.match.teams[g.match.batting];
              kit.status(p.id, { text: `${t.name} ${t.runs}/${t.wickets}` });
            }
          }
        }
      };
      raf = requestAnimationFrame(frame);
    }).catch((e) => alive && setFailed(String(e)));

    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      offAction();
      view?.dispose();
      sound.dispose();
    };
  }, [ready]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="gso-root" data-gully={debug}>
      <img ref={backdrop} className="gso-backdrop" alt="" style={{ display: profile.prerendered ? "block" : "none" }} />
      <canvas ref={canvas} width={profile.resolution.w} height={profile.resolution.h} />
      <div ref={overlay} style={{ position: "absolute", inset: 0, pointerEvents: "none" }} />
      <Hud s={board} pop={pop} line={line} card={card} />
      {intro && debug && (
        <div className="gso-intro">
          <div className="gso-title">GULLY<br />SUPER OVER</div>
          <div className="gso-tagline">One over. One lane. Don't break the windows… or do!</div>
        </div>
      )}
      {!debug && !failed && <div className="gso-loading">🏏 Setting up the bricks… {Math.round(progress * 100)}%</div>}
      {failed && <div className="paused-overlay"><div className="big-title">Couldn't load the gully</div><p className="hint">{failed}</p></div>}
      {paused && <div className="paused-overlay"><div className="big-title">⏸ Paused</div><p className="hint">Reconnecting…</p></div>}
    </div>
  );
}
