import { useEffect, useRef, useState } from "react";
import type { PlayerView } from "@playwithtv/protocol";
import type { GameProps } from "../types";
import type { ControlSpec } from "@playwithtv/protocol";
import { ControlPlayers } from "../controlKit";
import { ControlTutorial } from "../ControlTutorial";
import { placings } from "../scoring";
import { AVATARS } from "../../avatars";
import { t } from "../../i18n";
import { LEVELS } from "./levels";
import { levelPoints, newMaze, parseLevel, stepMaze, type MazeState } from "./physics";
import { MazeScene } from "./scene";
import { Chimes } from "./sound";
import "./maze.css";

const QUICK = typeof location !== "undefined" && new URLSearchParams(location.search).get("quick") === "1";
const LEVEL_DEFS = QUICK ? LEVELS.slice(0, 1) : LEVELS;
const CONTROLS: ControlSpec = {
  title: "Gravity Maze 3D",
  modes: ["motion", "buttons", "touchpad"],
  stick: "joystick",
  tilt: "tray",
  grip: "any",
  actions: [],
  hints: {
    motion: "Hold the phone flat like a tray and tilt it",
    buttons: "Push the joystick the way you want the maze to tip",
    touchpad: "Touch and drag towards where the ball should roll",
  },
};
const DT = 1 / 60;

/** Gravity Maze 3D: phone held flat like a tray tilts the board. Players take turns on the same levels. */
export function MazeGame({ players, bridge, paused, onFinish }: GameProps) {
  const order = useRef(players.filter((p) => p.connected).slice(0, 4)).current;
  const kit = useRef<ControlPlayers | null>(null);
  kit.current ??= new ControlPlayers(bridge, order.map((p) => p.id), CONTROLS);
  const [practising, setPractising] = useState(true);
  useEffect(() => {
    kit.current!.start();
    return () => kit.current!.dispose();
  }, []);
  if (practising) {
    return (
      <div className="tv maze-tv">
        <ControlTutorial title="🌀 Gravity Maze 3D" players={order} kit={kit.current}
          practice={[]} quick={QUICK} onDone={() => setPractising(false)} />
      </div>
    );
  }
  return <MazePlay order={order} kit={kit.current} paused={paused} onFinish={onFinish} />;
}

type Phase = "turn" | "play" | "cleared" | "done";
interface Hud { phase: Phase; player: number; level: number; time: number; coins: number; falls: number; message: string }

function MazePlay({ order, kit, paused, onFinish }: { order: PlayerView[]; kit: ControlPlayers; paused: boolean; onFinish: GameProps["onFinish"] }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const [hud, setHud] = useState<Hud>({ phase: "turn", player: 0, level: 0, time: 0, coins: 0, falls: 0, message: "" });
  const [debug, setDebug] = useState("");
  const [totals] = useState(() => new Map(order.map((p) => [p.id, 0])));

  useEffect(() => {
    const scene = new MazeScene(canvas.current!);
    const sfx = new Chimes();
    let player = 0, level = 0;
    let phase: Phase = "turn";
    let phaseT = 0;
    let state: MazeState = newMaze(parseLevel(LEVEL_DEFS[0]!));
    let message = "";
    let messageT = 0;
    const startedAt = Date.now();

    const say = (text: string) => { message = text; messageT = 2; };
    const current = () => order[player]!;
    const announceTurn = () => {
      for (const p of order) kit.status(p.id, { text: p.id === current().id ? "Your turn! Tilt the maze" : `Watch: ${current().name} is playing` });
      kit.toast(current().id, "Your turn!", "good");
    };
    const loadLevel = () => {
      state = newMaze(parseLevel(LEVEL_DEFS[level]!));
      scene.setLevel(state.level, current().color);
    };
    loadLevel();
    announceTurn();

    const finishLevel = (reached: boolean) => {
      const pts = levelPoints(state, reached);
      totals.set(current().id, (totals.get(current().id) ?? 0) + pts);
      kit.toast(current().id, reached ? `${t("maze.done")} +${pts}` : `Time's up · +${pts}`, reached ? "good" : "bad");
      phase = "cleared";
      phaseT = 0;
    };

    const nextStep = () => {
      if (level + 1 < LEVEL_DEFS.length) {
        level++;
        loadLevel();
        phase = "play";
      } else if (player + 1 < order.length) {
        player++;
        level = 0;
        loadLevel();
        phase = "turn";
        announceTurn();
      } else {
        phase = "done";
        const results = placings(new Map(order.map((p) => [p.id, totals.get(p.id) ?? 0])));
        for (const p of order) {
          const r = results.find((x) => x.playerId === p.id)!;
          if (r.place === 1) kit.outcome(p.id, order.length > 1 ? "You won the maze!" : "Maze complete!", "🏆");
          else kit.outcome(p.id, `You came #${r.place}`, "🌀");
        }
        setTimeout(() => onFinish(results, Date.now() - startedAt), 2500);
      }
      phaseT = 0;
    };

    let raf = 0, last = performance.now(), acc = 0, lastHud = 0, frames = 0, fps = 0, fpsT = performance.now();
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      frames++;
      if (now - fpsT >= 1000) { fps = frames; frames = 0; fpsT = now; }
      const real = Math.min(0.1, (now - last) / 1000);
      last = now;
      const m = kit.get(current().id);
      // x right, y forward/up: the ball rolls the way the board (or the stick) points
      const tiltX = phase === "play" && m.ok ? m.x : 0;
      const tiltY = phase === "play" && m.ok ? -m.y : 0;
      if (!pausedRef.current) {
        acc += real;
        phaseT += real;
        messageT -= real;
        while (acc >= DT) {
          acc -= DT;
          if (phase !== "play") continue;
          for (const e of stepMaze(state, DT, tiltX, tiltY)) {
            if (e.kind === "fell") { say(t("maze.fell")); sfx.fall(); kit.toast(current().id, "Fell in!", "bad"); }
            if (e.kind === "checkpoint") { say(t("maze.checkpoint")); sfx.chime(660); }
            if (e.kind === "coin") sfx.chime(990);
            if (e.kind === "bump") sfx.bump(e.speed);
            if (e.kind === "goal") { sfx.win(); finishLevel(true); }
            if (e.kind === "timeout") finishLevel(false);
          }
        }
        if (phase === "turn" && phaseT > (QUICK ? 1 : 2.5)) { phase = "play"; phaseT = 0; }
        if (phase === "cleared" && phaseT > 2) nextStep();
      }
      scene.render(state, tiltX, tiltY, real);
      if (now - lastHud > 100) {
        lastHud = now;
        setHud({ phase, player, level, time: state.time, coins: state.coins.size, falls: state.falls, message: messageT > 0 ? message : "" });
        setDebug(JSON.stringify({ phase, player, level, x: +state.ball.x.toFixed(2), y: +state.ball.y.toFixed(2), done: state.done, fps, totals: Object.fromEntries(totals) }));
      }
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      scene.dispose();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const p = order[hud.player]!;
  const def = LEVEL_DEFS[hud.level]!;
  return (
    <div className="maze" data-maze={debug}>
      <canvas ref={canvas} className="maze-canvas" />
      <div className="maze-hud">
        <span className="chip" style={{ borderColor: p.color }}>{AVATARS[p.avatar].emoji} {p.name}</span>
        <span className="chip">{t("maze.level", { n: hud.level + 1 })}: {def.name}</span>
        <span className="chip">⏱ {Math.max(0, def.timeLimit - hud.time).toFixed(0)}s</span>
        <span className="chip">🪙 {hud.coins}</span>
        {order.length > 1 && <span className="chip">🏁 {order.map((o) => `${o.name} ${totals.get(o.id) ?? 0}`).join(" · ")}</span>}
      </div>
      {hud.phase === "turn" && <div className="maze-banner" style={{ color: p.color }}>{t("maze.turn", { name: p.name })}<small>{t("maze.goal")}</small></div>}
      {hud.phase === "cleared" && <div className="maze-banner">{t("maze.done")}</div>}
      {hud.message && <div className="maze-toast">{hud.message}</div>}
      {paused && <div className="paused-overlay"><div className="big-title">⏸ Paused</div><p className="hint">Reconnecting…</p></div>}
    </div>
  );
}
