import { useEffect, useRef, useState } from "react";
import type { ControlSpec, PlayerView } from "@playwithtv/protocol";
import type { GameProps } from "../types";
import { AVATARS } from "../../avatars";
import { ControlPlayers } from "../controlKit";
import { ControlTutorial } from "../ControlTutorial";
import { clamp, type Dive, type Outcome } from "./geometry";
import {
  NORMAL_TIMING, QUICK_TIMING, cpuKeepPlan, cpuKeeperDive, cpuKickPlan, cpuKickerInput, newKick, stepKick,
  type CpuKeepPlan, type CpuKickPlan, type KickEvent, type KickerInput,
} from "./kick";
import { CPU, NORMAL_MATCH, QUICK_MATCH, current, newMatch, record, results, type Pairing } from "./match";
import { KEEPER_SPEC, KICKER_SPEC, PadTrail, TUTORIAL_SPEC, WATCH_SPEC, diveFor, swipeShot } from "./controls";
import { CPU_TEAM, STADIUMS, TEAMS } from "./teams";
import { H, W, animate, celebrate, draw, newView, type BoardRow, type Side } from "./render";
import { PenaltySfx } from "./audio";

const QUICK = typeof location !== "undefined" && new URLSearchParams(location.search).get("quick") === "1";
const MATCH = QUICK ? QUICK_MATCH : NORMAL_MATCH;
const TIMING = QUICK ? QUICK_TIMING : NORMAL_TIMING;
const FINAL_MS = QUICK ? 3000 : 5000;
const DEAD = 0.12;

const WORDS: Record<Outcome, { text: string; color: string }> = {
  goal: { text: "GOAL!", color: "#3ee08f" },
  save: { text: "SAVED!", color: "#6fc3ff" },
  post: { text: "OFF THE POST!", color: "#ffd23f" },
  bar: { text: "OFF THE BAR!", color: "#ffd23f" },
  wide: { text: "WIDE!", color: "#ff8095" },
  over: { text: "OVER THE BAR!", color: "#ff8095" },
};
const DIVE_ARROW = (d: Dive) => (Math.abs(d.dx) < 0.2 ? "▲" : d.dx < 0 ? "◀" : "▶");

/** Global Penalty Cup on the TV: a shoot-out for 1–8 players (solo against a CPU team). */
export function PenaltyGame({ players, bridge, paused, onFinish }: GameProps) {
  const humans = useRef(players.filter((p) => p.connected).slice(0, 8)).current;
  const kit = useRef<ControlPlayers | null>(null);
  kit.current ??= new ControlPlayers(bridge, humans.map((p) => p.id), TUTORIAL_SPEC);
  const [practising, setPractising] = useState(true);
  useEffect(() => {
    kit.current!.start();
    return () => kit.current!.dispose();
  }, []);
  if (practising) {
    return (
      <div className="tv" style={{ background: "#07102a" }}>
        <ControlTutorial title="⚽ Global Penalty Cup" players={humans} kit={kit.current} practice={["shoot"]} quick={QUICK} onDone={() => setPractising(false)} />
      </div>
    );
  }
  return <Shootout humans={humans} kit={kit.current} bridge={bridge} paused={paused} onFinish={onFinish} />;
}

function Shootout({ humans, kit, bridge, paused, onFinish }: { humans: PlayerView[]; kit: ControlPlayers; bridge: GameProps["bridge"]; paused: boolean; onFinish: GameProps["onFinish"] }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [debug, setDebug] = useState("{}");
  const pausedRef = useRef(paused);
  pausedRef.current = paused;

  useEffect(() => {
    const ids = humans.map((p) => p.id);
    const match = newMatch(ids, MATCH);
    let seed = (Math.random() * 2147483646 + 1) | 0;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const stadium = STADIUMS[Math.floor(rand() * STADIUMS.length)]!;
    const sides = new Map<string, Side>(humans.map((p, i) => [p.id, { name: p.name, team: { ...TEAMS[i % TEAMS.length]!, shirt: p.color, keeper: p.color }, emoji: AVATARS[p.avatar].emoji, cpu: false }]));
    sides.set(CPU, { name: CPU_TEAM.name, team: CPU_TEAM, emoji: "🤖", cpu: true });
    const side = (id: string) => sides.get(id)!;
    const human = (id: string) => id !== CPU;
    const view = newView(stadium);
    const sfx = new PenaltySfx();
    const trails = new Map(ids.map((id) => [id, new PadTrail()]));
    const tiltHist = new Map(ids.map((id) => [id, [] as Array<{ x: number; y: number; t: number }>]));
    const tally = { goal: 0, save: 0, miss: 0 };
    const startedAt = Date.now();
    let pair: Pairing = current(match)!;
    let kick = newKick(TIMING);
    let cpuKick: CpuKickPlan | null = null;
    let cpuKeep: CpuKeepPlan | null = null;
    let pendingShoot: KickerInput["shoot"] | null = null;
    let pendingDive: Dive | null = null;
    let lastOutcome: Outcome | null = null;
    let overAt = 0;
    let reported = false;
    const cheerAt = new Map<string, number>();

    const role = (id: string) => (id === pair.kicker ? "kicker" : id === pair.keeper ? "keeper" : "watch");
    const startKick = () => {
      pair = current(match)!;
      kick = newKick(TIMING);
      cpuKick = pair.kicker === CPU ? cpuKickPlan(rand) : null;
      cpuKeep = pair.keeper === CPU ? cpuKeepPlan(rand) : null;
      pendingShoot = null;
      pendingDive = null;
      for (const id of ids) {
        const r = role(id);
        const spec: ControlSpec = r === "kicker" ? KICKER_SPEC : r === "keeper" ? KEEPER_SPEC : WATCH_SPEC;
        bridge.layout(id, "game", spec as unknown as Record<string, unknown>);
        kit.toast(id, r === "kicker" ? `⚽ Your kick! vs ${side(pair.keeper).name}` : r === "keeper" ? `🧤 In goal vs ${side(pair.kicker).name}` : "📣 Watch and cheer!", "info");
        if (r !== "watch") bridge.event(id, "vibrate", { ms: 60 });
      }
      const sd = match.phase === "sudden";
      view.banner = { text: sd ? "SUDDEN DEATH" : `${side(pair.kicker).name}`, sub: sd ? `${side(pair.kicker).name} to kick` : "steps up…", color: sd ? "#ff5d73" : "#fff", t: 0, dur: TIMING.intro };
      sfx.crowd("murmur");
    };

    /** Motion: aim from a moment before the push (the push itself jolts the tilt); sweeping the aim curls it. */
    const tiltAim = (x: number, y: number) => ({ x: clamp(x * 1.02, -1.1, 1.1), y: clamp(0.4 + y * 0.6, 0, 1.1) });
    const motionShot = (id: string, blast: boolean, now: number) => {
      const h = tiltHist.get(id)!;
      const at = (ms: number) => h.reduce((best, s) => (Math.abs(s.t - (now - ms)) < Math.abs(best.t - (now - ms)) ? s : best), h[h.length - 1] ?? { x: 0, y: 0, t: now });
      const a = at(150), b = at(450);
      return { power: blast ? 1 : 0.8, curve: clamp((a.x - b.x) * 1.2, -1, 1), aim: tiltAim(a.x, a.y) };
    };

    const offAction = kit.onAction((pid, action) => {
      const now = performance.now();
      if (action === "cheer" || role(pid) === "watch") {
        if (now - (cheerAt.get(pid) ?? 0) > 900) {
          cheerAt.set(pid, now);
          sfx.crowd("cheer");
          view.cheer = Math.min(1, view.cheer + 0.4);
        }
        return;
      }
      const mode = kit.mode(pid);
      if (pid === pair.kicker && kick.phase === "aim" && (action === "shoot" || action === "blast")) {
        pendingShoot = mode === "touchpad" ? swipeShot(trails.get(pid)!.take(now)) : motionShot(pid, action === "blast", now);
        return;
      }
      if (pid === pair.keeper && (kick.phase === "aim" || kick.phase === "flight") && !kick.dive && !kick.guess) {
        const m = kit.get(pid);
        const stick = mode === "buttons" ? { x: m.x, y: m.y } : { x: 0, y: 0 };
        const d = diveFor(action, stick, mode === "touchpad" ? trails.get(pid)!.lastY(now) : 0);
        if (d) pendingDive = d;
      }
    });

    const kickerInput = (): KickerInput => {
      if (pair.kicker === CPU) return cpuKickerInput(cpuKick!, kick);
      const m = kit.get(pair.kicker);
      const shoot = pendingShoot ?? undefined;
      if (!m.ok) return { shoot };
      const mode = kit.mode(pair.kicker);
      if (mode === "buttons") {
        const dz = (v: number) => (Math.abs(v) < DEAD ? 0 : v);
        return { aimVel: { x: dz(m.x), y: dz(m.y) }, charging: m.held("kick"), curve: dz(m.x), shoot };
      }
      if (mode === "touchpad") return { shoot };
      return { aimAbs: tiltAim(m.x, m.y), shoot };
    };

    const handle = (ev: KickEvent[]) => {
      for (const e of ev) {
        if (e.kind === "aim") sfx.whistle();
        else if (e.kind === "guess" && human(pair.keeper)) kit.toast(pair.keeper, `Guess locked: ${DIVE_ARROW(e.dive)} (you dive as they kick)`, "info");
        else if (e.kind === "shot") {
          sfx.kick(e.shot.power);
          if (human(pair.kicker)) bridge.event(pair.kicker, "vibrate", { ms: 50 });
        } else if (e.kind === "dive" && human(pair.keeper)) bridge.event(pair.keeper, "vibrate", { ms: 30 });
        else if (e.kind === "outcome") {
          lastOutcome = e.outcome;
          const goal = e.outcome === "goal";
          tally[goal ? "goal" : e.outcome === "save" ? "save" : "miss"]++;
          record(match, goal);
          const w = WORDS[e.outcome];
          view.banner = { text: w.text, sub: goal && e.woodwork ? "in off the woodwork!" : e.outcome === "save" ? `What a stop, ${side(pair.keeper).name}!` : undefined, color: w.color, t: 0, dur: TIMING.result };
          if (goal) {
            sfx.net();
            sfx.crowd("roar");
            view.cheer = 1;
            celebrate(view, [side(pair.kicker).team.shirt, side(pair.kicker).team.trim, "#ffffff"], rand);
          } else if (e.outcome === "save") {
            sfx.save();
            sfx.crowd("ooh");
            view.cheer = 0.5;
          } else {
            if (e.woodwork) {
              sfx.woodwork();
              view.shake = 1;
            }
            sfx.crowd("ooh");
          }
          if (human(pair.kicker)) kit.toast(pair.kicker, goal ? "⚽ GOAL! Brilliant!" : `${w.text} Unlucky`, goal ? "good" : "bad");
          if (human(pair.keeper)) kit.toast(pair.keeper, e.outcome === "save" ? "🧤 SAVED! Hero!" : goal ? "They scored…" : "Phew! It missed", goal ? "bad" : "good");
          for (const id of [pair.kicker, pair.keeper]) if (human(id)) bridge.event(id, "vibrate", { ms: goal === (id === pair.kicker) ? 160 : 260 });
        } else if (e.kind === "done") {
          if (match.phase === "over") finishMatch();
          else startKick();
        }
      }
    };

    const finishMatch = () => {
      overAt = performance.now();
      sfx.whistle(true);
      sfx.crowd("roar");
      const names = match.winners.map((id) => side(id).name);
      const shared = match.winners.length > 1;
      view.banner = { text: shared ? "SHARED CUP!" : `${names[0]} WINS!`, sub: shared ? names.join(" & ") : `${match.goals[match.winners[0]!]} goals`, color: "#ffd23f", t: 0, dur: FINAL_MS / 1000 + 2 };
      celebrate(view, match.winners.map((id) => side(id).team.shirt).concat("#ffd23f", "#ffffff"), rand);
      view.cheer = 1;
      for (const r of results(match)) {
        const won = r.place === 1;
        const text = match.solo
          ? won ? (shared ? "A shared cup! Level after sudden death" : "You won the shoot-out!") : `${CPU_TEAM.name} won this time`
          : won ? (shared ? `Shared champion! ${r.score} goals` : `Champion! ${r.score} goals`) : `You came #${r.place} · ${r.score} goals`;
        kit.outcome(r.playerId, text, won ? "🏆" : "⚽");
      }
    };

    const board = (): BoardRow[] =>
      match.takers.map((id) => ({
        name: side(id).name, color: side(id).team.shirt, kicks: match.kicks[id]!, goals: match.goals[id]!,
        active: id === pair.kicker, out: match.phase !== "regular" && !match.contenders.includes(id),
      }));
    const roundLabel = () =>
      match.phase === "sudden" ? `SUDDEN DEATH · ROUND ${match.round + 1}` : match.phase === "over" ? "FULL TIME" : `ROUND ${Math.min(match.round + 1, MATCH.regular)} / ${MATCH.regular}`;
    const hintFor = () => {
      if (kick.phase !== "aim" || !human(pair.kicker)) return "";
      const mode = kit.mode(pair.kicker);
      return KICKER_SPEC.hints?.[mode] ?? "";
    };
    const statusAll = () => {
      for (const id of ids) {
        const r = role(id);
        const mine = `Goals ${match.goals[id]}`;
        const bars = [{ label: mine, value: Math.min(1, match.goals[id]! / MATCH.regular), color: "#3ee08f" }];
        if (r === "kicker") {
          const mode = kit.mode(id);
          const text = kick.phase === "intro" ? `⚽ Your kick next vs ${side(pair.keeper).name}`
            : kick.phase === "aim" ? (mode === "buttons" ? "⚽ Aim · hold KICK, let go to shoot" : mode === "touchpad" ? "⚽ Swipe up to shoot" : "⚽ Tilt to aim · push to shoot")
            : "⚽ …";
          if (mode === "buttons" && kick.phase === "aim") bars.unshift({ label: "Power", value: Math.min(1, kick.charge / 1.3), color: kick.charge > 1 ? "#ff5d73" : "#ffd23f" });
          kit.status(id, { text, bars });
        } else if (r === "keeper") {
          kit.status(id, { text: kick.guess ? `🧤 Guess locked: ${DIVE_ARROW(kick.guess)}` : `🧤 In goal vs ${side(pair.kicker).name}: guess early or react!`, bars });
        } else kit.status(id, { text: `📣 ${side(pair.kicker).name} vs ${side(pair.keeper).name}`, bars });
      }
    };
    const nameOf = (id: string) => side(id).name;
    const publish = () =>
      setDebug(JSON.stringify({
        phase: match.phase, kick: kick.phase, round: match.round, kicker: nameOf(pair.kicker), keeper: nameOf(pair.keeper),
        goals: Object.fromEntries(match.takers.map((id) => [nameOf(id), match.goals[id]])),
        kicks: Object.fromEntries(match.takers.map((id) => [nameOf(id), match.kicks[id]!.length])),
        tally, last: lastOutcome, aim: kick.aim, charge: Math.round(kick.charge * 100) / 100,
        guess: kick.guess, dive: kick.dive, winners: match.winners.map(nameOf), cup: overAt > 0, over: reported,
      }));

    startKick();
    const ctx = canvas.current!.getContext("2d")!;
    let raf = 0;
    let last = performance.now();
    let acc = 0;
    let lastStatus = 0;
    const DT = 1 / 60;
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const real = Math.min(0.1, (now - last) / 1000);
      last = now;
      if (pausedRef.current) return;
      acc += real;
      while (acc >= DT) {
        acc -= DT;
        for (const id of ids) {
          const m = kit.get(id);
          const mode = kit.mode(id);
          if (mode === "touchpad") trails.get(id)!.add(m.x, m.y, now);
          else if (mode === "motion" || mode === "hybrid") {
            const h = tiltHist.get(id)!;
            h.push({ x: m.x, y: m.y, t: now });
            if (h.length > 45) h.shift();
          }
        }
        if (match.phase !== "over" || kick.phase !== "done") {
          const kin = kickerInput();
          const dive = pair.keeper === CPU ? cpuKeeperDive(cpuKeep!, kick) : pendingDive;
          pendingShoot = null;
          pendingDive = null;
          handle(stepKick(kick, DT, kin, dive, rand));
        }
        animate(view, DT);
      }
      draw(ctx, {
        kick, kicker: side(pair.kicker), keeper: side(pair.keeper), board: board(), regular: MATCH.regular, roundLabel: roundLabel(),
        showAim: pair.kicker === CPU || kit.mode(pair.kicker) !== "touchpad", showCharge: kick.charging, hint: hintFor(),
      }, view);
      if (now - lastStatus > 250) {
        lastStatus = now;
        if (match.phase !== "over") statusAll();
        publish();
      }
      if (overAt && !reported && now - overAt > FINAL_MS) {
        reported = true;
        publish();
        onFinish(results(match), Date.now() - startedAt);
      }
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      offAction();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", background: "#050817" }} data-penalty={debug}>
      <canvas ref={canvas} width={W} height={H} style={{ width: "100%", height: "100%", objectFit: "contain" }} />
      {paused && <div className="paused-overlay"><div className="big-title">⏸ Paused</div><p className="hint">Reconnecting…</p></div>}
    </div>
  );
}
