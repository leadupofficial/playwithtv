import { useEffect, useRef, useState } from "react";
import type { PlayerView } from "@playwithtv/protocol";
import type { GameProps } from "../types";
import { ControlPlayers } from "../controlKit";
import { ControlTutorial } from "../ControlTutorial";
import { placings } from "../scoring";
import { DT, newMatch, score, step, type BrawlInput, type Match } from "./engine";
import { cpuInput, newBrain, type Brain } from "./cpu";
import { BrawlControls, CONTROLS } from "./input";
import { Arena, loadArenaAssets, type ArenaAssets } from "./arena";
import { Hud, type HudState } from "./Hud";

export { CONTROLS };
const QUICK = typeof location !== "undefined" && new URLSearchParams(location.search).get("quick") === "1";
const MAX_FIGHTERS = 4;
const CPU_CREW: Array<[string, string]> = [["Captain Cushion", "#ff9f1c"], ["Duvet Diva", "#2ec4b6"], ["Sir Snooze", "#b5179e"], ["Pyjama Pip", "#7bd389"]];
const ORD = ["1st", "2nd", "3rd", "4th"];

/** Pillow Fort Brawl on the TV: up to 4 players (CPUs fill the bed to 4), best of three rounds. */
export function BrawlGame({ players, bridge, paused, onFinish }: GameProps) {
  const humans = useRef(players.filter((p) => p.connected).slice(0, MAX_FIGHTERS)).current;
  const kit = useRef<ControlPlayers | null>(null);
  kit.current ??= new ControlPlayers(bridge, humans.map((p) => p.id), CONTROLS);
  const controls = useRef<BrawlControls | null>(null);
  controls.current ??= new BrawlControls(kit.current, bridge, humans.map((p) => p.id));
  // start loading the 3D assets while everyone practises
  const assets = useRef<Promise<ArenaAssets> | null>(null);
  const [progress, setProgress] = useState(0);
  assets.current ??= loadArenaAssets(setProgress);
  const [practising, setPractising] = useState(true);
  useEffect(() => {
    kit.current!.start();
    controls.current!.start();
    const id = setInterval(() => controls.current!.practise(), 100);
    return () => {
      clearInterval(id);
      controls.current!.dispose();
      kit.current!.dispose();
    };
  }, []);
  if (practising) {
    return (
      <div className="tv" style={{ background: "#1b1440" }}>
        <ControlTutorial title="🪶 Pillow Fort Brawl" players={humans} kit={kit.current} practice={["swing", "dodge"]} quick={QUICK} onDone={() => setPractising(false)} />
      </div>
    );
  }
  return <Brawl humans={humans} kit={kit.current} controls={controls.current} bridge={bridge} paused={paused} onFinish={onFinish} assets={assets.current} progress={progress} />;
}

function Brawl({ humans, kit, controls, bridge, paused, onFinish, assets, progress }: {
  humans: PlayerView[]; kit: ControlPlayers; controls: BrawlControls; bridge: GameProps["bridge"]; paused: boolean;
  onFinish: GameProps["onFinish"]; assets: Promise<ArenaAssets>; progress: number;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const overlay = useRef<HTMLDivElement>(null);
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const [debug, setDebug] = useState("");
  const [hud, setHud] = useState<HudState | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true, raf = 0;
    let arena: Arena | null = null;
    assets.then((a) => {
      if (!alive) return;
      const looks = new Map<string, { name: string; color: string; cpu: boolean }>();
      for (const p of humans) looks.set(p.id, { name: p.name, color: p.color, cpu: false });
      const used = new Set(humans.map((p) => p.color.toLowerCase()));
      const crew = CPU_CREW.filter(([, c]) => !used.has(c));
      for (let i = 0; looks.size < MAX_FIGHTERS; i++) {
        const [name, color] = crew[i % crew.length]!;
        looks.set(`cpu${i}`, { name, color, cpu: true });
      }
      const entrants = [...looks].map(([id, l]) => ({ id, cpu: l.cpu }));
      const m: Match = newMatch(entrants, {
        seed: (Math.random() * 2 ** 31) >>> 0,
        roundSeconds: QUICK ? 16 : 75, roundsToWin: 2, maxRounds: 3,
        introSeconds: QUICK ? 1.5 : 4, countdownSeconds: QUICK ? 2 : 3, firstChaos: QUICK ? 5 : undefined,
      });
      const human = (id: string) => !looks.get(id)?.cpu;
      arena = new Arena(canvas.current!, overlay.current!, a, m.fighters.map((f) => ({ id: f.id, slot: f.slot, look: looks.get(f.id)! })), {
        vibrate: (id, ms) => human(id) && bridge.event(id, "vibrate", { ms }),
        toast: (id, text, tone) => human(id) && kit.toast(id, text, tone),
      });
      arena.announcer.say("PILLOW FORT BRAWL", { color: "#ffd23f", size: 120, ms: QUICK ? 1500 : 3600, sub: "The floor is lava! Knock everyone off the bed" });
      const brains = new Map<string, Brain>(m.fighters.filter((f) => f.cpu).map((f) => [f.id, newBrain()]));
      const inputs = new Map<string, BrawlInput>();
      const startedAt = Date.now();
      let last = performance.now(), acc = 0, frames = 0, fps = 0, fpsT = last, lastDebug = 0, lastPhone = 0, podiumAt = 0, reported = false;
      let lastPhase = m.phase;

      const finish = () => {
        reported = true;
        const all = placings(new Map(m.fighters.map((f) => [f.id, score(f)])));
        onFinish(all.filter((r) => human(r.playerId)), Date.now() - startedAt);
      };

      const frame = (now: number) => {
        raf = requestAnimationFrame(frame);
        frames++;
        if (now - fpsT >= 1000) { fps = Math.round((frames * 1000) / (now - fpsT)); frames = 0; fpsT = now; }
        const real = Math.min(0.1, (now - last) / 1000);
        last = now;
        let simDt = 0;
        if (!pausedRef.current) {
          simDt = arena!.clock.tick(real);
          acc += simDt;
          let steps = 0;
          while (acc >= DT && steps++ < 5) {
            acc -= DT;
            for (const f of m.fighters) inputs.set(f.id, f.cpu ? cpuInput(m, f, brains.get(f.id)!, DT) : controls.read(f.id));
            const ev = step(m, DT, inputs);
            if (ev.length) arena!.handle(ev, m);
            if (m.phase !== lastPhase) {
              if (m.phase === "countdown") controls.flush();
              if (m.phase === "podium") {
                for (const r of placings(new Map(m.fighters.map((f) => [f.id, score(f)])))) {
                  if (!human(r.playerId)) continue;
                  kit.outcome(r.playerId, r.place === 1 ? "Pillow Champion!" : `You came ${ORD[r.place - 1]}`, r.place === 1 ? "👑" : r.place === 2 ? "🥈" : "🪶");
                }
              }
              lastPhase = m.phase;
            }
          }
          if (acc > DT * 5) acc = 0;
        }
        arena!.render(m, pausedRef.current ? 0 : real, simDt);

        if (now - lastDebug > 120) {
          lastDebug = now;
          setDebug(JSON.stringify({
            phase: m.phase, round: m.round, left: Math.ceil(m.roundLeft), fps, calls: arena!.renderer.info.render.calls, tris: arena!.renderer.info.render.triangles, chaos: m.chaos?.kind ?? null, roundWinner: m.roundWinner, winner: m.matchWinner,
            players: m.fighters.map((f) => ({
              id: f.id, name: looks.get(f.id)!.name, cpu: f.cpu, x: +f.x.toFixed(2), z: +f.z.toFixed(2), alive: f.alive, state: f.state,
              damage: Math.round(f.damage), wins: f.stats.roundWins, kos: f.stats.kos, hits: f.stats.hits, score: score(f),
            })),
          }));
          setHud({
            phase: m.phase, round: m.round, maxRounds: m.maxRounds, left: m.roundLeft, roundsToWin: m.roundsToWin,
            fighters: m.fighters.map((f) => ({ id: f.id, name: looks.get(f.id)!.name, color: looks.get(f.id)!.color, wins: f.stats.roundWins, alive: f.alive, cpu: f.cpu })),
          });
        }
        if (now - lastPhone > 300) {
          lastPhone = now;
          for (const f of m.fighters) {
            if (f.cpu) continue;
            const ghost = !f.alive;
            kit.status(f.id, {
              text: m.phase === "podium" ? "Match over!" : ghost ? "👻 Ghost! Float over the bed and SWING to drop socks & feathers" : `Round ${m.round} · ${"⭐".repeat(f.stats.roundWins) || "no wins yet"}`,
              bars: ghost ? [] : [
                { label: "Charge", value: f.state === "charge" ? f.charge : 0, color: f.charge >= 1 ? "#ffd23f" : "#ff5d73" },
                { label: "Wobble", value: Math.min(1, f.damage / 150), color: "#ff9f1c" },
              ],
            });
          }
        }
        if (m.phase === "podium") {
          podiumAt ||= now;
          if (!reported && now - podiumAt > (QUICK ? 4500 : 9000)) finish();
        }
      };
      raf = requestAnimationFrame(frame);
    }).catch(() => alive && setFailed(true));
    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      arena?.dispose();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div style={{ position: "absolute", inset: 0, background: "#1b1440", overflow: "hidden" }} data-brawl={debug}>
      <canvas ref={canvas} width={1280} height={720} style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }} />
      <div ref={overlay} style={{ position: "absolute", inset: 0, pointerEvents: "none", fontFamily: "system-ui, 'Segoe UI', Roboto, sans-serif" }} />
      {hud && <Hud state={hud} />}
      {!debug && !failed && (
        <div className="center-screen" style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center" }}>
          <div className="big-title">🪶 Fluffing the pillows… {Math.round(progress * 100)}%</div>
        </div>
      )}
      {failed && <div className="paused-overlay"><div className="big-title">Couldn't load the bedroom</div><p className="hint">Check the connection and start the game again.</p></div>}
      {paused && <div className="paused-overlay"><div className="big-title">⏸ Paused</div><p className="hint">Reconnecting…</p></div>}
    </div>
  );
}
