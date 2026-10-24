import { useEffect, useRef, useState } from "react";
import type { ControlSpec, GameResult, PlayerView } from "@playwithtv/protocol";
import type { GameProps } from "../types";
import { AVATARS } from "../../avatars";
import { ControlPlayers } from "../controlKit";
import { ControlTutorial } from "../ControlTutorial";
import {
  DIRS, NORMAL, QUICK as QUICK_CFG, currentSeq, input, inputLimit, litStep, newGame, ranking, roundLen, tick, timing,
  type Dir, type MemoryEvent, type MemoryGame as Game,
} from "./engine";
import { MemorySfx } from "./audio";
import "./memory.css";

const QUICK = typeof location !== "undefined" && new URLSearchParams(location.search).get("quick") === "1";
const CFG = QUICK ? QUICK_CFG : NORMAL;
const OVER_MS = QUICK ? 2500 : 4500;

/** Each direction has its own colour, shape and note, so it reads by colour, by shape or by sound. */
export const LOOK: Record<Dir, { color: string; shape: string; name: string }> = {
  up: { color: "#2fbf71", shape: "▲", name: "UP" },
  right: { color: "#ef476f", shape: "●", name: "RIGHT" },
  down: { color: "#3a86ff", shape: "■", name: "DOWN" },
  left: { color: "#ffbe0b", shape: "◆", name: "LEFT" },
};

/**
 * Buttons first: four big coloured buttons are instant and readable for every age. Motion (a flick per
 * direction) and touchpad swipes are offered for fun; the engine gives them more time per step.
 */
export const CONTROLS: ControlSpec = {
  title: "Memory Wave",
  modes: ["buttons", "motion", "touchpad"],
  stick: "none",
  tilt: "none",
  actions: (["up", "right", "left", "down"] as Dir[]).map((d) => ({
    id: d,
    label: `${LOOK[d].shape} ${LOOK[d].name}`,
    color: LOOK[d].color,
    gestures: [`flick-${d}` as const],
    swipes: [`swipe-${d}` as const],
  })),
  hints: {
    buttons: "Watch the wave, then tap the same colours in order",
    motion: "Watch the wave, then flick the phone up, down, left or right in order",
    touchpad: "Watch the wave, then swipe up, down, left or right in order",
  },
};

/** Memory Wave on the TV: 1–8 players repeat the same growing sequence at the same time. */
export function MemoryGame({ players, bridge, paused, onFinish }: GameProps) {
  const ids = useRef(players.filter((p) => p.connected).slice(0, 8)).current;
  const kit = useRef<ControlPlayers | null>(null);
  kit.current ??= new ControlPlayers(bridge, ids.map((p) => p.id), CONTROLS);
  const [practising, setPractising] = useState(true);
  useEffect(() => {
    kit.current!.start();
    return () => kit.current!.dispose();
  }, []);
  if (practising) {
    return (
      <div className="tv memory-bg">
        <ControlTutorial title="🌊 Memory Wave" players={ids} kit={kit.current} practice={["up"]} quick={QUICK} onDone={() => setPractising(false)} />
      </div>
    );
  }
  return <Play ids={ids} kit={kit.current} bridge={bridge} paused={paused} onFinish={onFinish} />;
}

function Play({ ids, kit, bridge, paused, onFinish }: { ids: PlayerView[]; kit: ControlPlayers; bridge: GameProps["bridge"]; paused: boolean; onFinish: GameProps["onFinish"] }) {
  const game = useRef<Game | null>(null);
  game.current ??= newGame(ids.map((p) => p.id), CFG, (Math.random() * 2 ** 31) | 0);
  const g = game.current;
  const [, render] = useState(0);
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const flash = useRef(new Map<string, { ok: boolean; at: number }>());

  useEffect(() => {
    const sfx = new MemorySfx();
    const startedAt = Date.now();
    let overAt = 0;
    let reported = false;
    const early = new Set<string>();
    const name = (id: string) => ids.find((p) => p.id === id)?.name ?? "";
    const livesBar = (id: string) => {
      const p = g.players.find((x) => x.id === id)!;
      return [{ label: "Lives", value: p.lives / CFG.lives, color: p.lives > 1 ? "#3ee08f" : "#ff5d73" }];
    };
    const statusAll = (text: (id: string) => string) => {
      for (const p of g.players) kit.status(p.id, { text: text(p.id), bars: livesBar(p.id) });
    };

    const handle = (ev: MemoryEvent[]) => {
      for (const e of ev) {
        if (e.kind === "show-step") sfx.step(e.dir, timing(g.round).stepMs);
        else if (e.kind === "round-start") {
          early.clear();
          statusAll((id) => (g.players.find((p) => p.id === id)!.out ? "You're out: cheer them on!" : `👀 Watch the TV · Round ${e.round + 1}`));
        } else if (e.kind === "input-start") {
          sfx.go();
          statusAll((id) => (g.players.find((p) => p.id === id)!.out ? "You're out: cheer them on!" : `Your turn! Repeat ${e.len} steps`));
        } else if (e.kind === "step") {
          sfx.tick(e.dir);
          flash.current.set(e.id, { ok: true, at: performance.now() });
          kit.toast(e.id, `✓ ${e.index + 1} / ${roundLen(g)}`, "good");
          bridge.event(e.id, "vibrate", { ms: 25 });
        } else if (e.kind === "done") {
          sfx.done();
          kit.toast(e.id, "🌊 Wave complete!", "good");
          kit.status(e.id, { text: "✓ Got it! Wait for the others", bars: livesBar(e.id) });
        } else if (e.kind === "wrong" || e.kind === "slow") {
          sfx.wrong();
          flash.current.set(e.id, { ok: false, at: performance.now() });
          bridge.event(e.id, "vibrate", { ms: 300 });
        } else if (e.kind === "life-lost") {
          const msg = e.lives > 0 ? `✗ Oops! ${e.lives} ${e.lives === 1 ? "life" : "lives"} left` : "✗ Out of lives!";
          kit.toast(e.id, msg, "bad");
          kit.status(e.id, { text: msg, bars: livesBar(e.id) });
        } else if (e.kind === "out") {
          sfx.out();
          kit.status(e.id, { text: "You're out: cheer them on!", bars: livesBar(e.id) });
        } else if (e.kind === "over") {
          sfx.fanfare();
          overAt = performance.now();
          const ranks = ranking(g);
          for (const r of ranks) {
            const p = g.players.find((x) => x.id === r.id)!;
            const text = r.place === 1 ? (ranks.length > 1 ? "You won Memory Wave!" : `Great memory! ${p.cleared} waves`) : `You came #${r.place} · ${r.points} points`;
            kit.outcome(r.id, text, r.place === 1 ? "🏆" : "🌊");
          }
        }
      }
      render((n) => n + 1);
    };

    const off = kit.onAction((pid, action) => {
      if (!DIRS.includes(action as Dir)) return;
      if (g.phase === "show" && !early.has(pid)) {
        early.add(pid);
        kit.toast(pid, "Wait for the wave to finish…");
      }
      handle(input(g, pid, action as Dir));
    });

    const limits = (id: string, len: number) => inputLimit(len, kit.mode(id));
    statusAll(() => "👀 Watch the TV · Round 1");
    let raf = 0;
    let last = performance.now();
    let acc = 0;
    let lastRender = 0;
    let lit = -1;
    const DT = 1000 / 60;
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const real = Math.min(100, now - last);
      last = now;
      if (pausedRef.current) return;
      acc += real;
      while (acc >= DT) {
        acc -= DT;
        handle(tick(g, DT, limits));
      }
      const l = litStep(g);
      if (l !== lit || now - lastRender > 100) {
        lit = l;
        lastRender = now;
        render((n) => n + 1);
      }
      if (g.phase === "over" && !reported && now - overAt > OVER_MS) {
        reported = true;
        const results: GameResult[] = ranking(g).map((r) => ({ playerId: r.id, score: r.points, place: r.place }));
        onFinish(results, Date.now() - startedAt);
      }
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      off();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const seq = currentSeq(g);
  const lit = litStep(g);
  const litDir = lit >= 0 ? seq[lit] : null;
  const { stepMs, gapMs } = timing(g.round);
  const shownUpTo = g.phase !== "show" ? seq.length : g.t < CFG.leadMs ? 0 : Math.min(seq.length, Math.floor((g.t - CFG.leadMs) / (stepMs + gapMs)) + 1);
  const longest = Math.max(...g.players.map((p) => (p.status === "entering" && !p.out ? p.limitMs : 0)), 1);
  const timeLeft = g.phase === "input" ? Math.max(0, longest - g.t) : 0;
  const debug = JSON.stringify({
    phase: g.phase, round: g.round, len: seq.length, seq, lit,
    players: Object.fromEntries(g.players.map((p) => [ids.find((x) => x.id === p.id)?.name ?? p.id, { progress: p.progress, lives: p.lives, out: p.out, status: p.status, points: p.points }])),
    winners: g.winners.map((id) => ids.find((x) => x.id === id)?.name ?? id),
  });
  const center =
    g.phase === "show" ? (g.t < CFG.leadMs ? "WATCH!" : "WATCH")
    : g.phase === "input" ? "YOUR TURN!"
    : g.phase === "result" ? `${g.players.filter((p) => p.status === "done").length} / ${g.players.filter((p) => !p.out || p.outRound === g.round).length} got it`
    : "FINISH!";
  const winners = g.winners.map((id) => ids.find((p) => p.id === id)?.name).filter(Boolean);
  const many = ids.length > 4;

  return (
    <div className="tv memory-bg memory" data-memory={debug}>
      <div className="memory-top">
        <span className="chip">🌊 Memory Wave</span>
        <span className="chip">Round {g.round + 1} / {CFG.maxRounds}</span>
        <span className="chip">{seq.length} steps · speed {g.round + 1}</span>
        {g.phase === "input" && <span className="chip timer">⏱ {Math.ceil(timeLeft / 1000)}s</span>}
      </div>
      <div className="memory-main">
        <div className="wave-side">
          <div className={`wave-pad ph-${g.phase}`}>
            {DIRS.map((d) => (
              <div key={d} className={`petal ${d} ${litDir === d ? "lit" : ""}`} style={{ background: LOOK[d].color }}>
                <span>{LOOK[d].shape}</span>
              </div>
            ))}
            <div className="wave-core">
              <b>{center}</b>
              {g.phase === "input" && <small>{seq.length} steps</small>}
            </div>
          </div>
          <div className="seq-dots">
            {seq.map((d, i) => {
              const reveal = g.phase === "result" || g.phase === "over" || (g.phase === "show" && i === lit);
              return (
                <span key={i} className={`sq ${i < shownUpTo ? "seen" : ""} ${reveal ? "reveal" : ""}`} style={reveal ? { background: LOOK[d].color } : undefined}>
                  {reveal ? LOOK[d].shape : ""}
                </span>
              );
            })}
          </div>
        </div>
        <div className={`mw-players ${many ? "many" : ""}`}>
          {ids.map((pv) => {
            const p = g.players.find((x) => x.id === pv.id)!;
            const f = flash.current.get(pv.id);
            const fresh = f && performance.now() - f.at < 350;
            return (
              <div key={pv.id} className={`mw-card ${p.out ? "out" : ""} ${p.status} ${fresh ? (f.ok ? "bump" : "shake") : ""}`} style={{ borderColor: pv.color }} data-player={pv.name}>
                <div className="mw-head">
                  <span className="avatar" style={{ boxShadow: `0 0 0 0.12em ${pv.color}` }}>{AVATARS[pv.avatar].emoji}</span>
                  <b className="mw-name">{pv.name}</b>
                  <span className="hearts">{Array.from({ length: CFG.lives }, (_, i) => (i < p.lives ? "♥" : "♡")).join("")}</span>
                </div>
                <div className="ticks">
                  {p.out && p.outRound !== g.round ? <span className="mw-out">OUT</span> : seq.map((_, i) => (
                    <span key={i} className={i < p.progress ? "ok" : p.wrongAt === i ? "bad" : ""}>{i < p.progress ? "✓" : p.wrongAt === i ? "✗" : ""}</span>
                  ))}
                  <span className="badge">{p.status === "done" ? "GOT IT!" : p.status === "slow" ? "⏰" : p.status === "wrong" ? "✗" : ""}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
      {g.phase === "over" && (
        <div className="mw-final">
          <div className="big-title">🏆 {winners.length ? `${winners.join(" & ")} ${winners.length > 1 ? "win" : "wins"}!` : "Well played!"}</div>
          <p className="hint">Longest memory: {Math.max(...g.players.map((p) => p.cleared))} waves</p>
        </div>
      )}
      {paused && <div className="paused-overlay"><div className="big-title">⏸ Paused</div><p className="hint">Reconnecting…</p></div>}
    </div>
  );
}
