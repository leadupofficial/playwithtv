import { useEffect, useRef, useState } from "react";
import type { PlayerView } from "@playwithtv/protocol";
import type { GameProps } from "../types";
import type { ControlSpec } from "@playwithtv/protocol";
import { ControlPlayers } from "../controlKit";
import { ControlTutorial } from "../ControlTutorial";
import { AVATARS } from "../../avatars";
import { t } from "../../i18n";
import { makeTrack, newRace, standings, stepRace, type Controls } from "./engine";
import { RacerScene, viewports } from "./scene";
import { Engines } from "./sound";
import "./racer.css";

const QUICK = typeof location !== "undefined" && new URLSearchParams(location.search).get("quick") === "1";
const GATES = QUICK ? 6 : 24;
const TIME_LIMIT = QUICK ? 60 : 150;
/** Hybrid first: tilting the phone like a wheel steers best, and a thumb on BOOST never misfires. */
const CONTROLS: ControlSpec = {
  title: "Sky Gyro Racer",
  modes: ["hybrid", "motion", "buttons"],
  stick: "joystick",
  tilt: "steer",
  actions: [{ id: "boost", label: "🔥 BOOST", color: "#ff7a00", gestures: ["push"] }],
  hints: {
    hybrid: "Turn the phone like a steering wheel, tip to climb or dive, tap BOOST",
    motion: "Turn to steer, tip to climb or dive, push towards the TV to boost",
    buttons: "Joystick to steer and climb, tap BOOST",
  },
};
const DT = 1 / 60;

/** Sky Gyro Racer: 1–4 ships, split screen, steer by turning the phone, push to boost. */
export function RacerGame({ players, bridge, paused, onFinish }: GameProps) {
  const racers = useRef(players.filter((p) => p.connected).slice(0, 4)).current;
  const kit = useRef<ControlPlayers | null>(null);
  kit.current ??= new ControlPlayers(bridge, racers.map((p) => p.id), CONTROLS);
  const [practising, setPractising] = useState(true);
  useEffect(() => {
    kit.current!.start();
    return () => kit.current!.dispose();
  }, []);
  if (practising) {
    return (
      <div className="tv racer-tv">
        <ControlTutorial title="🚀 Sky Gyro Racer" players={racers} kit={kit.current} practice={["boost"]} quick={QUICK} onDone={() => setPractising(false)} />
      </div>
    );
  }
  return <Race racers={racers} kit={kit.current} paused={paused} onFinish={onFinish} />;
}

interface ShipHud { place: number; gates: number; energy: number; boost: boolean; finished: boolean; speed: number }

function Race({ racers, kit, paused, onFinish }: { racers: PlayerView[]; kit: ControlPlayers; paused: boolean; onFinish: GameProps["onFinish"] }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const [count, setCount] = useState(QUICK ? 1 : 3);
  const [hud, setHud] = useState<Map<string, ShipHud>>(new Map());
  const [debug, setDebug] = useState("");
  const [over, setOver] = useState(false);

  useEffect(() => {
    if (count <= 0) return;
    const id = setTimeout(() => setCount((c) => c - 1), 1000);
    return () => clearTimeout(id);
  }, [count]);
  const countRef = useRef(count);
  countRef.current = count;

  useEffect(() => {
    const race = newRace(makeTrack(GATES, Math.floor(Math.random() * 1000)), racers.map((p) => p.id));
    const scene = new RacerScene(canvas.current!, race, new Map(racers.map((p) => [p.id, p.color])));
    const sfx = new Engines();
    const boostQueued = new Set<string>();
    const boosts = new Map(racers.map((p) => [p.id, 0]));
    const offAction = kit.onAction((id, a) => a === "boost" && boostQueued.add(id));
    const startedAt = Date.now();
    let raf = 0, last = performance.now(), acc = 0, lastHud = 0, frames = 0, fps = 0, fpsT = performance.now();
    let finishedReported = false;

    const tilt = () => new Map(racers.map((p) => {
      const m = kit.get(p.id);
      return [p.id, m.ok ? { steer: m.x, climb: m.y } : { steer: 0, climb: 0 }];
    }));

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      frames++;
      if (now - fpsT >= 1000) { fps = frames; frames = 0; fpsT = now; }
      const real = Math.min(0.1, (now - last) / 1000);
      last = now;
      const tl = tilt();
      if (!pausedRef.current && countRef.current <= 0 && !race.over) {
        acc += real;
        while (acc >= DT) {
          acc -= DT;
          const ctl = new Map<string, Controls>([...tl].map(([id, v]) => [id, { ...v, boost: boostQueued.has(id) }]));
          boostQueued.clear();
          for (const e of stepRace(race, DT, ctl, TIME_LIMIT)) {
            if (e.kind === "gate" && e.hit) { sfx.ding(); kit.toast(e.ship, "Gate! +energy", "good"); }
            if (e.kind === "boost") { sfx.whoosh(); boosts.set(e.ship, (boosts.get(e.ship) ?? 0) + 1); kit.toast(e.ship, `🔥 ${t("racer.boost")}!`, "good"); }
            if (e.kind === "bump") { sfx.bump(); kit.toast(e.ship, "Rock! Slowed down", "bad"); }
            if (e.kind === "finish") kit.toast(e.ship, `${t("racer.finish")} #${e.place}`, "good");
          }
        }
      } else {
        boostQueued.clear(); // no banking boosts during the countdown
      }
      scene.render(race, tl, real);
      if (race.over && !finishedReported) {
        finishedReported = true;
        setOver(true);
        const st = standings(race);
        for (const r of st) kit.outcome(r.playerId, r.place === 1 ? (racers.length > 1 ? "You won the race!" : "Race complete!") : `You finished #${r.place}`, r.place === 1 ? "🏆" : "🚀");
        setTimeout(() => onFinish(st, Date.now() - startedAt), 3000);
      }
      if (now - lastHud > 100) {
        lastHud = now;
        const st = standings(race);
        setHud(new Map(race.ships.map((s) => [s.id, {
          place: st.find((x) => x.playerId === s.id)!.place, gates: s.gatesHit, energy: s.energy, boost: s.boostT > 0, finished: s.finishedAt !== null, speed: s.speed,
        }])));
        for (const s of race.ships) kit.status(s.id, { bars: [{ label: "Energy", value: s.energy / 3, color: "#ffb020" }], text: `Gate ${Math.min(s.nextGate + 1, GATES)} / ${GATES}` });
        setDebug(JSON.stringify({ time: +race.time.toFixed(1), over: race.over, fps, ships: race.ships.map((s) => ({ id: s.id, dist: Math.round(s.dist), gates: s.gatesHit, boosts: boosts.get(s.id) })) }));
      }
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      offAction();
      scene.dispose();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const vps = viewports(racers.length);
  return (
    <div className="racer" data-racer={debug}>
      <canvas ref={canvas} className="racer-canvas" />
      {racers.map((p, i) => {
        const h = hud.get(p.id);
        const vp = vps[i]!;
        return (
          <div key={p.id} className="racer-hud" style={{ left: `${vp.x * 100}%`, top: `${vp.y * 100}%`, width: `${vp.w * 100}%`, height: `${vp.h * 100}%` }}>
            <div className="rh-top">
              <span className="chip" style={{ borderColor: p.color }}>{AVATARS[p.avatar].emoji} {p.name}</span>
              {racers.length > 1 && h && <span className="rh-place">#{h.place}</span>}
            </div>
            <div className="rh-bottom">
              <span className="chip">{t("racer.lap", { n: h?.gates ?? 0, total: GATES })}</span>
              <span className="rh-energy">{[0, 1, 2].map((k) => <i key={k} className={(h?.energy ?? 0) >= k + 1 ? "on" : (h?.energy ?? 0) > k ? "part" : ""} />)}</span>
              {h?.boost && <span className="rh-boost">{t("racer.boost")}!</span>}
            </div>
            {h?.finished && <div className="rh-finish">{t("racer.finish")}</div>}
          </div>
        );
      })}
      {count > 0 && <div className="racer-count">{count}</div>}
      {count === 0 && !over && <div className="racer-count go">{t("racer.go")}</div>}
      {paused && <div className="paused-overlay"><div className="big-title">⏸ Paused</div><p className="hint">Reconnecting…</p></div>}
    </div>
  );
}
