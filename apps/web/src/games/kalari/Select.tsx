import { useEffect, useRef, useState } from "react";
import type { PlayerView } from "@playwithtv/protocol";
import type { ControlPlayers } from "../controlKit";
import type { KalariControls } from "./input";
import { ARENAS } from "./arenas";
import { ROSTER, type FighterId, type Mode } from "./rules";
import { A } from "./view/common";

interface Sheet { image: string; size: { w: number; h: number }; framesPerDirection: number; frames: Array<{ x: number; y: number; w: number; h: number }>; clips: Record<string, { start: number; frames: number; fps: number }> }

/** An animated portrait cut straight from the fighter's pre-rendered sprite sheet (facing the viewer). */
function Portrait({ id, scale = 2.3, clip = "idle" }: { id: FighterId; scale?: number; clip?: string }) {
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [t, setT] = useState(0);
  useEffect(() => {
    let alive = true;
    fetch(`${A}${id}-sprites.json`).then((r) => r.json()).then((s: Sheet) => alive && setSheet(s)).catch(() => undefined);
    const iv = setInterval(() => setT((n) => n + 1), 110);
    return () => { alive = false; clearInterval(iv); };
  }, [id]);
  if (!sheet) return null;
  const c = sheet.clips[clip] ?? sheet.clips.idle!;
  const r = sheet.frames[6 * sheet.framesPerDirection + c.start + (t % c.frames)]!; // direction 6 = facing the viewer
  return (
    <div className="portrait" style={{
      width: r.w * scale, height: r.h * scale, backgroundImage: `url(${A}${sheet.image})`,
      backgroundSize: `${sheet.size.w * scale}px ${sheet.size.h * scale}px`, backgroundPosition: `${-r.x * scale}px ${-r.y * scale}px`,
    }} />
  );
}

export interface Picks { chars: Map<string, FighterId>; arena: string; mode: Mode }

/**
 * Character select on the TV: every player moves their own cursor with the stick (or tilt / drag), STRIKE locks
 * in, GUARD or ROLL unlocks, HEAVY changes the arena. Starts when everyone has locked in, or after a while.
 */
export function Select({ humans, kit, controls, quick, initialArena, initialMode, onDone }: {
  humans: PlayerView[]; kit: ControlPlayers; controls: KalariControls; quick: boolean; initialArena: string | null; initialMode: Mode; onDone(p: Picks): void;
}) {
  const [cursor, setCursor] = useState(() => new Map(humans.map((p, i) => [p.id, i % ROSTER.length])));
  const [locked, setLocked] = useState(() => new Set<string>());
  const [arena, setArena] = useState(() => initialArena ?? ARENAS[Math.floor(Math.random() * ARENAS.length)]!.id);
  const [mode, setMode] = useState<Mode>(initialMode);
  const [left, setLeft] = useState(quick ? 3 : 25);
  const prevX = useRef(new Map<string, number>());
  const done = useRef(false);
  const state = useRef({ cursor, locked, arena, mode });
  state.current = { cursor, locked, arena, mode };

  const finish = () => {
    if (done.current) return;
    done.current = true;
    const { cursor: c, arena: a, mode: md } = state.current;
    onDone({ chars: new Map(humans.map((p) => [p.id, ROSTER[c.get(p.id) ?? 0]!.id])), arena: a, mode: md });
  };

  useEffect(() => {
    const iv = setInterval(() => {
      const cur = new Map(state.current.cursor), lock = new Set(state.current.locked);
      let changed = false;
      for (const p of humans) {
        const r = kit.get(p.id);
        const x = r.ok ? r.x : 0, px = prevX.current.get(p.id) ?? 0;
        if (!lock.has(p.id) && Math.abs(x) > 0.6 && Math.abs(px) <= 0.6) {
          cur.set(p.id, (cur.get(p.id)! + (x > 0 ? 1 : ROSTER.length - 1)) % ROSTER.length);
          changed = true;
        }
        prevX.current.set(p.id, x);
        const acts = controls.take(p.id);
        if (acts.has("strike") || acts.has("special")) { lock.add(p.id); changed = true; }
        if (acts.has("guard")) { lock.delete(p.id); changed = true; }
        if (acts.has("roll")) setMode((md) => (md === "versus" ? "guardians" : "versus"));
        if (acts.has("heavy")) setArena((a) => ARENAS[(ARENAS.findIndex((x2) => x2.id === a) + 1) % ARENAS.length]!.id);
      }
      if (changed) { setCursor(cur); setLocked(lock); }
      for (const p of humans) {
        const c = ROSTER[cur.get(p.id)!]!;
        kit.status(p.id, { text: lock.has(p.id) ? `✅ ${c.name} locked in! Waiting for the others…` : `◀ ▶ choose · STRIKE to lock in ${c.name} · HEAVY: arena · ROLL: mode` });
      }
      if (humans.length && humans.every((p) => lock.has(p.id))) setTimeout(finish, quick ? 300 : 900);
    }, 100);
    const sec = setInterval(() => setLeft((n) => n - 1), 1000);
    const key = (e: KeyboardEvent) => (e.key === "Enter" || e.key === " ") && finish();
    window.addEventListener("keydown", key);
    return () => { clearInterval(iv); clearInterval(sec); window.removeEventListener("keydown", key); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (left <= 0) finish(); }, [left]); // eslint-disable-line react-hooks/exhaustive-deps

  const a = ARENAS.find((x) => x.id === arena)!;
  return (
    <div className="kalari-select" style={{ ["--arena" as string]: `url(${A}${arena}-card.webp)` }} data-kalari-select={JSON.stringify({ arena, locked: [...locked], cursor: Object.fromEntries(cursor) })}>
      <h1>KALARI CLASH</h1>
      <div className="sub">Choose your fighter</div>
      <div className="kalari-cards">
        {ROSTER.map((c, i) => {
          const here = humans.filter((p) => cursor.get(p.id) === i);
          return (
            <div key={c.id} className={`kalari-card ${here.length ? "hot" : ""}`} style={{ ["--c2" as string]: c.color }} data-fighter={c.id}>
              <Portrait id={c.id} clip={here.some((p) => locked.has(p.id)) ? "cheer" : "idle"} />
              <div className="who">{here.map((p) => <span key={p.id} className={locked.has(p.id) ? "locked" : ""} style={{ background: p.color }}>{locked.has(p.id) ? "✓ " : ""}{p.name}</span>)}</div>
              <div className="name" style={{ color: c.color }}>{c.name}</div>
              <div className="title">{c.title} · {c.stance}</div>
              <div className="special">🔥 {c.special.name}</div>
            </div>
          );
        })}
      </div>
      <div className="kalari-mode-pick" data-mode={mode}>{mode === "versus" ? "⚔️ VERSUS: everyone for themselves, best of three" : "🛡 GUARDIANS: team up against waves of clay golems"} <span>(ROLL to switch)</span></div>
      <div className="kalari-arena-pick">🏟 {a.name}: <span style={{ opacity: 0.8 }}>{a.tagline}</span></div>
      <div className="hint">Starting in {Math.max(0, left)} s · CPUs fill the arena to four</div>
    </div>
  );
}
