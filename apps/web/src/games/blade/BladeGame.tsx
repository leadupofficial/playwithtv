import { useEffect, useRef, useState } from "react";
import type { ControlSpec, PlayerView } from "@playwithtv/protocol";
import type { GameProps } from "../types";
import { ControlPlayers } from "../controlKit";
import { ControlTutorial } from "../ControlTutorial";
import { placings } from "../scoring";
import { AVATARS } from "../../avatars";
import { H, W, newRound, scores, stepRound, type BladeEvent, type BladeInput, type Dir, type Mode } from "./engine";
import { animate, blast, cutFx, draw, newView, pop, sparks, streak, trackBlades } from "./render";
import { BladeSfx } from "./sound";
import "./blade.css";

const QUICK = typeof location !== "undefined" && new URLSearchParams(location.search).get("quick") === "1";
const LIMIT = QUICK ? 15 : 60;
const DT = 1 / 60;
/**
 * Touchpad first: your finger is the blade, so cutting is as direct as it gets. Motion aims by tilting and
 * slashes with gentle flicks; buttons move the cursor with the joystick and slash with a button.
 * The slash actions carry their direction; flick-up / swipe-up / the SLASH button are the one "slash".
 */
export const CONTROLS: ControlSpec = {
  title: "Motion Blade Trial",
  modes: ["touchpad", "motion", "buttons"],
  stick: "joystick",
  tilt: "aim",
  actions: [
    { id: "slash", label: "⚔ SLASH", color: "#ff9f1c", gestures: ["flick-up"], swipes: ["swipe-up"] },
    { id: "sl-l", label: "Slash left", gestures: ["flick-left"], swipes: ["swipe-left"], buttonIn: [] },
    { id: "sl-r", label: "Slash right", gestures: ["flick-right"], swipes: ["swipe-right"], buttonIn: [] },
    { id: "sl-d", label: "Slash down", gestures: ["flick-down"], swipes: ["swipe-down"], buttonIn: [] },
  ],
  hints: {
    touchpad: "Your finger is the blade: drag fast across the targets · a quick swipe is a dash slash (swipe up to practise)",
    motion: "Tilt to aim the blade · a gentle flick (up, down, left, right) slashes that way",
    buttons: "Joystick moves the blade · tap SLASH to cut the way you are moving",
  },
};
const ACTION_DIR: Record<string, Dir> = { "sl-l": "left", "sl-r": "right", "sl-d": "down" };
const KIND_NAME: Record<string, string> = { golden: "GOLDEN LOTUS!" };

/** Motion Blade Trial on the TV: 1–4 blades share one screen; the highest score after the round wins. */
export function BladeGame({ players, bridge, paused, onFinish, sponsor }: GameProps) {
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
      <div className="tv blade-tv">
        <ControlTutorial title="⚔️ Motion Blade Trial" players={ids} kit={kit.current} practice={["slash"]} quick={QUICK} onDone={() => setPractising(false)} />
      </div>
    );
  }
  return <Trial ids={ids} kit={kit.current} bridge={bridge} paused={paused} onFinish={onFinish} sponsor={sponsor?.name} />;
}

interface Hud { scores: number[]; left: number; phase: "count" | "play" | "over" }

function Trial({ ids, kit, bridge, paused, onFinish, sponsor }: {
  ids: PlayerView[]; kit: ControlPlayers; bridge: GameProps["bridge"]; paused: boolean; onFinish: GameProps["onFinish"]; sponsor?: string;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const [count, setCount] = useState(QUICK ? 1 : 3);
  const countRef = useRef(count);
  countRef.current = count;
  const [hud, setHud] = useState<Hud>({ scores: ids.map(() => 0), left: LIMIT, phase: "count" });
  const [debug, setDebug] = useState("");

  useEffect(() => {
    if (count <= 0) return;
    const id = setTimeout(() => setCount((c) => c - 1), 1000);
    return () => clearTimeout(id);
  }, [count]);

  useEffect(() => {
    const round = newRound(ids.map((p) => p.id), Math.floor(Math.random() * 1e9), LIMIT);
    const ctx = canvas.current!.getContext("2d")!;
    const view = newView(ids.map((p) => p.color), sponsor);
    const sfx = new BladeSfx();
    const index = new Map(ids.map((p, i) => [p.id, i]));
    const slashes: Array<Dir | null> = ids.map(() => null);
    const inputs: BladeInput[] = ids.map(() => ({ mode: "touchpad", ok: false, x: 0, y: 0, slash: null }));
    const ev: BladeEvent[] = [];
    const offAction = kit.onAction((id, a) => {
      const i = index.get(id);
      if (i === undefined) return;
      const mode = kit.mode(id);
      slashes[i] = a === "slash" ? (mode === "buttons" || mode === "hybrid" ? "aim" : "up") : (ACTION_DIR[a] ?? slashes[i] ?? null);
    });
    const startedAt = Date.now();
    let raf = 0, last = performance.now(), acc = 0, lastHud = 0, lastStatus = 0, frames = 0, fps = 0, fpsT = performance.now();
    let overAt = 0, reported = false, lastTick = -1;

    const readInputs = () => {
      for (let i = 0; i < ids.length; i++) {
        const m = kit.get(ids[i]!.id), inp = inputs[i]!;
        inp.mode = kit.mode(ids[i]!.id) as Mode;
        inp.ok = m.ok;
        inp.x = m.x;
        inp.y = m.y;
        inp.slash = slashes[i]!;
        slashes[i] = null;
      }
    };
    const handle = (e: BladeEvent) => {
      if (e.kind === "cut") {
        const i = index.get(e.id) ?? 0;
        cutFx(view, e.target, e.x, e.y, e.angle);
        const b = round.blades[i]!;
        sfx.slice(b.strokeN);
        if (e.target === "golden") {
          sfx.golden();
          sparks(view, e.x, e.y, 24, "#ffd166", 420);
          pop(view, e.x, e.y - 30, `${KIND_NAME.golden} +${e.points}`, "#ffd166", true);
          kit.toast(e.id, "🌟 Golden lotus! +50", "good");
        } else pop(view, e.x, e.y - 20, `+${e.points}`, ids[i]!.color);
      } else if (e.kind === "bomb") {
        sfx.bomb();
        blast(view, e.x, e.y);
        pop(view, e.x, e.y - 30, "BOOM! -25", "#ff5d73", true);
        kit.toast(e.id, "💥 A spike mine! -25", "bad");
        bridge.event(e.id, "vibrate", { ms: 350 });
      } else if (e.kind === "combo") {
        sfx.combo(e.n);
        pop(view, e.x, e.y - 60, `COMBO x${e.n} +${e.bonus}`, "#7df9ff", true);
        kit.toast(e.id, `⚡ Combo x${e.n}! +${e.bonus}`, "good");
      } else if (e.kind === "slash") {
        sfx.swish();
        streak(view, e.x1, e.y1, e.x2, e.y2, ids[index.get(e.id) ?? 0]!.color);
      }
    };

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      frames++;
      if (now - fpsT >= 1000) { fps = frames; frames = 0; fpsT = now; }
      const real = Math.min(0.1, (now - last) / 1000);
      last = now;
      if (!pausedRef.current) {
        if (countRef.current <= 0) {
          acc += real;
          while (acc >= DT) {
            acc -= DT;
            readInputs();
            ev.length = 0;
            stepRound(round, DT, inputs, ev);
            for (const e of ev) handle(e);
          }
          for (const b of round.blades) if (b.speed > 1200 && b.stunT <= 0 && !round.over) sfx.swish();
        } else slashes.fill(null);
        trackBlades(view, round.blades);
        animate(view, real);
      }
      draw(ctx, view, round);
      const left = Math.max(0, Math.ceil(round.limit - round.time));
      if (!round.over && left <= 5 && left !== lastTick && countRef.current <= 0) { lastTick = left; sfx.tick(); }
      if (round.over && !overAt) { overAt = now; sfx.gong(); }
      if (overAt && !reported && now - overAt > 1500) {
        reported = true;
        const results = placings(scores(round));
        for (const r of results) {
          const b = round.blades[index.get(r.playerId)!]!;
          const detail = `★ ${r.score} · ${b.cuts} cut${b.cuts === 1 ? "" : "s"}${b.bestCombo >= 3 ? ` · best combo x${b.bestCombo}` : ""}`;
          kit.outcome(r.playerId, r.place === 1 ? (ids.length > 1 ? `You won! ${detail}` : `Trial complete! ${detail}`) : `#${r.place} · ${detail}`, r.place === 1 ? "🏆" : "⚔️");
        }
        setTimeout(() => onFinish(results, Date.now() - startedAt), 2500);
      }
      if (now - lastHud > 100) {
        lastHud = now;
        const phase = round.over ? "over" : countRef.current > 0 ? "count" : "play";
        setHud({ scores: round.blades.map((b) => b.score), left, phase });
        setDebug(JSON.stringify({
          phase, time: +round.time.toFixed(1), left, fps, thrown: round.thrown,
          blades: round.blades.map((b) => ({ id: b.id, score: b.score, cuts: b.cuts, bombs: b.bombs, combo: b.bestCombo, x: Math.round(b.x), y: Math.round(b.y), stun: b.stunT > 0 })),
          targets: round.targets.slice(0, 12).map((t) => ({ k: t.kind, x: Math.round(t.x), y: Math.round(t.y), vx: Math.round(t.vx), vy: Math.round(t.vy) })),
        }));
      }
      if (now - lastStatus > 300 && !round.over) {
        lastStatus = now;
        for (const b of round.blades) kit.status(b.id, { text: `★ ${b.score} · ${b.cuts} cuts · ${left}s left${b.stunT > 0 ? " · 💥 stunned" : ""}` });
      }
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      offAction();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const best = Math.max(...hud.scores);
  return (
    <div className="blade" data-blade={debug}>
      <canvas ref={canvas} width={W} height={H} className="blade-canvas" />
      <div className="blade-hud">
        {ids.map((p, i) => (
          <span key={p.id} className={`bh-player ${hud.scores[i] === best && best > 0 && ids.length > 1 ? "lead" : ""}`} style={{ borderColor: p.color }}>
            <span className="bh-dot" style={{ background: p.color }} />{AVATARS[p.avatar].emoji} {p.name}<b>{hud.scores[i]}</b>
          </span>
        ))}
        <span className={`bh-time ${hud.left <= 5 ? "hurry" : ""}`}>⏱ {hud.left}s</span>
      </div>
      {count > 0 && <div className="blade-count">{count}</div>}
      {count === 0 && hud.phase === "play" && hud.left > LIMIT - 1 && <div className="blade-count go">SLICE!</div>}
      {hud.phase === "over" && <div className="blade-count end">TIME!</div>}
      {paused && <div className="paused-overlay"><div className="big-title">⏸ Paused</div><p className="hint">Reconnecting…</p></div>}
    </div>
  );
}
