import { useEffect, useRef, useState } from "react";
import type { ControlSpec, InputState, PlayerView } from "@playwithtv/protocol";
import type { GameProps } from "../types";
import { ControlPlayers, MODE_ICON } from "../controlKit";
import { ControlTutorial } from "../ControlTutorial";
import { placings } from "../scoring";
import { DT, NORMAL, QUICK, awards, funKcal, newMatch, phaseLeft, step, type Award, type GameEvent, type Intensity, type Match, type PlayerIn } from "./engine";
import { loadKit } from "./models";
import { SquatScene } from "./scene";
import { RocketSfx } from "./audio";
import { Cards, Podium, Prompts, TopBar, type CardState, type Pop, type Prompt } from "./Hud";
import "./rocket.css";

const IS_QUICK = typeof location !== "undefined" && new URLSearchParams(location.search).get("quick") === "1";

/**
 * Camera first: prop the phone up and play with your whole body (the phone tracks you; video never leaves it).
 * Buttons and motion are the fallbacks so nobody is left out, with the same rhythm caps as camera players.
 */
export const CONTROLS: ControlSpec = {
  title: "Squat Rocket",
  modes: ["camera", "buttons", "motion"],
  stick: "arrows-h",
  tilt: "steer",
  actions: [
    { id: "pump", label: "⛽ PUMP", color: "#ff7a00", gestures: ["push"], poses: ["squat"], seatedPoses: ["raise"] },
    { id: "dodge", label: "⤴ JUMP", color: "#2f8cff", gestures: ["flick-up"], poses: ["jump"], seatedPoses: ["punch"] },
    { id: "jack", label: "✳ JACK", color: "#23a55a", gestures: ["shake"], poses: ["jack"] },
    { id: "pause", label: "⏸ Pause", color: "#5b5b7a", poses: ["hands-on-head"], buttonIn: ["buttons"] },
  ],
  hints: {
    camera: "Phone propped up 2–3 m away: squat to pump fuel, jump to dodge, lean to steer, jumping jacks for the shield. Hands on head = pause",
    buttons: "PUMP for fuel (steady beats score best) · JUMP to dodge · ◀ ▶ steer · JACK powers the shield",
    motion: "Push to pump · flick up to dodge · tilt to steer · shake for the shield",
  },
};

const COACH: Record<string, string[]> = {
  warmup: ["Warm up! Reach up high, then a few slow squats", "Breathe… nice and easy", "Seated? Big arm raises!", "Roll your shoulders, loosen up"],
  fuel: ["Squat to pump fuel! Down… and up!", "Steady rhythm builds your combo", "Chest up, knees over toes", "Seated crew: arms up to pump!", "Slow and steady beats fast and wobbly"],
  launch: ["3… 2… 1… LIFT-OFF!"],
  climb: ["Meteors! JUMP when they get close", "Lean to grab the stars ⭐", "Keep squatting for a boost!", "Seated crew: PUNCH the meteors away!"],
  storm: ["ASTEROID STORM! Jumping jacks power the shield!", "Everyone together, keep it glowing!", "You've got this, team!"],
  finale: ["We made it to orbit! 🌌"],
  done: ["Great workout, everyone!"],
};
const ANNOUNCE: Record<string, string> = { fuel: "FUEL UP! SQUAT!", launch: "LIFT-OFF!", climb: "METEORS INCOMING!", storm: "ASTEROID STORM!", finale: "ORBIT REACHED!" };

/** Squat Rocket on the TV: 1-4 players, co-op and competitive. */
export function SquatRocketGame({ players, bridge, paused, onFinish }: GameProps) {
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
      <div className="tv" style={{ background: "#0b0820" }}>
        <ControlTutorial title="🚀 Squat Rocket" players={ids} kit={kit.current} practice={["pump"]} quick={IS_QUICK} onDone={() => setPractising(false)} />
      </div>
    );
  }
  return <Play ids={ids} kit={kit.current} bridge={bridge} paused={paused} onFinish={onFinish} />;
}

interface Raw { s: number; i: number; q: number; cs: number }
interface HudState {
  phase: Match["phase"]; left: number; total: number; coach: string; shield: number | null; cards: CardState[];
  prompts: Prompt[]; pops: Pop[]; announce: { text: string; key: number } | null; pausedBy: string | null;
  podium: { ranking: Array<{ id: string; score: number; place: number }>; awards: Award[]; stats: Array<{ id: string; line: string }>; team: string } | null;
}

function Play({ ids, kit, bridge, paused, onFinish }: { ids: PlayerView[]; kit: ControlPlayers; bridge: GameProps["bridge"]; paused: boolean; onFinish: GameProps["onFinish"] }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const [hud, setHud] = useState<HudState | null>(null);
  const [debug, setDebug] = useState("");

  useEffect(() => {
    let disposed = false;
    let raf = 0;
    let scene: SquatScene | null = null;
    const sfx = new RocketSfx();
    const raw = new Map<string, Raw>();
    const offRaw = bridge.onInput((id, st: InputState) => {
      const a = st.axes ?? {};
      raw.set(id, { s: a.s ?? 0, i: a.i ?? 0.5, q: a.q ?? 0, cs: a.cs ?? 1 });
    });
    const queue: Array<{ id: string; action: string }> = [];
    let pausedBy: string | null = null, pausedAt = 0;
    const name = (id: string) => ids.find((p) => p.id === id)?.name ?? "?";
    const offAction = kit.onAction((id, action) => {
      if (action === "pause") {
        const now = performance.now();
        if (!pausedBy) { pausedBy = id; pausedAt = now; sfx.play("tick"); }
        else if (now - pausedAt > 1500) pausedBy = null;
        return;
      }
      if (!pausedBy) queue.push({ id, action });
    });
    const camera = (id: string) => kit.mode(id) === "camera";
    const input = (id: string): PlayerIn => {
      const r = kit.get(id), a = raw.get(id);
      const cam = camera(id);
      const intensity = (cam && a ? Math.round(a.i * 2) : 1) as Intensity;
      return { ok: r.ok, lean: r.x, intensity, seated: cam && !!a && a.s > 0.5, quality: cam ? a?.q ?? 0 : 0.85 };
    };
    const timing = IS_QUICK ? QUICK : NORMAL;
    const match = newMatch(ids.map((p) => p.id), { timing, seed: (Math.random() * 2 ** 31) >>> 0 });
    const pops: Pop[] = [];
    let popKey = 0;
    let announce: HudState["announce"] = { text: "WARM UP!", key: 0 };
    const pop = (id: string, text: string, color: string) => {
      const p = scene?.screenPos(id);
      // stack pops for the same rocket so two at once stay readable
      if (p) {
        const stacked = pops.filter((q) => q.key > popKey - 4 && Math.abs(q.x - p.x) < 60).length;
        pops.push({ key: ++popKey, x: p.x, y: Math.max(250, p.y - 40) + stacked * 56, text, color });
      }
      if (pops.length > 12) pops.shift();
    };
    const verb = (id: string) => (camera(id) ? (input(id).seated ? "PUNCH!" : "JUMP!") : kit.mode(id) === "motion" ? "FLICK UP!" : "TAP JUMP!");
    const handle = (evs: GameEvent[]) => {
      for (const e of evs) {
        if (e.kind === "phase") {
          if (ANNOUNCE[e.phase]) announce = { text: ANNOUNCE[e.phase]!, key: ++popKey };
          if (e.phase === "launch") sfx.play("launch", 0.8);
          if (e.phase === "storm") sfx.play("storm", 0.9);
          if (e.phase === "finale") sfx.play("win", 0.8);
        } else if (e.kind === "rep") {
          scene?.pump(e.id, e.perfect);
          sfx.play(e.perfect ? "perfect" : "pump", e.perfect ? 0.5 : 0.6, 1 + Math.min(e.combo, 10) * 0.03);
          pop(e.id, e.perfect ? `PERFECT! +${e.points}` : `+${e.points}`, e.perfect ? "#ffe066" : "#fff");
          if (e.combo > 1 && e.combo % 5 === 0) { sfx.play("combo", 0.5); kit.toast(e.id, `🔥 ${e.combo}× combo!`, "good"); }
          else if (e.perfect) kit.toast(e.id, "✨ PERFECT form!", "good");
        } else if (e.kind === "too-fast") {
          pop(e.id, "Slow & steady!", "#9fd8ff");
          kit.toast(e.id, "🐢 Slow and steady: fast reps don't count", "info");
        } else if (e.kind === "tank-full") {
          scene?.tankFull(e.id);
          sfx.play("combo", 0.7);
          pop(e.id, "TANK FULL! +25", "#3ee08f");
          kit.toast(e.id, "⛽ Tank full! Keep going for points", "good");
        } else if (e.kind === "warm") {
          scene?.pump(e.id, false);
        } else if (e.kind === "boost") {
          sfx.play("pump", 0.4, 1.3);
          pop(e.id, "BOOST!", "#ffb347");
        } else if (e.kind === "warn") {
          kit.toast(e.id, `☄️ Meteor! ${verb(e.id)}`, "info");
        } else if (e.kind === "dodge") {
          scene?.dodge(e.id);
          sfx.play("dodge", 0.6);
          pop(e.id, e.perfect ? `PERFECT DODGE! +${e.points}` : `DODGED! +${e.points}`, "#58e6ff");
        } else if (e.kind === "hit") {
          scene?.hit(e.id);
          sfx.play("hit", 0.6);
          pop(e.id, "BONK! Shake it off", "#ff9a7a");
          bridge.event(e.id, "vibrate", { ms: 200 });
        } else if (e.kind === "star") {
          scene?.star(e.id);
          sfx.play("perfect", 0.4, 1.5);
          pop(e.id, "⭐ +8", "#ffe066");
        } else if (e.kind === "jack") {
          scene?.jack();
          sfx.play("shield", 0.35, 1, 150);
          pop(e.id, `+${e.points}`, "#58e6ff");
        } else if (e.kind === "storm") {
          announce = { text: e.beaten ? "STORM BEATEN!" : "WE MADE IT THROUGH!", key: ++popKey };
        }
      }
    };

    const startedAt = Date.now();
    let last = performance.now(), acc = 0, lastHud = 0, lastPhone = 0, frames = 0, fps = 0, fpsT = last;
    let doneAt = 0, reported = false, podium: HudState["podium"] = null;
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      frames++;
      if (now - fpsT >= 1000) { fps = frames; frames = 0; fpsT = now; }
      const real = Math.min(0.1, (now - last) / 1000);
      last = now;
      const frozen = pausedRef.current || !!pausedBy;
      if (!frozen) {
        acc += real;
        while (acc >= DT) {
          acc -= DT;
          const acts = queue.splice(0);
          handle(step(match, DT, input, acts));
          scene?.update(match, DT);
        }
      }
      scene?.render();
      if (match.phase === "done") {
        doneAt ||= now;
        if (!podium) podium = buildPodium(match, ids, name);
        if (!reported && now - doneAt > (IS_QUICK ? 3500 : 9000)) {
          reported = true;
          const scores = new Map(match.rockets.map((r) => [r.id, r.score]));
          for (const r of match.rockets) {
            const place = placings(scores).find((p) => p.playerId === r.id)!.place;
            kit.outcome(r.id, `${place === 1 ? "You won!" : `You came ${["1st", "2nd", "3rd", "4th"][place - 1]}`} · ${r.reps} reps · ${r.score} pts`, place === 1 ? "🏆" : "🚀");
          }
          onFinish(placings(scores), Date.now() - startedAt);
        }
      }
      if (now - lastHud > 100) {
        lastHud = now;
        const prompts: Prompt[] = [];
        for (const d of match.debris) {
          if (d.kind !== "meteor" || d.state !== "incoming") continue;
          const until = d.at - match.time;
          if (until > 1.3) continue;
          const p = scene?.screenPos(d.target);
          if (p) prompts.push({ id: d.target, x: p.x, y: Math.max(260, p.y - 30), text: verb(d.target), urgency: Math.max(0, 1 - until / 1.3), color: ids.find((x) => x.id === d.target)!.color });
        }
        while (pops.length && pops[0]!.key < popKey - 10) pops.shift();
        const cards: CardState[] = match.rockets.map((r) => {
          const a = raw.get(r.id), cam = camera(r.id);
          const cs = cam ? a?.cs ?? 0 : 1;
          return {
            id: r.id, reps: r.reps + r.jacks + r.dodges, fuel: r.fuel, combo: r.combo, score: r.score, icon: MODE_ICON[kit.mode(r.id)],
            track: cs >= 0.9 ? "ok" : cs >= 0.7 ? "lost" : cs >= 0.45 ? "calib" : "setup", seated: input(r.id).seated, pump: "moves",
          };
        });
        const coachList = COACH[match.phase]!;
        setHud({
          phase: match.phase, left: phaseLeft(match), total: match.phase === "done" ? 1 : match.timing[match.phase], shield: match.phase === "storm" ? match.shield : null,
          coach: coachList[Math.floor(match.time / 5) % coachList.length]!, cards, prompts, pops: [...pops], announce, pausedBy: pausedBy ? name(pausedBy) : null, podium,
        });
        if (now - lastPhone > 300) {
          lastPhone = now;
          for (const r of match.rockets) {
            const text = pausedBy ? "⏸ Paused · hands on head or tap Pause to resume"
              : match.phase === "warmup" ? "🔥 Warm-up: easy moves" : match.phase === "fuel" ? "⛽ Pump fuel!" : match.phase === "climb" ? "☄️ Dodge meteors · lean for stars"
              : match.phase === "storm" ? "🛡️ Jumping jacks!" : match.phase === "done" ? "🏁 Mission complete" : "🚀 Flying!";
            kit.status(r.id, { text, bars: match.phase === "storm" ? [{ label: "Shield", value: match.shield, color: "#58e6ff" }] : [{ label: "Fuel", value: r.fuel }] });
          }
        }
        setDebug(JSON.stringify({
          phase: match.phase, t: +match.t.toFixed(1), time: +match.time.toFixed(1), shield: +match.shield.toFixed(2), paused: !!pausedBy, fps, beaten: match.stormBeaten,
          incoming: match.debris.filter((d) => d.kind === "meteor" && d.state === "incoming").map((d) => ({ id: d.target, in: +(d.at - match.time).toFixed(2) })),
          rockets: match.rockets.map((r) => ({
            id: r.id, name: name(r.id), mode: kit.mode(r.id), ok: kit.get(r.id).ok, reps: r.reps, fuel: +r.fuel.toFixed(2), score: r.score, alt: Math.round(r.altitude),
            dodges: r.dodges, hits: r.hits, jacks: r.jacks, perfect: r.perfect, warm: r.warm, stars: r.stars, combo: r.bestCombo,
          })),
        }));
      }
    };

    loadKit().then((models) => {
      if (disposed) return;
      scene = new SquatScene(canvas.current!, models, ids.map((p) => ({ id: p.id, name: p.name, color: p.color })));
      last = performance.now();
      raf = requestAnimationFrame(frame);
    });
    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      offAction();
      offRaw();
      sfx.dispose();
      scene?.dispose();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="sr-root" data-rocket={debug}>
      <canvas ref={canvas} width={1280} height={720} className="sr-canvas" />
      {!hud && <div className="sr-loading"><div className="big-title">🚀 Squat Rocket</div><p className="hint">Fuelling the launch pad…</p></div>}
      {hud && !hud.podium && (
        <>
          <TopBar phase={hud.phase} left={hud.left} total={hud.total} coach={hud.coach} shield={hud.shield} />
          <Prompts prompts={hud.prompts} pops={hud.pops} />
          {hud.announce && <div className="sr-announce" key={hud.announce.key}>{hud.announce.text}</div>}
          <Cards players={ids} cards={hud.cards} />
        </>
      )}
      {hud?.podium && <Podium players={ids} {...hud.podium} />}
      {(paused || hud?.pausedBy) && (
        <div className="paused-overlay sr-paused">
          <div className="big-title">⏸ Paused</div>
          <p className="hint">{paused ? "Reconnecting…" : `${hud!.pausedBy} paused the game. Hands on your head again, or tap Pause on your phone, to carry on.`}</p>
          <p className="hint">Need a breather? Take your time and grab some water 💧</p>
        </div>
      )}
    </div>
  );
}

function buildPodium(m: Match, ids: PlayerView[], name: (id: string) => string): HudState["podium"] {
  const scores = new Map(m.rockets.map((r) => [r.id, r.score]));
  const ranking = placings(scores).map((p) => ({ id: p.playerId, score: p.score, place: p.place }));
  const stats = m.rockets.map((r) => ({ id: r.id, line: `${name(r.id)}: ${r.reps} reps · ${r.jacks} jacks · ${r.dodges} dodges · about ${funKcal(r)} kcal of fun (a playful guess)` }));
  const team = m.stormBeaten ? `Team result: storm beaten! The rockets climbed ${Math.round(m.rockets.reduce((a, r) => a + r.altitude, 0) / 1000)} km together.` : "Team result: the shield cracked, but every rocket made it through!";
  void ids;
  return { ranking, awards: awards(m, name), stats, team };
}
