import { useEffect, useRef, useState } from "react";
import type { ControlSpec, PlayerView } from "@playwithtv/protocol";
import type { GameProps } from "../types";
import { ControlPlayers } from "../controlKit";
import { ControlTutorial } from "../ControlTutorial";
import { placings } from "../scoring";
import { AVATARS } from "../../avatars";
import {
  WORLD_AT, WORLD_NAMES, heightM, newMatch, nextTarget, score, scores, stepMatch, steerGain,
  type JumperEvent, type JumperInput, type PowerKind,
} from "./engine";
import { CH, CW, animate, burst, columns, draw, enterWorld, newView, popup } from "./render";
import { JumpSfx } from "./sound";
import "./jumper.css";

const QUICK = typeof location !== "undefined" && new URLSearchParams(location.search).get("quick") === "1";
const LIMIT = QUICK ? 25 : 90;
const DT = 1 / 60;
/**
 * Motion first: steering a bouncing hero by turning the phone like a wheel is the heart of this game, and the
 * bounce is automatic, so analog tilt is forgiving. Buttons (◀ ▶) are the precise alternative.
 */
export const CONTROLS: ControlSpec = {
  title: "Tilt Jumper Worlds",
  modes: ["motion", "buttons", "touchpad"],
  stick: "arrows-h",
  tilt: "steer",
  actions: [{ id: "power", label: "🚀 POWER", color: "#ff7a00", gestures: ["flick-up"], swipes: ["tap"] }],
  hints: {
    motion: "Hold the phone upright and turn it like a wheel to steer · flick up to fire your power-up",
    buttons: "◀ ▶ to steer · tap POWER to fire your power-up",
    touchpad: "Hold your finger left or right of the middle to steer · tap to fire your power-up",
  },
};
const POWER_ICON: Record<PowerKind, string> = { rocket: "🚀", shield: "🛡️" };
const HOW: Record<string, string> = { motion: "flick up", touchpad: "tap the pad", buttons: "tap POWER", hybrid: "tap POWER" };

/** Tilt Jumper Worlds on the TV: 1–4 players climb side by side; highest climb plus pickups wins. */
export function JumperGame({ players, bridge, paused, onFinish }: GameProps) {
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
      <div className="tv jumper-tv">
        <ControlTutorial title="🌈 Tilt Jumper Worlds" players={ids} kit={kit.current} practice={["power"]} quick={QUICK} onDone={() => setPractising(false)} />
      </div>
    );
  }
  return <Climb ids={ids} kit={kit.current} bridge={bridge} paused={paused} onFinish={onFinish} />;
}

interface ColHud { m: number; score: number; alive: boolean; stored: PowerKind | null; world: number; active: string }

function Climb({ ids, kit, bridge, paused, onFinish }: { ids: PlayerView[]; kit: ControlPlayers; bridge: GameProps["bridge"]; paused: boolean; onFinish: GameProps["onFinish"] }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const [count, setCount] = useState(QUICK ? 1 : 3);
  const countRef = useRef(count);
  countRef.current = count;
  const [hud, setHud] = useState<ColHud[]>([]);
  const [left, setLeft] = useState(LIMIT);
  const [over, setOver] = useState<"" | "time" | "fell">("");
  const [debug, setDebug] = useState("");

  useEffect(() => {
    if (count <= 0) return;
    const id = setTimeout(() => setCount((c) => c - 1), 1000);
    return () => clearTimeout(id);
  }, [count]);

  useEffect(() => {
    const cols = columns(ids.length);
    const match = newMatch(ids.map((p) => p.id), Math.floor(Math.random() * 1e9), cols[0]!.viewH, LIMIT);
    const ctx = canvas.current!.getContext("2d")!;
    const view = newView(ctx, ids.length, ids.map((p) => p.color));
    const sfx = new JumpSfx();
    const colOf = new Map(ids.map((p, i) => [p.id, i]));
    const bridgeVibrate = (id: string, ms: number) => bridge.event(id, "vibrate", { ms });
    const powerQueued = new Set<string>();
    const inputs = new Map<string, JumperInput>(ids.map((p) => [p.id, { x: 0, power: false }]));
    const ev: JumperEvent[] = [];
    const offAction = kit.onAction((id, a) => a === "power" && powerQueued.add(id));
    const startedAt = Date.now();
    let raf = 0, last = performance.now(), acc = 0, lastHud = 0, lastStatus = 0, frames = 0, fps = 0, fpsT = performance.now();
    let reported = false;

    const input = (id: string): JumperInput => {
      const inp = inputs.get(id)!;
      const m = kit.get(id);
      inp.x = m.ok ? m.x * steerGain(kit.mode(id)) : 0;
      inp.power = powerQueued.delete(id);
      return inp;
    };

    const handle = (e: JumperEvent) => {
      const col = colOf.get(e.id) ?? 0;
      switch (e.kind) {
        case "bounce": sfx.bounce(1 + col * 0.12); break;
        case "spring": sfx.spring(); burst(view, col, e.x, e.y, 10, "#ff4d6d"); popup(view, col, e.x, e.y + 30, "BOING!", "#ff8fab"); break;
        case "break": sfx.crumble(); burst(view, col, e.x, e.y, 12, "#a87b4f", 160); break;
        case "gem": sfx.gem(); burst(view, col, e.x, e.y, 6, "#ffe14d", 140); popup(view, col, e.x, e.y, "+10", "#ffe14d"); break;
        case "pickup":
          sfx.pickup();
          popup(view, col, e.x, e.y, e.item === "rocket" ? "ROCKET!" : "SHIELD!", "#7df9ff");
          kit.toast(e.id, `${POWER_ICON[e.item as PowerKind]} Got a ${e.item}! ${HOW[kit.mode(e.id)]} to use it`, "good");
          break;
        case "spare": sfx.gem(); popup(view, col, e.x, e.y, "+30", "#7df9ff"); break;
        case "power":
          if (e.power === "rocket") sfx.rocket(); else sfx.shield();
          burst(view, col, e.x, e.y, 16, e.power === "rocket" ? "#ffb703" : "#7df9ff", 260);
          kit.toast(e.id, e.power === "rocket" ? "🚀 Rocket!" : "🛡️ Shield on!", "good");
          break;
        case "stomp": sfx.stomp(); burst(view, col, e.x, e.y, 14, "#b5179e"); popup(view, col, e.x, e.y, "STOMP! +50", "#ffffff"); bridgeVibrate(e.id, 60); break;
        case "smash": sfx.smash(); burst(view, col, e.x, e.y, 14, "#7df9ff"); popup(view, col, e.x, e.y, "SMASH! +40", "#7df9ff"); break;
        case "hit": sfx.hit(); burst(view, col, e.x, e.y + 18, 10, "#ffffff"); bridgeVibrate(e.id, 300); kit.toast(e.id, "Ouch! Knocked off", "bad"); break;
        case "fell": {
          sfx.fall();
          const w = match.worlds[col]!;
          kit.toast(e.id, `You fell at ${heightM(w)} m`, "bad");
          kit.status(e.id, { text: `Fell at ${heightM(w)} m · ★ ${score(w)} · watch the others` });
          break;
        }
        case "world":
          sfx.world();
          enterWorld(view, col, e.world);
          kit.toast(e.id, `World ${e.world + 1}: ${WORLD_NAMES[e.world]}!`, "good");
          break;
      }
    };

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      frames++;
      if (now - fpsT >= 1000) { fps = frames; frames = 0; fpsT = now; }
      const real = Math.min(0.1, (now - last) / 1000);
      last = now;
      if (!pausedRef.current) {
        if (countRef.current <= 0 && !match.over) {
          acc += real;
          while (acc >= DT && !match.over) {
            acc -= DT;
            ev.length = 0;
            stepMatch(match, DT, input, ev);
            for (const e of ev) handle(e);
          }
        } else powerQueued.clear(); // no banking power-ups during the countdown
        animate(view, real);
      }
      draw(ctx, view, match.worlds);

      if (match.over && !reported) {
        reported = true;
        setOver(match.time >= match.limit ? "time" : "fell");
        sfx.end();
        const results = placings(scores(match));
        for (const r of results) {
          const w = match.worlds[colOf.get(r.playerId)!]!;
          const text = r.place === 1 ? (ids.length > 1 ? `You climbed highest! ${heightM(w)} m` : `${heightM(w)} m climbed · ★ ${r.score}`) : `#${r.place} · ${heightM(w)} m · ★ ${r.score}`;
          kit.outcome(r.playerId, text, r.place === 1 ? "🏆" : "🌈");
        }
        setTimeout(() => onFinish(results, Date.now() - startedAt), 3500);
      }
      if (now - lastHud > 100) {
        lastHud = now;
        setHud(match.worlds.map((w) => ({
          m: heightM(w), score: score(w), alive: w.hero.alive, stored: w.hero.stored, world: w.world,
          active: w.hero.rocketT > 0 ? "🚀" : w.hero.shieldT > 0 ? "🛡️" : "",
        })));
        setLeft(Math.max(0, Math.ceil(match.limit - match.time)));
        setDebug(JSON.stringify({
          phase: match.over ? "over" : countRef.current > 0 ? "count" : "play", time: +match.time.toFixed(1), fps,
          players: match.worlds.map((w) => ({
            id: w.id, m: heightM(w), score: score(w), alive: w.hero.alive, x: Math.round(w.hero.x), vy: Math.round(w.hero.vy),
            tx: nextTarget(w) === null ? null : Math.round(nextTarget(w)!), stored: w.hero.stored, powers: w.powersUsed, bounces: w.bounces, world: w.world,
          })),
        }));
      }
      if (now - lastStatus > 300) {
        lastStatus = now;
        for (const w of match.worlds) {
          if (!w.hero.alive) continue;
          kit.status(w.id, {
            text: `${heightM(w)} m · ★ ${score(w)} · ${WORLD_NAMES[w.world]}`,
            bars: [{ label: w.hero.stored ? `${POWER_ICON[w.hero.stored]} ready` : "Power", value: w.hero.stored ? 1 : 0, color: "#ff7a00" }],
          });
        }
      }
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      offAction();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const cols = columns(ids.length);
  const pct = (v: number, of: number) => `${(v / of) * 100}%`;
  return (
    <div className="jumper" data-jumper={debug}>
      <canvas ref={canvas} width={CW} height={CH} className="jumper-canvas" />
      {ids.map((p, i) => {
        const c = cols[i]!, h = hud[i];
        return (
          <div key={p.id} className="jumper-col" style={{ left: pct(c.x, CW), width: pct(c.w, CW) }}>
            <div className="jc-top">
              <span className="chip" style={{ borderColor: p.color }}>{AVATARS[p.avatar].emoji} {p.name}</span>
              <span className="jc-power" title="stored power-up">{h?.active || (h?.stored ? POWER_ICON[h.stored] : "·")}</span>
            </div>
            <div className="jc-score"><b>{h?.m ?? 0} m</b><span>★ {h?.score ?? 0}</span></div>
            {h && !h.alive && <div className="jc-out"><b>FELL!</b><span>{h.m} m · ★ {h.score}</span></div>}
          </div>
        );
      })}
      {ids.length === 1 && (
        <aside className="jumper-side">
          <h2>🌈 Worlds</h2>
          {WORLD_NAMES.map((n, i) => (
            <div key={n} className={`js-world ${(hud[0]?.world ?? 0) === i ? "on" : (hud[0]?.world ?? 0) > i ? "done" : ""}`}><b>{n}</b><span>{WORLD_AT[i]} m</span></div>
          ))}
        </aside>
      )}
      <div className={`jumper-timer ${ids.length === 1 ? "solo" : ""}`}>⏱ {left}s</div>
      {count > 0 && <div className="jumper-count">{count}</div>}
      {count === 0 && !over && <div className="jumper-count go">CLIMB!</div>}
      {over === "time" && <div className="jumper-count end">TIME!</div>}
      {paused && <div className="paused-overlay"><div className="big-title">⏸ Paused</div><p className="hint">Reconnecting…</p></div>}
    </div>
  );
}
