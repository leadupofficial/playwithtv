import { useEffect, useRef, useState } from "react";
import type { GameResult } from "@scp/protocol";
import { STRONG } from "@scp/motion";
import type { GameProps } from "../types";
import { AVATARS } from "../../avatars";
import {
  NO_CONTROLS, ROUND_SECONDS, cpuControls, facing, makeFighter, newBrain, newFight, step,
  type Controls, type Fight, type FightEvent,
} from "./engine";
import { H, W, animate, draw, newView, type View } from "./render";
import { Sfx } from "./audio";
import { MotionPlayers, type MotionControl } from "../motionKit";
import { MotionTutorial } from "../MotionTutorial";

const QUICK = typeof location !== "undefined" && new URLSearchParams(location.search).get("quick") === "1";
const CPU_NAMES = ["Tiger Mani", "Iron Selvam", "Thunder Raja", "Cobra Kumar"];
export const CONTROLS: MotionControl[] = [
  { motion: "push", label: "jab (push hard: power punch)" },
  { motion: "flick-left", label: "hook (or flick right)" },
  { motion: "flick-up", label: "uppercut" },
  { motion: "pitch", label: "tip forward: step in · back: step out · far back: guard" },
  { motion: "roll", label: "lean to slip a punch" },
  { motion: "shake", label: "get up after a knockdown" },
];

// Tilt thresholds on the normalised pitch/roll axes (≈ degrees past the dead zone / 28)
const STEP_IN = 0.35, STEP_OUT = -0.3, GUARD = -0.6, SLIP = 0.9;

type Punch = "jab" | "hook" | "upper" | "super" | "dodge" | "mash";

/** Ring Kings Boxing on the TV: one player against the CPU, or two players head to head. Motion only. */
export function BoxingGame({ players, bridge, paused, onFinish, sponsor }: GameProps) {
  const humans = useRef(players.filter((p) => p.connected).slice(0, 2)).current;
  const kit = useRef<MotionPlayers | null>(null);
  kit.current ??= new MotionPlayers(bridge, humans.map((p) => p.id));
  const [practising, setPractising] = useState(true);
  useEffect(() => {
    kit.current!.start();
    kit.current!.controls("all", "Ring Kings Boxing", CONTROLS);
    return () => kit.current!.dispose();
  }, []);
  if (practising) {
    return (
      <div className="tv" style={{ background: "#07051a" }}>
        <MotionTutorial title="🥊 Ring Kings Boxing" players={humans} kit={kit.current} controls={CONTROLS} practice={["push", "flick-up"]} quick={QUICK} onDone={() => setPractising(false)} />
      </div>
    );
  }
  return <Fight humans={humans} kit={kit.current} bridge={bridge} paused={paused} onFinish={onFinish} sponsor={sponsor} />;
}

function Fight({ humans, kit, bridge, paused, onFinish, sponsor }: Omit<GameProps, "players"> & { humans: GameProps["players"]; kit: MotionPlayers }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [debug, setDebug] = useState("");
  const pausedRef = useRef(paused);
  pausedRef.current = paused;

  useEffect(() => {
    const [p1, p2] = humans;
    if (!p1) return;
    const a = makeFighter(p1.id, p1.name, p1.color, -1, false, p1.id.charCodeAt(0));
    const cpuName = CPU_NAMES[Math.floor(Math.random() * CPU_NAMES.length)]!;
    const b = p2
      ? makeFighter(p2.id, p2.name, p2.color, 1, false, p2.id.charCodeAt(1))
      : makeFighter("cpu", cpuName, "#f5b700", 1, true, 3);
    const fight: Fight = newFight(a, b, QUICK ? 15 : ROUND_SECONDS);
    const emoji: Record<string, string> = { cpu: "🤖" };
    for (const p of humans) emoji[p.id] = AVATARS[p.avatar].emoji;
    const view: View = newView(fight, emoji);
    view.sponsor = sponsor?.name;
    const sfx = new Sfx();
    const brain = newBrain();
    const pending = new Map<string, Punch[]>(humans.map((p) => [p.id, []]));
    const leaning = new Map<string, boolean>();
    const startedAt = Date.now();
    let finishedAt = 0;
    let reported = false;
    let lastStatus = 0;
    let lastCount = -1;
    let rand = 12345;
    const rnd = () => ((rand = (rand * 16807) % 2147483647) / 2147483647);

    const fighterOf = (id: string) => (id === a.id ? a : b);
    const offGesture = kit.onGesture((pid, g) => {
      const q = pending.get(pid);
      if (!q) return;
      if (fighterOf(pid).state === "down") return void q.push("mash"); // any move counts towards getting up
      if (g.kind === "shake") return;
      const punch: Punch = g.kind === "push" ? (g.strength >= STRONG ? (fighterOf(pid).superMeter >= 1 ? "super" : "upper") : "jab")
        : g.kind === "flick-left" || g.kind === "flick-right" ? "hook"
        : g.kind === "flick-up" ? "upper"
        : "jab";
      if (q.length < 3) q.push(punch);
    });

    /** Turns a phone's tilt and queued gestures into this step's controls (one action per step). */
    const controlsFor = (id: string): Controls => {
      const q = pending.get(id);
      if (!q) return NO_CONTROLS;
      const m = kit.get(id);
      const me = fighterOf(id);
      const forward = facing(me, me === a ? b : a) === 1 ? "right" : "left";
      const back = forward === "right" ? "left" : "right";
      const c: Controls = { ...NO_CONTROLS, mash: 0 };
      if (m.ok) {
        c.block = m.pitch < GUARD;
        if (m.pitch > STEP_IN) c[forward] = true;
        else if (m.pitch < STEP_OUT && !c.block) c[back] = true;
        const lean = Math.abs(m.roll) > SLIP;
        if (lean && !leaning.get(id)) c.dodge = true;
        leaning.set(id, lean);
      }
      c.mash = q.filter((x) => x === "mash").length;
      const rest = q.filter((x) => x !== "mash");
      const next = rest.shift() as Exclude<Punch, "mash"> | undefined;
      if (next) c[next] = true;
      pending.set(id, rest);
      return c;
    };

    const human = (id: string) => pending.has(id);
    const nameOf = (id: string) => (id === a.id ? a.name : b.name);
    const outcome = (id: string, r: "won" | "lost" | "draw") =>
      bridge.event(id, "outcome", r === "won" ? { text: "You won the fight!", emoji: "🏆" } : r === "draw" ? { text: "It's a draw!", emoji: "🤝" } : { text: "You lost this one", emoji: "🥊" });
    const handle = (ev: FightEvent[]) => {
      for (const e of ev) {
        if (e.kind === "hit") {
          sfx.punch(e.heavy);
          const target = e.on === a.id ? a : b;
          const word = e.punch === "super" ? "SUPER!" : e.punch === "upper" ? "BOOM!" : e.combo >= 3 ? `COMBO x${e.combo}!` : e.punch === "hook" ? "POW!" : "BAM!";
          view.bursts.push({ x: target.x, y: 300, text: word, color: e.heavy ? "#e2384d" : "#fff", t: 0, big: e.heavy });
          if (human(e.on)) bridge.event(e.on, "vibrate", { ms: e.heavy ? 220 : 70 });
          if (e.heavy) sfx.crowd(1);
        } else if (e.kind === "blocked") {
          sfx.block();
          const target = e.on === a.id ? a : b;
          view.bursts.push({ x: target.x, y: 290, text: "BLOCK", color: "#6fc3ff", t: 0, big: false });
        } else if (e.kind === "slipped") {
          sfx.whiff();
          const target = e.on === a.id ? a : b;
          view.bursts.push({ x: target.x, y: 270, text: "SLIP!", color: "#7cf29c", t: 0, big: false });
        } else if (e.kind === "whiff") {
          sfx.whiff();
        } else if (e.kind === "down") {
          sfx.crowd(2.2);
          view.banner = { text: "DOWN!", color: "#ff5d73", t: 0, dur: 1.2 };
          if (human(e.on)) {
            kit.toast(e.on, "DOWN! Shake your phone to get up", "bad");
            bridge.event(e.on, "vibrate", { ms: 600 });
          }
        } else if (e.kind === "up") {
          view.banner = { text: "BACK UP!", color: "#7cf29c", t: 0, dur: 1.2 };
          if (human(e.on)) kit.toast(e.on, "Back up!", "good");
        } else if (e.kind === "ko") {
          sfx.bell(3);
          sfx.crowd(3);
          view.banner = { text: e.tko ? "T.K.O.!" : "K.O.!", sub: `${nameOf(e.winner)} wins!`, color: "#ffd23f", t: 0, dur: 5 };
          for (const id of pending.keys()) outcome(id, id === e.winner ? "won" : "lost");
        } else if (e.kind === "bell") {
          sfx.bell(1);
          view.banner = { text: `ROUND ${e.round}`, sub: "FIGHT!", color: "#fff", t: 0, dur: 1.6 };
        } else if (e.kind === "round-end") {
          sfx.bell(2);
          view.banner = { text: "END OF ROUND", color: "#fff", t: 0, dur: 2.5 };
        } else if (e.kind === "decision") {
          sfx.crowd(3);
          view.banner = { text: "DECISION", sub: e.winner ? `${nameOf(e.winner)} wins on points!` : "It's a draw!", color: "#ffd23f", t: 0, dur: 5 };
          for (const id of pending.keys()) outcome(id, e.winner === null ? "draw" : id === e.winner ? "won" : "lost");
        }
      }
    };

    view.banner = { text: "RING KINGS", sub: `${a.name}  vs  ${b.name}`, color: "#ffd23f", t: 0, dur: 2.4 };
    const ctx = canvas.current!.getContext("2d")!;
    let raf = 0;
    let last = performance.now();
    let acc = 0;
    const DT = 1 / 60;
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const real = Math.min(0.1, (now - last) / 1000);
      last = now;
      if (pausedRef.current) return;
      acc += real;
      while (acc >= DT) {
        acc -= DT;
        const ca = controlsFor(a.id);
        const cb = b.cpu ? cpuControls(fight, b, brain, DT, rnd) : controlsFor(b.id);
        handle(step(fight, DT, ca, cb));
        animate(view, fight, DT, rnd);
      }
      const down = fight.a.state === "down" || fight.b.state === "down";
      if (down && Math.floor(fight.count) !== lastCount) {
        lastCount = Math.floor(fight.count);
        sfx.tick();
      }
      if (!down) lastCount = -1;
      draw(ctx, fight, view);
      if (now - lastStatus > 250) {
        lastStatus = now;
        for (const x of [a, b]) {
          if (!human(x.id)) continue;
          kit.status(x.id, {
            text: x.state === "down" ? `Shake to get up! ${x.mashCount}/${x.mashNeeded}` : `Round ${fight.round}`,
            bars: [
              { label: "Health", value: x.hp / 100, color: x.hp > 30 ? "#3ee08f" : "#ffd23f" },
              { label: "Stamina", value: x.stamina / 100, color: "#ffd23f" },
              { label: "Super", value: Math.min(1, x.superMeter), color: "#2f8cff" },
            ],
          });
        }
        setDebug(JSON.stringify({ phase: fight.phase, round: fight.round, hpA: Math.round(a.hp), hpB: Math.round(b.hp), landedA: a.landed, thrownA: a.thrown, xA: Math.round(a.x), xB: Math.round(b.x), winner: fight.winner }));
      }
      if (fight.phase === "over") {
        if (!finishedAt) finishedAt = now;
        if (!reported && now - finishedAt > 5500) {
          reported = true;
          const results: GameResult[] = [];
          for (const x of [a, b]) {
            if (!human(x.id)) continue;
            const place = fight.winner === null || fight.winner === x.id ? 1 : 2;
            results.push({ playerId: x.id, score: Math.round(x.damageDealt), place });
          }
          onFinish(results, Date.now() - startedAt);
        }
      }
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      offGesture();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", background: "#07051a" }} data-fight={debug}>
      <canvas ref={canvas} width={W} height={H} style={{ width: "100%", height: "100%", objectFit: "contain" }} />
      {paused && <div className="paused-overlay"><div className="big-title">⏸ Paused</div><p className="hint">Reconnecting…</p></div>}
    </div>
  );
}
