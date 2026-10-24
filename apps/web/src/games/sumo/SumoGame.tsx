import { useEffect, useRef, useState } from "react";
import type { ControlSpec, PlayerView } from "@playwithtv/protocol";
import type { GameProps } from "../types";
import { AVATARS } from "../../avatars";
import { ControlPlayers } from "../controlKit";
import { ControlTutorial } from "../ControlTutorial";
import { placings } from "../scoring";
import { NO_INPUT, newBout, scoreOf, step, type SumoEvent, type SumoInput } from "./engine";
import { H, W, animate, burst, draw, newView, puff, type Look } from "./render";
import { SumoSfx } from "./audio";

const QUICK = typeof location !== "undefined" && new URLSearchParams(location.search).get("quick") === "1";
const DT = 1 / 60;
const MIN_WRESTLERS = 4;
const CPU_CREW: Array<[string, string]> = [["Thunder", "#ff9f1c"], ["Rocky Rice", "#2ec4b6"], ["Pillow", "#b5179e"], ["Mountain", "#7bd389"]];

/**
 * Buttons first: a joystick gives precise footwork when eight wrestlers crowd the ring, and SHOVE/BRACE never
 * misfire. Motion is the workout version (tilt to walk, push to shove, pull to brace); touchpad suits anyone
 * who would rather drag a finger.
 */
export const CONTROLS: ControlSpec = {
  title: "Motion Sumo",
  modes: ["buttons", "motion", "touchpad"],
  stick: "joystick",
  tilt: "aim",
  actions: [
    { id: "shove", label: "💥 SHOVE", color: "#e2384d", gestures: ["push"], swipes: ["tap"] },
    { id: "brace", label: "🛡 BRACE", color: "#1f6fd6", hold: true, gestures: ["pull"], buttonIn: ["buttons", "touchpad"] },
  ],
  hints: {
    buttons: "Joystick to walk · SHOVE to charge (uses stamina) · hold BRACE to stand firm",
    motion: "Tilt the phone to walk · push it towards the TV to shove · pull it back to brace",
    touchpad: "Hold your finger towards where to walk · tap to shove · hold BRACE to stand firm",
  },
};

/** Motion Sumo on the TV: 1–8 players, CPU wrestlers fill the ring to 4. Last one inside wins the round. */
export function SumoGame({ players, bridge, paused, onFinish, sponsor }: GameProps) {
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
      <div className="tv" style={{ background: "#1c1430" }}>
        <ControlTutorial title="🤼 Motion Sumo" players={humans} kit={kit.current} practice={["shove"]} quick={QUICK} onDone={() => setPractising(false)} />
      </div>
    );
  }
  return <Match humans={humans} kit={kit.current} bridge={bridge} paused={paused} onFinish={onFinish} sponsor={sponsor?.name} />;
}

function Match({ humans, kit, bridge, paused, onFinish, sponsor }: {
  humans: PlayerView[]; kit: ControlPlayers; bridge: GameProps["bridge"]; paused: boolean; onFinish: GameProps["onFinish"]; sponsor?: string;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const [debug, setDebug] = useState("");

  useEffect(() => {
    const looks = new Map<string, Look>();
    for (const p of humans) looks.set(p.id, { name: p.name, color: p.color, emoji: AVATARS[p.avatar].emoji, cpu: false });
    const used = new Set(humans.map((p) => p.color.toLowerCase()));
    const crew = CPU_CREW.filter(([, c]) => !used.has(c));
    for (let i = 0; looks.size < MIN_WRESTLERS; i++) {
      const [name, color] = crew[i % crew.length]!;
      looks.set(`cpu${i}`, { name, color, emoji: "🤖", cpu: true });
    }
    const bout = newBout([...looks].map(([id, l]) => ({ id, cpu: l.cpu })), {
      toWin: QUICK ? 1 : 2, seed: (Math.random() * 2 ** 31) >>> 0, shrinkAt: QUICK ? 4 : 12, shrinkDur: QUICK ? 10 : 22,
    });
    const view = newView(looks, sponsor);
    const sfx = new SumoSfx();
    const inputs = new Map<string, SumoInput>(humans.map((p) => [p.id, { ...NO_INPUT }]));
    const shoves = new Set<string>(), braces = new Set<string>();
    const offAction = kit.onAction((id, a) => {
      if (a === "shove") shoves.add(id);
      if (a === "brace") braces.add(id);
    });
    const human = (id: string) => inputs.has(id);
    const nameOf = (id: string) => looks.get(id)!.name;
    const wOf = (id: string) => bout.wrestlers.find((w) => w.id === id)!;
    const vibrate = (id: string, ms: number) => human(id) && bridge.event(id, "vibrate", { ms });

    const read = (id: string, inp: SumoInput) => {
      const m = kit.get(id);
      const tilt = kit.mode(id) === "motion" ? 1.3 : 1; // reaching full speed should not need a big tilt
      inp.x = m.ok ? Math.max(-1, Math.min(1, m.x * tilt)) : 0;
      inp.y = m.ok ? Math.max(-1, Math.min(1, m.y * tilt)) : 0;
      inp.brace = m.ok && m.held("brace");
      inp.braceTap = braces.has(id);
      inp.shove = shoves.has(id);
    };

    const handle = (ev: SumoEvent[]) => {
      for (const e of ev) {
        if (e.kind === "round-start") {
          sfx.drum(3);
          view.banner = { text: `ROUND ${e.round}`, sub: "Get ready…", color: "#fff", t: 0, dur: 1.6 };
        } else if (e.kind === "fight") {
          sfx.drum(1);
          view.banner = { text: "PUSH!", color: "#ffd23f", t: 0, dur: 0.9 };
        } else if (e.kind === "shove") {
          sfx.whoosh(e.weak);
          const w = wOf(e.id);
          puff(view, w.x - w.fx * 30, w.y - w.fy * 30);
          if (e.weak && human(e.id)) kit.toast(e.id, "😮‍💨 Out of breath: weak shove", "info");
        } else if (e.kind === "slam") {
          sfx.slam(e.braced);
          view.shake = e.braced ? 4 : 9;
          const o = wOf(e.on);
          burst(view, o.x, o.y - 50, e.braced ? "BRACED!" : "SLAM!", e.braced ? "#7fe3ff" : "#ffd23f");
          vibrate(e.on, e.braced ? 60 : 180);
        } else if (e.kind === "bump") {
          sfx.bump();
        } else if (e.kind === "shrink") {
          sfx.shrink();
          for (const id of inputs.keys()) kit.toast(id, "⚠ The ring is shrinking!", "info");
        } else if (e.kind === "ringout") {
          sfx.out();
          const w = wOf(e.id);
          burst(view, w.x, w.y - 40, "OUT!", "#ff5d73", true);
          vibrate(e.id, 400);
          if (human(e.id)) kit.toast(e.id, e.by ? `💨 ${nameOf(e.by)} pushed you out!` : "💨 You stepped out!", "bad");
          if (e.by && human(e.by)) kit.toast(e.by, `💥 You pushed ${nameOf(e.id)} out!`, "good");
        } else if (e.kind === "round-end") {
          view.banner = { text: `${nameOf(e.winner)}`, sub: `wins round ${e.round}!`, color: looks.get(e.winner)!.color, t: 0, dur: 2.6 };
          sfx.drum(2);
          for (const id of inputs.keys()) kit.toast(id, id === e.winner ? "🏆 You won the round!" : `${nameOf(e.winner)} won the round`, id === e.winner ? "good" : "info");
        } else if (e.kind === "over") {
          sfx.gong();
          view.banner = { text: "CHAMPION", sub: nameOf(e.winner), color: "#ffd23f", t: 0, dur: 4.5 };
        }
      }
    };

    const ctx = canvas.current!.getContext("2d")!;
    const startedAt = Date.now();
    let raf = 0, last = performance.now(), acc = 0, lastHud = 0, frames = 0, fps = 0, fpsT = last, overAt = 0, reported = false;
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
          shoves.clear();
          braces.clear();
          handle(step(bout, DT, inputs));
          animate(view, DT);
        }
      }
      draw(ctx, bout, view);
      if (now - lastHud > 250) {
        lastHud = now;
        for (const id of inputs.keys()) {
          const w = wOf(id);
          kit.status(id, {
            text: `Round ${bout.round} · ${w.wins} win${w.wins === 1 ? "" : "s"}${w.out && bout.phase === "fight" ? " · OUT" : ""}`,
            bars: [{ label: "Stamina", value: w.stamina / 100, color: w.stamina < 30 ? "#ff5d73" : "#ffd23f" }],
          });
        }
        setDebug(JSON.stringify({
          phase: bout.phase, round: bout.round, ring: Math.round(bout.ring), roundWinner: bout.roundWinner, winner: bout.winner, fps,
          w: bout.wrestlers.map((w) => ({
            id: w.id, name: looks.get(w.id)!.name, cpu: w.cpu, x: Math.round(w.x), y: Math.round(w.y), out: w.out, wins: w.wins, ringouts: w.ringouts,
            shoves: w.shoves, stamina: Math.round(w.stamina), bracing: w.bracing,
          })),
        }));
      }
      if (bout.phase === "over") {
        if (!overAt) {
          overAt = now;
          for (const id of inputs.keys()) {
            const won = bout.winner === id;
            kit.outcome(id, won ? "You are the champion!" : `${nameOf(bout.winner!)} is the champion`, won ? "🏆" : "🤼");
          }
        }
        if (!reported && now - overAt > 4500) {
          reported = true;
          const all = placings(new Map(bout.wrestlers.map((w) => [w.id, scoreOf(w)])));
          onFinish(all.filter((r) => human(r.playerId)), Date.now() - startedAt);
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
    <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", background: "#1c1430" }} data-sumo={debug}>
      <canvas ref={canvas} width={W} height={H} style={{ width: "100%", height: "100%", objectFit: "contain" }} />
      {paused && <div className="paused-overlay"><div className="big-title">⏸ Paused</div><p className="hint">Reconnecting…</p></div>}
    </div>
  );
}
