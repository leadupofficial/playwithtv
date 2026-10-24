import { useEffect, useRef, useState } from "react";
import type { ControlSpec, GameResult, PlayerView } from "@playwithtv/protocol";
import type { GameProps } from "../types";
import { AVATARS } from "../../avatars";
import { ControlPlayers } from "../controlKit";
import { ControlTutorial } from "../ControlTutorial";
import { TRACKS, buildTrack } from "./track";
import { DRIFT_T2, IDLE, POINTS, VMAX, newRace, placeOf, standings, step, type KartInput, type RaceEvent } from "./engine";
import { aimError } from "./cpu";
import { ITEM_LABEL } from "./items";
import { H, W, animate, burst, draw, newView, type KartLook } from "./render";
import { KartSfx } from "./audio";

const QUICK = typeof location !== "undefined" && new URLSearchParams(location.search).get("quick") === "1";
/** `?track=grove|harbour|oval` picks a circuit (demos and tests); otherwise quick races use the small oval. */
const TRACK = typeof location !== "undefined" ? new URLSearchParams(location.search).get("track") : null;
const DT = 1 / 60;
const MIN_KARTS = 4;
const CPU_CREW: Array<[string, string]> = [["Rapid Rani", "#ff9f1c"], ["Capt. Chai", "#2ec4b6"], ["Dosa Dash", "#b5179e"], ["Thambi", "#7bd389"]];
const ORD = ["1st", "2nd", "3rd", "4th", "5th", "6th", "7th", "8th"];

/**
 * Hybrid first: turning the phone like a steering wheel gives smooth, analogue steering, while thumbs on GAS,
 * DRIFT and ITEM never misfire. Buttons are the precise fallback; motion is hands-free (auto-gas, flick to drift).
 */
export const CONTROLS: ControlSpec = {
  title: "Kart Knockout",
  modes: ["hybrid", "buttons", "motion"],
  stick: "arrows-h",
  tilt: "steer",
  actions: [
    { id: "gas", label: "GAS", color: "#23a55a", hold: true },
    { id: "drift", label: "DRIFT", color: "#7c3aed", hold: true, gestures: ["flick-left", "flick-right"] },
    { id: "item", label: "🎁 ITEM", color: "#ff7a00", gestures: ["push"] },
  ],
  hints: {
    hybrid: "Turn the phone like a wheel to steer · hold GAS · hold DRIFT in corners · tap ITEM",
    buttons: "◀ ▶ steer · hold GAS · hold DRIFT through corners, let go to boost · tap ITEM",
    motion: "Turn to steer (gas is automatic) · flick sideways to drift, straighten to boost · push to use your item",
  },
};

/** Kart Knockout on the TV: up to 8 karts on one shared top-down circuit, CPU karts fill the grid to 4. */
export function KartGame({ players, bridge, paused, onFinish, sponsor }: GameProps) {
  const humans = useRef(players.filter((p) => p.connected).slice(0, 8)).current;
  const kit = useRef<ControlPlayers | null>(null);
  kit.current ??= new ControlPlayers(bridge, humans.map((p) => p.id), CONTROLS);
  const [practising, setPractising] = useState(true);
  useEffect(() => {
    kit.current!.start();
    return () => kit.current!.dispose();
  }, []);
  if (practising) {
    return (
      <div className="tv" style={{ background: "#14112b" }}>
        <ControlTutorial title="🏎️ Kart Knockout" players={humans} kit={kit.current} practice={["item"]} quick={QUICK} onDone={() => setPractising(false)} />
      </div>
    );
  }
  return <Race humans={humans} kit={kit.current} bridge={bridge} paused={paused} onFinish={onFinish} sponsor={sponsor?.name} />;
}

function Race({ humans, kit, bridge, paused, onFinish, sponsor }: { humans: PlayerView[]; kit: ControlPlayers; bridge: GameProps["bridge"]; paused: boolean; onFinish: GameProps["onFinish"]; sponsor?: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const [debug, setDebug] = useState("");

  useEffect(() => {
    const trackId = TRACK && Object.hasOwn(TRACKS, TRACK) ? TRACK : QUICK ? "oval" : Math.random() < 0.5 ? "grove" : "harbour";
    const track = buildTrack(TRACKS[trackId]!);
    const looks = new Map<string, KartLook>();
    for (const p of humans) looks.set(p.id, { name: p.name, color: p.color, emoji: AVATARS[p.avatar].emoji, cpu: false });
    const used = new Set(humans.map((p) => p.color.toLowerCase()));
    const crew = CPU_CREW.filter(([, c]) => !used.has(c));
    for (let i = 0; looks.size < MIN_KARTS; i++) {
      const [name, color] = crew[i % crew.length]!;
      looks.set(`cpu${i}`, { name, color, emoji: "🤖", cpu: true });
    }
    const seed = (Math.random() * 2 ** 31) >>> 0;
    const entrants = [...looks].map(([id, l]) => ({ id, cpu: l.cpu }));
    for (let i = entrants.length - 1; i > 0; i--) { // shuffled grid
      const j = Math.floor(Math.random() * (i + 1));
      [entrants[i], entrants[j]] = [entrants[j]!, entrants[i]!];
    }
    const race = newRace(track, entrants, { laps: QUICK ? 1 : 3, seed, countdown: QUICK ? 2 : 3, grace: QUICK ? 14 : 18 });
    const view = newView(race, looks, sponsor);
    const sfx = new KartSfx();
    const inputs = new Map<string, KartInput>(humans.map((p) => [p.id, { ...IDLE }]));
    const itemQueued = new Set<string>();
    const motionDrift = new Map<string, number>(); // seconds left on a flick-started drift request
    const offAction = kit.onAction((id, a) => {
      if (a === "item") itemQueued.add(id);
      if (a === "drift") motionDrift.set(id, (motionDrift.get(id) ?? 0) > 0 ? 0 : 3); // a second flick lets go
    });
    const human = (id: string) => inputs.has(id);
    const kartOf = (id: string) => race.karts.find((k) => k.id === id)!;

    /** One phone → this step's controls. Steering is the same signal in every mode (◀ ▶ or tilting). */
    const read = (id: string, inp: KartInput) => {
      const m = kit.get(id);
      const mode = kit.mode(id);
      inp.steer = m.ok ? Math.max(-1, Math.min(1, m.x)) : 0;
      inp.item = itemQueued.has(id);
      if (mode === "motion") {
        inp.gas = m.ok;
        // a flick asks for a drift; it holds while the wheel stays turned that way and lets go (boost!) when straightened
        let left = motionDrift.get(id) ?? 0;
        const k = kartOf(id);
        if (left > 0) {
          left -= DT;
          if (k.drift === 0 && left < 2.6) left = 0;                // the flick did not start a drift: forget it
          if (k.drift !== 0 && inp.steer * k.drift < 0.15) left = 0; // straightened (or countersteered): release
          motionDrift.set(id, left);
        }
        inp.drift = left > 0;
      } else {
        inp.gas = m.ok && m.held("gas");
        inp.drift = m.ok && m.held("drift");
      }
    };

    const say = (id: string, text: string, tone: "good" | "bad" | "info") => human(id) && kit.toast(id, text, tone);
    const handle = (ev: RaceEvent[]) => {
      for (const e of ev) {
        if (e.kind === "go") {
          sfx.beep(true);
          view.banner = { text: "GO!", color: "#3ee08f", t: 0, dur: 1 };
        } else if (e.kind === "lap") {
          const k = kartOf(e.id);
          if (k.lap === race.laps - 1 && race.laps > 1) {
            if (human(e.id)) { sfx.lap(true); say(e.id, "🔔 FINAL LAP!", "info"); }
            burst(view, k.x, k.y - 30, "FINAL LAP", "#ffd23f");
          } else if (k.lap < race.laps) {
            if (human(e.id)) { sfx.lap(false); say(e.id, `Lap ${k.lap + 1} of ${race.laps}`, "info"); }
          }
        } else if (e.kind === "finish") {
          const k = kartOf(e.id);
          burst(view, k.x, k.y - 30, ORD[e.place - 1]!, "#ffd23f");
          if (e.place === 1) {
            sfx.fanfare();
            view.banner = { text: "FINISH!", sub: `${looks.get(e.id)!.name} wins!`, color: "#ffd23f", t: 0, dur: 3 };
          }
          say(e.id, `🏁 Finished ${ORD[e.place - 1]}!`, "good");
        } else if (e.kind === "pickup") {
          if (human(e.id)) {
            sfx.pickup();
            say(e.id, `🎁 ${ITEM_LABEL[e.item]}! ${kit.mode(e.id) === "motion" ? "Push to use" : "Tap ITEM"}`, "good");
          }
        } else if (e.kind === "use") {
          sfx.use();
          if (e.item === "bumper") sfx.shield();
          if (e.item === "zoom" || e.item === "triple") sfx.boost();
        } else if (e.kind === "spin") {
          sfx.spin();
          const k = kartOf(e.id);
          burst(view, k.x, k.y - 20, e.cause === "puddle" ? "SPLOSH!" : e.cause === "coconut" ? "BONK!" : "BOING!", "#7fe3ff");
          say(e.id, "😵 Spun out!", "bad");
          if (human(e.id)) bridgeVibrate(e.id, 300);
          if (e.by && e.by !== e.id) say(e.by, `🎯 Got ${looks.get(e.id)!.name}!`, "good");
        } else if (e.kind === "blocked") {
          const k = kartOf(e.id);
          burst(view, k.x, k.y - 20, "BLOCKED", "#7fe3ff");
        } else if (e.kind === "drift-boost") {
          sfx.spark(e.tier);
          const k = kartOf(e.id);
          burst(view, k.x, k.y - 24, e.tier === 2 ? "SUPER SPARK!" : "SPARK!", e.tier === 2 ? "#ffb020" : "#5fd0ff");
        } else if (e.kind === "hop") {
          if (human(e.id)) sfx.hop();
        } else if (e.kind === "pad") {
          if (human(e.id)) sfx.boost();
        } else if (e.kind === "bump") {
          sfx.bump(e.hard);
          if (human(e.a)) bridgeVibrate(e.a, e.hard ? 200 : 60);
          if (human(e.b)) bridgeVibrate(e.b, e.hard ? 200 : 60);
        } else if (e.kind === "wall") {
          if (human(e.id)) { sfx.wall(); bridgeVibrate(e.id, 40); }
        } else if (e.kind === "missed") {
          say(e.id, "↩️ Missed a checkpoint, follow the road!", "bad");
        } else if (e.kind === "done") {
          if (!view.banner) view.banner = { text: "RACE OVER", color: "#fff", t: 0, dur: 3 };
          for (const s of standings(race)) {
            if (!human(s.id)) continue;
            kit.outcome(s.id, s.place === 1 ? "You won the race!" : `You finished ${ORD[s.place - 1]}`, s.place === 1 ? "🏆" : s.place <= 3 ? "🥈" : "🏁");
          }
        }
      }
    };
    const bridgeVibrate = (id: string, ms: number) => bridge.event(id, "vibrate", { ms });

    const ctx = canvas.current!.getContext("2d")!;
    const startedAt = Date.now();
    let raf = 0, last = performance.now(), acc = 0, lastHud = 0, hudTick = 0, frames = 0, fps = 0, fpsT = last;
    let lastBeep = Math.ceil(race.countdown), doneAt = 0, reported = false;
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      frames++;
      if (now - fpsT >= 1000) { fps = frames; frames = 0; fpsT = now; }
      const real = Math.min(0.1, (now - last) / 1000);
      last = now;
      if (!pausedRef.current) {
        acc += real;
        while (acc >= DT) {
          acc -= DT;
          for (const [id, inp] of inputs) read(id, inp);
          itemQueued.clear();
          handle(step(race, DT, inputs));
          animate(view, race, DT);
          if (race.phase === "countdown" && Math.ceil(race.countdown) !== lastBeep) {
            lastBeep = Math.ceil(race.countdown);
            if (lastBeep > 0) sfx.beep(false);
          }
        }
        let sp = 0;
        for (const id of inputs.keys()) { const k = kartOf(id); sp += Math.hypot(k.vx, k.vy) / VMAX; }
        sfx.hum(race.phase === "race" ? sp / inputs.size : 0);
      }
      draw(ctx, race, view);
      if (now - lastHud > 100) {
        lastHud = now;
        hudTick++;
        for (const id of inputs.keys()) {
          if (hudTick % 3) break; // phones every 300 ms, the debug state every 100 ms
          const k = kartOf(id);
          const pos = ORD[placeOf(race, id) - 1];
          const item = k.item ? ` · ${k.rollT > 0 ? "🎁 …" : ITEM_LABEL[k.item]}` : "";
          kit.status(id, {
            text: k.finishedAt !== null ? `🏁 Finished ${pos}` : `${pos} · Lap ${Math.min(race.laps, k.lap + 1)}/${race.laps}${item}`,
            bars: [{ label: "Drift", value: k.drift ? Math.min(1, k.driftT / DRIFT_T2) : 0, color: k.driftT >= DRIFT_T2 ? "#ffb020" : "#5fd0ff" }],
          });
        }
        setDebug(JSON.stringify({
          phase: race.phase, track: trackId, laps: race.laps, time: +race.time.toFixed(1), fps, finish: race.finishOrder,
          karts: race.karts.map((k) => ({
            id: k.id, name: looks.get(k.id)!.name, cpu: k.cpu, lap: k.lap, cp: k.cp, place: placeOf(race, k.id), dist: Math.round(k.dist), x: Math.round(k.x), y: Math.round(k.y),
            speed: Math.round(Math.hypot(k.vx, k.vy)), item: k.item, drifts: k.stats.drifts, boosts: k.stats.boosts, items: k.stats.items,
            pickups: k.stats.pickups, done: k.finishedAt !== null, turn: k.cpu ? 0 : +aimError(race, k).toFixed(2),
          })),
        }));
      }
      if (race.phase === "done") {
        doneAt ||= now;
        if (!reported && now - doneAt > 4000) {
          reported = true;
          const results: GameResult[] = standings(race).filter((s) => human(s.id)).map((s) => ({ playerId: s.id, score: POINTS[s.place - 1] ?? 0, place: s.place }));
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
    <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", background: "#14112b" }} data-kart={debug}>
      <canvas ref={canvas} width={W} height={H} style={{ width: "100%", height: "100%", objectFit: "contain" }} />
      {paused && <div className="paused-overlay"><div className="big-title">⏸ Paused</div><p className="hint">Reconnecting…</p></div>}
    </div>
  );
}
