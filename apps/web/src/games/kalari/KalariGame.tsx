import { useEffect, useRef, useState } from "react";
import type { PlayerView } from "@playwithtv/protocol";
import type { GameProps } from "../types";
import { ControlPlayers } from "../controlKit";
import { ControlTutorial } from "../ControlTutorial";
import { placings } from "../scoring";
import { showAwards } from "../kit3d/podium";
import { useQuality } from "../../quality/store";
import type { QualityProfile } from "../../quality/tier";
import { DT, newMatch, score, standings, step, type KalariInput, type Match } from "./engine";
import { cpuInput, newBrain, type Brain } from "./cpu";
import { CONTROLS, KalariControls } from "./input";
import { arenaDef } from "./arenas";
import { ROSTER, character, type FighterId } from "./rules";
import { awards } from "./awards";
import { Hud, type HudState } from "./Hud";
import { Select, type Picks } from "./Select";
import { A, type Look, type StageView } from "./view/common";
import { Juice } from "./view/juice";
import "./kalari.css";

export { CONTROLS };
const params = typeof location !== "undefined" ? new URLSearchParams(location.search) : new URLSearchParams();
const QUICK = params.get("quick") === "1";
const CPU_NAMES = ["Appu", "Chinnu", "Kannan", "Meenu", "Unni", "Ammu"];
const CPU_COLORS = ["#ff9f1c", "#2ec4b6", "#b5179e", "#7bd389", "#f4f1de", "#8d6e63"];
const ORD = ["1st", "2nd", "3rd", "4th"];

/** KALARI CLASH on the TV: get ready → character select → best-of-three clash (CPUs fill to four) → podium. */
export function KalariGame({ players, bridge, paused, onFinish }: GameProps) {
  const humans = useRef(players.filter((p) => p.connected).slice(0, 4)).current;
  const kit = useRef<ControlPlayers | null>(null);
  kit.current ??= new ControlPlayers(bridge, humans.map((p) => p.id), CONTROLS);
  const controls = useRef<KalariControls | null>(null);
  controls.current ??= new KalariControls(kit.current, bridge, humans.map((p) => p.id));
  const [stage, setStage] = useState<"tutorial" | "select" | "fight">("tutorial");
  const [picks, setPicks] = useState<Picks | null>(null);
  const quality = useQuality();
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
  if (stage === "tutorial") {
    return (
      <div className="tv" style={{ background: "#1c0f1a" }}>
        <ControlTutorial title="🥋 Kalari Clash" players={humans} kit={kit.current} practice={["strike", "guard"]} quick={QUICK}
          onDone={() => { controls.current!.flush(); setStage("select"); }} />
      </div>
    );
  }
  if (stage === "select" || !picks || !quality.ready) {
    return (
      <div className="kalari-root">
        <Select humans={humans} kit={kit.current} controls={controls.current} quick={QUICK} initialArena={params.get("arena")}
          onDone={(p) => { controls.current!.flush(); setPicks(p); setStage("fight"); }} />
      </div>
    );
  }
  return <Clash humans={humans} kit={kit.current} controls={controls.current} bridge={bridge} paused={paused} onFinish={onFinish} picks={picks} profile={quality.profile} tier={quality.tier} />;
}

function Clash({ humans, kit, controls, bridge, paused, onFinish, picks, profile, tier }: {
  humans: PlayerView[]; kit: ControlPlayers; controls: KalariControls; bridge: GameProps["bridge"]; paused: boolean;
  onFinish: GameProps["onFinish"]; picks: Picks; profile: QualityProfile; tier: string;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const overlay = useRef<HTMLDivElement>(null);
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const [debug, setDebug] = useState("");
  const [hud, setHud] = useState<HudState | null>(null);
  const [progress, setProgress] = useState(0);
  const [failed, setFailed] = useState(false);
  const [letterbox, setLetterbox] = useState(false);
  const trail = useRef(new Map<string, number>());
  const arena = arenaDef(picks.arena);

  useEffect(() => {
    let alive = true, raf = 0;
    let view: StageView | null = null, juice: Juice | null = null;
    // entrants: people first, then CPUs on the fighters nobody picked
    const looks: Look[] = humans.map((p) => ({ id: p.id, name: p.name, color: p.color, char: picks.chars.get(p.id) ?? "simha", cpu: false }));
    const free = ROSTER.map((c) => c.id).filter((c) => !looks.some((l) => l.char === c));
    for (let i = 0; looks.length < 4; i++) {
      const char: FighterId = free[i] ?? ROSTER[i % ROSTER.length]!.id;
      looks.push({ id: `cpu${i}`, name: CPU_NAMES[i]!, color: CPU_COLORS.find((c) => !looks.some((l) => l.color.toLowerCase() === c))!, char, cpu: true });
    }
    const lookMap = new Map(looks.map((l) => [l.id, l]));
    const chars = looks.map((l) => l.char);
    const load = profile.prerendered
      ? import("./view/lite").then(async (mod) => { const a = await mod.loadLite(arena, chars, setProgress); return () => new mod.LiteView(canvas.current!, profile, arena, a, looks); })
      : import("./view/real").then(async (mod) => {
        const a = await mod.loadReal(arena, chars, setProgress);
        return async () => { const v = new mod.RealView(canvas.current!, profile, arena, a, looks); await v.ready; return v; };
      });
    load.then(async (make) => {
      if (!alive) return;
      view = await make();
      if (!alive) { view.dispose(); return; }
      const human = (id: string) => !lookMap.get(id)?.cpu;
      juice = new Juice(overlay.current!, lookMap, {
        vibrate: (id, ms) => human(id) && bridge.event(id, "vibrate", { ms }),
        toast: (id, text, tone) => human(id) && kit.toast(id, text, tone),
      });
      const m: Match = newMatch(looks.map((l) => ({ id: l.id, cpu: l.cpu, char: l.char })), {
        seed: (Math.random() * 2 ** 31) >>> 0, arena: arena.id,
        roundSeconds: QUICK ? 20 : 90, introSeconds: QUICK ? 1.6 : 4.2, countdownSeconds: QUICK ? 2 : 3,
      });
      juice.announcer.say("KALARI CLASH", { color: "#ffd23f", size: 130, ms: QUICK ? 1500 : 3800, sub: arena.name });
      const brains = new Map<string, Brain>(m.fighters.filter((f) => f.cpu).map((f, i) => [f.id, newBrain(17 + i * 31)]));
      const inputs = new Map<string, KalariInput>();
      const cheer = new Set<string>();
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
          simDt = juice!.clock.tick(real);
          acc += simDt;
          let steps = 0;
          while (acc >= DT && steps++ < 5) {
            acc -= DT;
            for (const f of m.fighters) inputs.set(f.id, f.cpu ? cpuInput(m, f, brains.get(f.id)!, DT) : controls.read(f.id));
            const ev = step(m, DT, inputs);
            if (ev.length) {
              juice!.handle(ev, m, view!, view!.fx);
              view!.react(ev, m);
              for (const e of ev) {
                if (e.kind === "round-end") { cheer.clear(); if (e.winner) cheer.add(e.winner); }
                if (e.kind === "phase" && e.phase === "countdown") cheer.clear();
              }
            }
            if (m.phase !== lastPhase) {
              if (m.phase === "countdown") controls.flush();
              if (m.phase === "podium") {
                const order = standings(m).map((f) => f.id);
                view!.podium(order);
                const cards = awards(m).map((a) => ({ emoji: a.emoji, title: a.title, detail: a.detail, name: lookMap.get(a.playerId)?.name ?? "?", color: lookMap.get(a.playerId)?.color ?? "#fff" }));
                showAwards(overlay.current!, "🏆 KALARI CHAMPIONS 🏆", cards);
                for (const r of placings(new Map(m.fighters.map((f) => [f.id, score(f)])))) {
                  if (!human(r.playerId)) continue;
                  kit.outcome(r.playerId, r.place === 1 ? "Kalari Champion!" : `You came ${ORD[r.place - 1]}`, r.place === 1 ? "👑" : r.place === 2 ? "🥈" : "🥋");
                }
              }
              lastPhase = m.phase;
            }
          }
          if (acc > DT * 5) acc = 0;
        }
        view!.render(m, pausedRef.current ? 0 : real, simDt, cheer, juice!.shake.update(real));
        juice!.updateTags(m, view!, !view!.director.inCloseUp);

        if (now - lastDebug > 120) {
          lastDebug = now;
          setLetterbox(view!.director.inCloseUp || m.phase === "intro");
          const r = view!.renderer.info.render;
          setDebug(JSON.stringify({
            phase: m.phase, round: m.round, left: Math.ceil(m.roundLeft), fps, calls: r.calls, tris: r.triangles, tier, arena: arena.id,
            winner: m.matchWinner, roundWinner: m.roundWinner,
            players: m.fighters.map((f) => ({
              id: f.id, name: lookMap.get(f.id)!.name, char: f.char, cpu: f.cpu, x: +f.x.toFixed(2), z: +f.z.toFixed(2), alive: f.alive, state: f.state,
              health: Math.round(f.health), meter: Math.round(f.meter), wins: f.stats.roundWins, kos: f.stats.kos, ringouts: f.stats.ringouts, falls: f.stats.falls,
              hits: f.stats.hits, blocks: f.stats.blocks, parries: f.stats.parries, rolls: f.stats.rolls, specials: f.stats.specials, score: score(f),
              got: controls.received.get(f.id) ?? null,
            })),
          }));
          for (const f of m.fighters) {
            const t = trail.current.get(f.id) ?? 100;
            trail.current.set(f.id, f.health > t || m.phase !== "fight" ? f.health : t + (f.health - t) * 0.25);
          }
          setHud({
            phase: m.phase, round: m.round, roundsToWin: m.roundsToWin, left: m.roundLeft,
            fighters: m.fighters.map((f) => ({ id: f.id, name: lookMap.get(f.id)!.name, color: lookMap.get(f.id)!.color, char: f.char, health: f.health, meter: f.meter, wins: f.stats.roundWins, alive: f.alive, cpu: f.cpu })),
          });
        }
        if (now - lastPhone > 300) {
          lastPhone = now;
          for (const f of m.fighters) {
            if (f.cpu) continue;
            const c = character(f.char);
            kit.status(f.id, {
              text: m.phase === "podium" ? "Match over!" : !f.alive ? "Out for this round: cheer them on!" : f.meter >= 100 ? `🔥 ${c.special.name} READY: press SPECIAL!` : `${c.name} · Round ${m.round} · ${"⭐".repeat(f.stats.roundWins) || "no wins yet"}`,
              bars: f.alive ? [
                { label: "Health", value: f.health / 100, color: f.health < 30 ? "#ff4d4d" : "#ffd23f" },
                { label: "Special", value: f.meter / 100, color: f.meter >= 100 ? "#ff7a00" : c.color },
              ] : [],
            });
          }
        }
        if (m.phase === "podium") {
          podiumAt ||= now;
          if (!reported && now - podiumAt > (QUICK ? 10000 : 12000)) finish();
        }
      };
      raf = requestAnimationFrame(frame);
    }).catch((e) => { console.error(e); if (alive) setFailed(true); });
    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      juice?.dispose();
      view?.dispose();
      overlay.current?.replaceChildren();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className={`kalari-root kalari-letterbox ${letterbox ? "on" : ""}`} data-kalari={debug}>
      <canvas ref={canvas} className="kalari-canvas" width={profile.resolution.w} height={profile.resolution.h} />
      <div ref={overlay} className="kalari-overlay" />
      {hud && hud.phase !== "podium" && <Hud state={hud} trail={trail.current} />}
      {!debug && !failed && (
        <div className="kalari-loading" style={{ backgroundImage: `url(${A}${arena.id}-card.webp)` }}>
          <div>🥋 {arena.name}… {Math.round(progress * 100)}%</div>
        </div>
      )}
      {failed && <div className="paused-overlay"><div className="big-title">Couldn't load the arena</div><p className="hint">Check the connection and start the game again.</p></div>}
      {paused && <div className="paused-overlay"><div className="big-title">⏸ Paused</div><p className="hint">Reconnecting…</p></div>}
    </div>
  );
}
