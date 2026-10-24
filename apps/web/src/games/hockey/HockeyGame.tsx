import { useEffect, useRef, useState } from "react";
import type { ControlSpec, GameResult } from "@playwithtv/protocol";
import type { GameProps } from "../types";
import { ControlPlayers } from "../controlKit";
import { ControlTutorial } from "../ControlTutorial";
import { placings } from "../scoring";
import { newTable, step, type Command } from "./engine";
import { cpuCommand, newBrain } from "./cpu";
import { commandFor, newPadMemory, type HockeyMode, type PadMemory } from "./controls";
import { H, W, draw, newView, sparks } from "./render";
import { HockeySfx } from "./audio";

const QUICK = typeof location !== "undefined" && new URLSearchParams(location.search).get("quick") === "1";
const TARGET = QUICK ? 2 : 7;
const DT = 1 / 60;
const CPU_NAMES = ["Robo Rani", "Captain Chip", "Turbo Tara", "Mr. Bolt"];

/**
 * Touchpad first: the phone screen becomes your half of the table, so the striker goes exactly where your
 * finger is (fast and precise). The joystick and tilt are offered too; they drive slower, so they get SMASH.
 */
export const CONTROLS: ControlSpec = {
  title: "Air Hockey Motion",
  modes: ["touchpad", "buttons", "motion"],
  stick: "joystick",
  tilt: "tray",
  actions: [{ id: "smash", label: "💥 SMASH", color: "#ff2bd6", gestures: ["push"], buttonIn: ["buttons"] }],
  hints: {
    touchpad: "Your screen is your half of the table: the striker goes where your finger is",
    buttons: "Joystick moves the striker · SMASH lunges at the puck",
    motion: "Tilt to slide the striker around your half · push towards the TV to smash",
  },
};

/** Air Hockey Motion on the TV: two players head to head, or one player against the CPU. */
export function HockeyGame({ players, bridge, paused, onFinish }: GameProps) {
  const humans = useRef(players.filter((p) => p.connected).slice(0, 2)).current;
  const kit = useRef<ControlPlayers | null>(null);
  kit.current ??= new ControlPlayers(bridge, humans.map((p) => p.id), CONTROLS);
  const [practising, setPractising] = useState(true);
  useEffect(() => {
    kit.current!.start();
    return () => kit.current!.dispose();
  }, []);
  if (practising) {
    return (
      <div className="tv" style={{ background: "#0b0726" }}>
        <ControlTutorial title="🏒 Air Hockey Motion" players={humans} kit={kit.current} practice={[]} quick={QUICK} onDone={() => setPractising(false)} />
      </div>
    );
  }
  return <Rink humans={humans} kit={kit.current} bridge={bridge} paused={paused} onFinish={onFinish} />;
}

function Rink({ humans, kit, bridge, paused, onFinish }: Omit<GameProps, "players"> & { humans: GameProps["players"]; kit: ControlPlayers }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [debug, setDebug] = useState("");
  const pausedRef = useRef(paused);
  pausedRef.current = paused;

  useEffect(() => {
    const ctx = canvas.current!.getContext("2d")!;
    const [p1, p2] = humans;
    if (!p1) return;
    const ids: [string, string] = [p1.id, p2?.id ?? "cpu"];
    const cpuName = CPU_NAMES[Math.floor(Math.random() * CPU_NAMES.length)]!;
    const names: [string, string] = [p1.name, p2?.name ?? `🤖 ${cpuName}`];
    const view = newView([p1.color, p2?.color ?? "#f5b700"], names);
    const table = newTable(TARGET, Date.now() % 100000);
    const brain = p2 ? null : newBrain(1);
    const mem: [PadMemory, PadMemory] = [newPadMemory(0), newPadMemory(1)];
    const smash: [boolean, boolean] = [false, false];
    const sfx = new HockeySfx();
    const startedAt = Date.now();
    const human = (side: 0 | 1) => ids[side] !== "cpu";
    let ready = QUICK ? 1.2 : 2;
    let finishedAt = 0, reported = false, lastStatus = 0;

    const offAction = kit.onAction((pid, action) => {
      const side = ids.indexOf(pid);
      if (side >= 0 && action === "smash") smash[side as 0 | 1] = true;
    });
    const cmdFor = (side: 0 | 1): Command | null => {
      if (!human(side)) return cpuCommand(table, brain!, DT);
      const id = ids[side];
      const r = kit.get(id);
      const c = commandFor(side, kit.mode(id) as HockeyMode, { ok: r.ok, x: r.x, y: r.y }, mem[side], smash[side]);
      smash[side] = false;
      return c;
    };
    view.banner = { text: "FACE OFF", sub: `${names[0]}  vs  ${names[1]}`, color: "#7cf2ff", t: 0, dur: ready };

    let raf = 0, last = performance.now(), acc = 0, frames = 0, fps = 0, fpsT = last;
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      frames++;
      if (now - fpsT >= 1000) { fps = frames; frames = 0; fpsT = now; }
      const real = Math.min(0.1, (now - last) / 1000);
      last = now;
      const live = !pausedRef.current;
      if (live) {
        acc += real;
        while (acc >= DT) {
          acc -= DT;
          if (ready > 0) { ready -= DT; continue; }
          for (const e of step(table, DT, [cmdFor(0), cmdFor(1)])) {
            if (e.kind === "hit") {
              sfx.hit(e.speed);
              const s = table.strikers[e.side];
              if (e.speed > 1.2) sparks(view, (s.x + table.puck.x) / 2, (s.y + table.puck.y) / 2, 8, "#ffd23f");
              if (human(e.side)) bridge.event(ids[e.side], "vibrate", { ms: e.speed > 1.5 ? 40 : 15 });
            } else if (e.kind === "rail") sfx.rail(e.speed);
            else if (e.kind === "smash") sfx.smash();
            else if (e.kind === "timeout") {
              view.banner = { text: "7 SECONDS!", sub: "The puck goes to the other side", color: "#ffd23f", t: 0, dur: 1.6 };
              if (human(e.side)) kit.toast(ids[e.side], "Too long on your side!", "bad");
            } else if (e.kind === "goal") {
              sfx.goal();
              view.flash[e.scorer === 0 ? 1 : 0] = 1.4;
              sparks(view, e.scorer === 0 ? 1 : -1, 0, 30, view.colors[e.scorer]);
              view.banner = { text: "GOAL!", sub: `${names[e.scorer]}  ${e.score[0]} : ${e.score[1]}`, color: view.colors[e.scorer], t: 0, dur: 1.5 };
              if (human(e.scorer)) kit.toast(ids[e.scorer], "GOAL! 🎉", "good");
              const other = e.scorer === 0 ? 1 : 0;
              if (human(other)) { kit.toast(ids[other], "They scored. Your serve!", "bad"); bridge.event(ids[other], "vibrate", { ms: 200 }); }
            } else if (e.kind === "win") {
              sfx.win();
              view.banner = { text: `${names[e.winner]} wins!`, sub: `${table.score[0]} : ${table.score[1]}`, color: "#ffd23f", t: 0, dur: 99 };
              sparks(view, 0, 0, 50, "#ffd23f");
              for (const side of [0, 1] as const) {
                if (!human(side)) continue;
                const won = side === e.winner;
                kit.outcome(ids[side], won ? "You won the match!" : `You lost ${table.score[side]} : ${table.score[side === 0 ? 1 : 0]}`, won ? "🏆" : "🏒");
              }
            }
          }
        }
      }
      draw(ctx, table, view, live ? real : 0);
      if (now - lastStatus > 250) {
        lastStatus = now;
        for (const side of [0, 1] as const) {
          if (!human(side) || table.phase === "over") continue;
          kit.status(ids[side], { text: `You ${table.score[side]} : ${table.score[side === 0 ? 1 : 0]} ${names[side === 0 ? 1 : 0]} · first to ${TARGET}` });
        }
        const s = table.strikers;
        setDebug(JSON.stringify({
          phase: ready > 0 ? "ready" : table.phase, score: table.score, winner: table.winner, fps, time: +table.time.toFixed(1),
          puck: { x: +table.puck.x.toFixed(3), y: +table.puck.y.toFixed(3), vx: +table.puck.vx.toFixed(2), vy: +table.puck.vy.toFixed(2) },
          strikers: s.map((x) => ({ x: +x.x.toFixed(3), y: +x.y.toFixed(3), hits: x.hits })),
        }));
      }
      if (table.phase === "over") {
        if (!finishedAt) finishedAt = now;
        if (!reported && now - finishedAt > (QUICK ? 2500 : 4500)) {
          reported = true;
          let results: GameResult[];
          if (p2) results = placings(new Map([[p1.id, table.score[0]], [p2.id, table.score[1]]]));
          else results = [{ playerId: p1.id, score: table.score[0], place: table.winner === 0 ? 1 : 2 }];
          onFinish(results, Date.now() - startedAt);
        }
      }
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      offAction();
      sfx.dispose();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div style={{ position: "absolute", inset: 0, background: "#06030f" }} data-hockey={debug}>
      <canvas ref={canvas} width={W} height={H} style={{ width: "100%", height: "100%", display: "block" }} />
      {paused && <div className="paused-overlay"><div className="big-title">⏸ Paused</div><p className="hint">Reconnecting…</p></div>}
    </div>
  );
}
