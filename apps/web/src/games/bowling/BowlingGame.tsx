import { useEffect, useRef, useState } from "react";
import type { ControlSpec, PlayerView } from "@playwithtv/protocol";
import type { GameProps } from "../types";
import { AVATARS } from "../../avatars";
import { ControlPlayers } from "../controlKit";
import { ControlTutorial } from "../ControlTutorial";
import { placings } from "../scoring";
import { knocked, newLane, previewPath, rack, standingCount, stepLane, sweep, throwBall, type Shot } from "./physics";
import { aimAction, autoShot, newAim, speedFor, updateAim, type Aim, type AimMode } from "./aim";
import { bowler, newMatch, over, recordBall, scores, upNext } from "./match";
import { callout, totalScore } from "./scoring";
import { H, W, celebrate, drawEffects, drawGuide, drawLane, moveCamera, newScene } from "./render";
import { drawSide, paintBoard, type HudPlayer } from "./hud";
import { BowlSfx } from "./audio";

const QUICK = typeof location !== "undefined" && new URLSearchParams(location.search).get("quick") === "1";
const FRAMES = QUICK ? 2 : 10;
const SHOT_CLOCK = QUICK ? 15 : 25;
const DT = 1 / 60;

/**
 * Motion first: turning the phone to aim and pushing it towards the TV is the bowling feeling, and the push
 * strength picks a normal or a power roll. Buttons give a precise power meter; the touchpad is drag-and-swipe.
 */
export const CONTROLS: ControlSpec = {
  title: "Bowling Master",
  modes: ["motion", "buttons", "touchpad"],
  stick: "arrows-h",
  tilt: "aim",
  actions: [
    { id: "roll", label: "🎳 ROLL", color: "#2f8cff", hold: true, gestures: ["push"], swipes: ["swipe-up"], buttonIn: ["buttons"] },
    { id: "power", label: "POWER ROLL", strongOf: "roll", buttonIn: [] },
    { id: "spin", label: "🌀 SPIN", color: "#7c3aed", buttonIn: ["buttons"] },
    { id: "stepL", label: "STEP ◀", gestures: ["flick-left"], buttonIn: [] },
    { id: "stepR", label: "STEP ▶", gestures: ["flick-right"], buttonIn: [] },
    { id: "hookL", label: "HOOK ↶", gestures: ["twist-left"], swipes: ["swipe-left"], buttonIn: [] },
    { id: "hookR", label: "HOOK ↷", gestures: ["twist-right"], swipes: ["swipe-right"], buttonIn: [] },
  ],
  hints: {
    motion: "Turn the phone to aim · flick sideways to step · twist for hook · push towards the TV to roll (harder = faster)",
    buttons: "◀ ▶ to move · hold ROLL (◀ ▶ now aim) and let go at full power · SPIN adds hook",
    touchpad: "Drag sideways to move · swipe up to roll (slant it to aim) · swipe left/right for hook",
  },
};

const SHORT_HINT: Record<AimMode, string> = {
  motion: "Turn to aim · push towards the TV to roll",
  hybrid: "Turn to aim · push towards the TV to roll",
  buttons: "◀ ▶ move · hold ROLL, let go at full power",
  touchpad: "Drag to move · swipe up to roll",
};

/** Bowling Master on the TV: 1–4 players take turns, a frame each, on one lane. */
export function BowlingGame({ players, bridge, paused, onFinish }: GameProps) {
  const ids = useRef(players.filter((p) => p.connected).slice(0, 4)).current;
  const kit = useRef<ControlPlayers | null>(null);
  kit.current ??= new ControlPlayers(bridge, ids.map((p) => p.id), CONTROLS);
  const [practising, setPractising] = useState(true);
  useEffect(() => {
    kit.current!.start();
    return () => kit.current!.dispose();
  }, []);
  // ROLL is a held button in buttons mode (it charges the power meter): count a press-and-release as practised
  useEffect(() => {
    if (!practising) return;
    const k = kit.current!;
    const held = new Map<string, boolean>();
    const id = setInterval(() => {
      for (const p of ids) {
        const seen = k.seen.get(p.id)!;
        const h = k.get(p.id).held("roll");
        if (held.get(p.id) && !h) seen.add("roll");
        if (seen.has("power")) seen.add("roll");
        held.set(p.id, h);
      }
    }, 40);
    return () => clearInterval(id);
  }, [practising]); // eslint-disable-line react-hooks/exhaustive-deps
  if (practising) {
    return (
      <div className="tv" style={{ background: "#0d0626" }}>
        <ControlTutorial title="🎳 Bowling Master" players={ids} kit={kit.current} practice={["roll"]} quick={QUICK} onDone={() => setPractising(false)} />
      </div>
    );
  }
  return <Alley ids={ids} kit={kit.current} paused={paused} onFinish={onFinish} />;
}

type Phase = "intro" | "aim" | "roll" | "result" | "over";

function Alley({ ids, kit, paused, onFinish }: { ids: PlayerView[]; kit: ControlPlayers; paused: boolean; onFinish: GameProps["onFinish"] }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [debug, setDebug] = useState("");
  const pausedRef = useRef(paused);
  pausedRef.current = paused;

  useEffect(() => {
    const ctx = canvas.current!.getContext("2d")!;
    const hudPlayers: HudPlayer[] = ids.map((p) => ({ id: p.id, name: p.name, color: p.color, emoji: AVATARS[p.avatar].emoji }));
    const byId = new Map(hudPlayers.map((p) => [p.id, p]));
    const match = newMatch(ids.map((p) => p.id), FRAMES);
    const lane = newLane(Date.now() % 100000);
    const scene = newScene(ids.map((p) => p.color));
    const sfx = new BowlSfx();
    const board = document.createElement("canvas");
    const memory = new Map<string, { pos: number; spin: number }>();
    let aim: Aim = newAim();
    let phase: Phase = "intro";
    let phaseT = 0;
    let boardDirty = true;
    let path = previewPath({ x: 0, angle: 0, speed: 7.4, spin: 0 }, 14);
    let pathKey = "";
    let standingBefore = 10;
    let freshBefore = true;
    let nextFresh = false;
    let lastResult = "";
    let thrownBy = "";
    const startedAt = Date.now();
    let finished = false;

    const name = (id: string) => byId.get(id)?.name ?? "";
    const modeOf = (id: string) => kit.mode(id) as AimMode;
    const frameText = () => {
      const nb = upNext(match);
      return `Frame ${nb.frame + 1} of ${FRAMES} · Ball ${nb.ball + 1}`;
    };
    const tellPhones = () => {
      const b = bowler(match);
      for (const p of ids) {
        const mine = p.id === b;
        const score = totalScore(match.rolls.get(p.id)!, FRAMES);
        kit.status(p.id, {
          text: phase === "over" ? `Final score ${score}` : mine ? (phase === "aim" ? `Your turn! ${frameText()}` : `${frameText()}`) : `Watch: ${name(b)} is bowling`,
          bars: mine && aim.charging ? [{ label: "Power", value: aim.meter, color: "#ffd23f" }] : [{ label: `Score ${score}`, value: Math.min(1, score / (FRAMES * 30)), color: p.color }],
        });
      }
    };
    const startTurn = () => {
      const b = bowler(match);
      const m = memory.get(b);
      aim = newAim(m?.pos ?? 0, m?.spin ?? 0);
      const nb = upNext(match);
      scene.banner = { text: `${name(b)}`, sub: nb.ball === 0 ? `Frame ${nb.frame + 1}${nb.frame === FRAMES - 1 ? " · last frame" : ""}` : `Ball ${nb.ball + 1}`, color: byId.get(b)!.color, t: 0, dur: QUICK ? 0.9 : 1.4 };
      kit.toast(b, "Your turn!", "good");
      boardDirty = true;
      phase = "intro";
      phaseT = 0;
      tellPhones();
    };
    const launch = (shot: Shot) => {
      if (phase !== "aim") return;
      const b = bowler(match);
      memory.set(b, { pos: aim.pos, spin: aim.spin });
      const nb = upNext(match);
      standingBefore = standingCount(lane);
      freshBefore = nb.freshRack;
      thrownBy = b;
      throwBall(lane, shot);
      sfx.release();
      phase = "roll";
      phaseT = 0;
      aim.charging = false;
    };

    const offAction = kit.onAction((pid, action) => {
      if (pid !== bowler(match)) return;
      if (phase === "intro" && (action === "roll" || action === "power")) return; // too early: wait for the lane
      if (phase !== "aim") return;
      const shot = aimAction(aim, modeOf(pid), action);
      if (action === "spin" || action === "hookL" || action === "hookR") sfx.tick();
      if (shot) launch(shot);
    });

    const step = () => {
      phaseT += DT;
      const b = bowler(match);
      if (phase === "intro") {
        if (phaseT > (QUICK ? 0.8 : 1.3)) { phase = "aim"; phaseT = 0; aim.t = 0; tellPhones(); }
      } else if (phase === "aim") {
        const m = kit.get(b);
        const shot = updateAim(aim, { mode: modeOf(b), ok: m.ok, x: m.x, y: m.y, rollHeld: m.held("roll") }, DT);
        if (shot) launch(shot);
        else if (aim.t > SHOT_CLOCK && !aim.charging) {
          kit.toast(b, "Time's up: rolled for you", "info");
          launch(autoShot(aim));
        }
      } else if (phase === "roll") {
        for (const e of stepLane(lane, DT)) {
          if (e.kind === "pin-hit") sfx.pin(e.speed, e.byBall);
          else if (e.kind === "gutter") sfx.gutter();
        }
        const ball = lane.ball;
        sfx.roll(ball.thrown && !ball.done && !ball.gutter ? Math.min(1, Math.hypot(ball.vx, ball.vy) / 9) : ball.gutter && !ball.done ? 0.35 : 0);
        if (lane.settled) {
          const pins = knocked(lane);
          const text = callout(pins, standingBefore, freshBefore);
          const res = recordBall(match, pins);
          nextFresh = res.freshRack;
          lastResult = text;
          const color = text === "STRIKE!" ? "#ffd23f" : text === "SPARE!" ? "#7cf2ff" : pins === 0 ? "#ff5d73" : "#ffffff";
          scene.banner = { text, sub: text === "STRIKE!" || text === "SPARE!" ? name(thrownBy) : undefined, color, t: 0, dur: QUICK ? 1.3 : 2 };
          if (text === "STRIKE!") { sfx.strike(); celebrate(scene, 80); kit.toast(thrownBy, "STRIKE! 🎉", "good"); }
          else if (text === "SPARE!") { sfx.spare(); celebrate(scene, 40); kit.toast(thrownBy, "SPARE!", "good"); }
          else kit.toast(thrownBy, text, pins === 0 ? "bad" : "info");
          boardDirty = true;
          phase = "result";
          phaseT = 0;
          sfx.roll(0);
          tellPhones();
        }
      } else if (phase === "result") {
        if (phaseT > (QUICK ? 1.4 : 2.2)) {
          if (over(match)) return finish();
          if (nextFresh) rack(lane);
          else sweep(lane);
          startTurn();
        }
      }
      if (phase === "aim") {
        const key = `${aim.pos.toFixed(3)}|${aim.angle.toFixed(4)}|${aim.spin}`;
        if (key !== pathKey) { pathKey = key; path = previewPath({ x: aim.pos, angle: aim.angle, spin: aim.spin, speed: aim.charging ? speedFor(aim.meter) : speedFor(0.5) }, 14); }
      }
    };

    const finish = () => {
      if (finished) return;
      finished = true;
      phase = "over";
      phaseT = 0;
      const final = scores(match);
      const results = placings(final);
      const best = Math.max(...final.values());
      const winner = results.find((r) => r.place === 1)!;
      scene.banner = { text: ids.length > 1 ? `${name(winner.playerId)} wins!` : `${best} points!`, sub: ids.length > 1 ? `${best} points` : "Game over", color: "#ffd23f", t: 0, dur: 99 };
      celebrate(scene, 90);
      sfx.strike();
      for (const r of results) {
        const score = final.get(r.playerId)!;
        if (ids.length === 1) kit.outcome(r.playerId, `You scored ${score}!`, "🎳");
        else if (r.place === 1) kit.outcome(r.playerId, `You won with ${score}!`, "🏆");
        else kit.outcome(r.playerId, `You came #${r.place} with ${score}`, "🎳");
      }
      boardDirty = true;
      setTimeout(() => onFinish(results, Date.now() - startedAt), QUICK ? 2500 : 4500);
    };

    startTurn();
    let raf = 0, last = performance.now(), acc = 0, lastStatus = 0, frames = 0, fps = 0, fpsT = last;
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      frames++;
      if (now - fpsT >= 1000) { fps = frames; frames = 0; fpsT = now; }
      const real = Math.min(0.1, (now - last) / 1000);
      last = now;
      const live = !pausedRef.current;
      if (live) {
        acc += real;
        while (acc >= DT) { acc -= DT; step(); }
        moveCamera(scene, lane, phase === "aim" || phase === "intro", real);
      }
      const b = bowler(match);
      const bp = byId.get(b)!;
      const aiming = phase === "aim" || phase === "intro";
      drawLane(ctx, scene, lane, byId.get(lane.ball.thrown ? thrownBy : b)!.color, aim.pos, phase === "aim" ? () => drawGuide(ctx, scene, path, bp.color, 13.5) : null);
      if (boardDirty) { paintBoard(board, hudPlayers, match.rolls, FRAMES, phase === "over" ? -1 : match.turn); boardDirty = false; }
      ctx.drawImage(board, (W - board.width) / 2, 12);
      drawSide(ctx, lane, phase === "over" ? null : {
        name: bp.name, color: bp.color, emoji: bp.emoji, frameText: frameText(), spin: aim.spin, hint: SHORT_HINT[modeOf(b)],
        meter: aiming && aim.charging ? aim.meter : null,
        clock: phase === "aim" && SHOT_CLOCK - aim.t < 8 ? SHOT_CLOCK - aim.t : null,
      });
      drawEffects(ctx, scene, live ? real : 0);
      if (now - lastStatus > 250) {
        lastStatus = now;
        if (phase === "aim") tellPhones();
        setDebug(JSON.stringify({
          phase, turn: match.turn, bowler: b, names: Object.fromEntries(hudPlayers.map((x) => [x.id, x.name])), frame: upNext(match).frame, ball: upNext(match).ball, fps,
          scores: Object.fromEntries(scores(match)), rolls: Object.fromEntries(match.rolls), last: lastResult,
          pos: +aim.pos.toFixed(3), angle: +aim.angle.toFixed(4), spin: aim.spin, charging: aim.charging, meter: +aim.meter.toFixed(2),
          ballY: +lane.ball.y.toFixed(2), standing: standingCount(lane), thrown: lane.ball.thrown,
        }));
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
    <div style={{ position: "absolute", inset: 0, background: "#0d0626" }} data-bowling={debug}>
      <canvas ref={canvas} width={W} height={H} style={{ width: "100%", height: "100%", display: "block" }} />
      {paused && <div className="paused-overlay"><div className="big-title">⏸ Paused</div><p className="hint">Reconnecting…</p></div>}
    </div>
  );
}
