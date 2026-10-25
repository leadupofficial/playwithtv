/**
 * kitgrid/Shell: everything a grid title shares on the TV.
 *
 *   practice → map (pick a level) → story (once per world) → play → result → map … → Finish
 *
 * One phone plays at a time (the pilot) and the turn passes to the next phone after every level, so a
 * family can share a campaign; each player's points add up to the match result. Co-op titles are played by
 * every phone at once: anyone can drive the menus and everyone shares the level's points. Progress and rewards are
 * saved on the TV (progress.ts). The level runs in a pure simulation (types.ts Sim) drawn on a 2D canvas.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { GameResult, PlayerView } from "@playwithtv/protocol";
import type { GameProps } from "../types";
import { ControlPlayers } from "../controlKit";
import { ControlTutorial } from "../ControlTutorial";
import { placings } from "../scoring";
import { getQuality } from "../../quality/store";
import { Draw, loadGridAtlas, type GridAtlas } from "./draw";
import { GridSfx } from "./sfx";
import { isOpen, load, nextReward, record, save, total, unlocked, type Progress } from "./progress";
import type { GridTitle, Outcome, Reward, Sim, SimEvent } from "./types";
import "./grid.css";

const QUICK = typeof location !== "undefined" && new URLSearchParams(location.search).get("quick") === "1";

type Phase = "map" | "story" | "play" | "result";

export function GridShell({ title, players, bridge, paused, onFinish }: GameProps & { title: GridTitle }) {
  const ids = useRef(players.filter((p) => p.connected).slice(0, 4)).current;
  const kit = useRef<ControlPlayers | null>(null);
  kit.current ??= new ControlPlayers(bridge, ids.map((p) => p.id), title.controls);
  const [practising, setPractising] = useState(true);
  useEffect(() => {
    kit.current!.start();
    return () => kit.current!.dispose();
  }, []);
  if (practising) {
    return (
      <div className="tv grid-bg" style={{ background: title.themes[""] }}>
        <ControlTutorial title={`${title.emoji} ${title.name}`} players={ids} kit={kit.current} practice={title.practice} quick={QUICK} onDone={() => setPractising(false)} />
      </div>
    );
  }
  return <Campaign title={title} ids={ids} kit={kit.current} bridge={bridge} paused={paused} onFinish={onFinish} />;
}

function Stars({ n, of = 3 }: { n: number; of?: number }) {
  return (
    <span className="grid-stars" aria-label={`${n} of ${of} stars`}>
      {Array.from({ length: of }, (_, i) => (
        <span key={i} className={i < n ? "on" : "off"}>★</span>
      ))}
    </span>
  );
}

function RewardChip({ r, owned, atlas, worn }: { r: Reward; owned: boolean; atlas: GridAtlas | null; worn?: boolean }) {
  return (
    <div className={`grid-reward ${owned ? "owned" : "locked"} ${worn ? "worn" : ""}`}>
      {r.sprite && atlas ? <SpriteImg atlas={atlas} id={r.sprite} /> : <span className="emoji">{r.emoji ?? "🎁"}</span>}
      <span className="name">{r.name}</span>
      <span className="need">{owned ? (worn ? "Wearing" : r.kind === "trophy" ? "Earned" : "Unlocked") : `${r.stars} ★`}</span>
    </div>
  );
}

/** One atlas sprite as a small canvas (reward strip, story card). */
function SpriteImg({ atlas, id, size = 64 }: { atlas: GridAtlas; id: string; size?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current;
    const s = atlas.sprites[id];
    if (!cv || !s) return;
    const r = s.frames[0]!;
    const k = Math.min(size / r.w, size / r.h);
    cv.width = size;
    cv.height = size;
    const ctx = cv.getContext("2d")!;
    ctx.clearRect(0, 0, size, size);
    ctx.drawImage(atlas.img, r.x, r.y, r.w, r.h, (size - r.w * k) / 2, (size - r.h * k) / 2, r.w * k, r.h * k);
  }, [atlas, id, size]);
  return <canvas ref={ref} className="grid-sprite" style={{ width: size, height: size }} />;
}

function Campaign({ title, ids, kit, bridge, paused, onFinish }: {
  title: GridTitle; ids: PlayerView[]; kit: ControlPlayers; bridge: GameProps["bridge"]; paused: boolean; onFinish: GameProps["onFinish"];
}) {
  const [progress, setProgress] = useState<Progress>(() => load(title));
  const [phase, setPhase] = useState<Phase>("map");
  const [cursor, setCursor] = useState(() => {
    const p = load(title);
    const first = p.stars.findIndex((s) => s === 0);
    return first < 0 ? title.levels.length - 1 : first;
  });
  const [turn, setTurn] = useState(0);
  const [atlas, setAtlas] = useState<GridAtlas | null>(null);
  const [result, setResult] = useState<{ outcome: Outcome; fresh: Reward[]; best: boolean } | null>(null);
  const [, rerender] = useState(0);
  const sim = useRef<Sim | null>(null);
  const seen = useRef(new Set<number>());
  const points = useRef(new Map(ids.map((p) => [p.id, 0])));
  const startedAt = useRef(Date.now());
  const finished = useRef(false);
  const pilot = ids[turn % ids.length]!;
  const sfx = useMemo(() => new GridSfx(), []);
  const canvas = useRef<HTMLCanvasElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const shake = useRef(0);

  // latest values for the input/rAF callbacks
  const live = useRef({ phase, cursor, progress, pilot, paused, result });
  live.current = { phase, cursor, progress, pilot, paused, result };

  useEffect(() => {
    loadGridAtlas().then(setAtlas, () => setAtlas(null));
    return () => sfx.dispose();
  }, [sfx]);

  const name = (id: string) => ids.find((p) => p.id === id)?.name ?? "";
  const actionLabels = useMemo(() => Object.fromEntries(title.controls.actions.map((a) => [a.id, a.label])), [title]);

  const finish = () => {
    if (finished.current) return;
    finished.current = true;
    const results: GameResult[] = placings(points.current);
    for (const r of results) kit.outcome(r.playerId, `${r.score} points`, r.place === 1 ? "🏆" : title.emoji);
    onFinish(results, Date.now() - startedAt.current);
  };

  const beginLevel = (level: number) => {
    const p = live.current.progress;
    sim.current = title.create(level, (Math.random() * 2 ** 31) | 0, { skin: p.skin, theme: p.theme, quick: QUICK, colors: ids.map((x) => x.color) });
    drawRef.current?.reset();
    setPhase("play");
  };

  const openLevel = (level: number) => {
    const w = title.levels[level]!.world;
    if (!seen.current.has(w)) {
      seen.current.add(w);
      setPhase("story");
    } else beginLevel(level);
  };

  const endLevel = (o: Outcome) => {
    const lvl = live.current.cursor;
    const before = live.current.progress.stars[lvl] ?? 0;
    const { progress: next, fresh } = record(title, live.current.progress, lvl, o.won ? o.stars : 0);
    save(title, next);
    setProgress(next);
    const scorers = title.coop ? ids.map((p) => p.id) : [live.current.pilot.id];
    for (const pid of scorers) {
      points.current.set(pid, (points.current.get(pid) ?? 0) + o.score);
      kit.toast(pid, o.won ? `${"★".repeat(o.stars)} Level clear!` : "Level lost. Try again!", o.won ? "good" : "bad");
    }
    setResult({ outcome: o, fresh, best: o.won && o.stars > before });
    sfx.play(o.won ? "win" : "lose");
    if (o.won) for (let i = 0; i < o.stars; i++) setTimeout(() => sfx.play("star"), 500 + i * 350);
    setPhase("result");
  };

  // phone status lines follow the phase and the pilot
  useEffect(() => {
    for (const p of ids) {
      if (p.id !== pilot.id && !title.coop) {
        kit.status(p.id, { text: `👀 ${pilot.name} is playing. Your turn comes after this level` });
        continue;
      }
      if (phase === "map") {
        kit.status(p.id, {
          text: title.coop ? title.menu.hint : `Your turn! ${title.menu.hint}`,
          labels: { ...actionLabels, [title.menu.prev]: "◀ Level", [title.menu.next]: "Level ▶", [title.menu.ok]: "▶ Play", [title.menu.back]: "✓ Finish" },
        });
      } else if (phase === "story") kit.status(p.id, { text: "Story time! Tap ▶ to start", labels: { ...actionLabels, [title.menu.ok]: "▶ Start" } });
      else if (phase === "result") {
        kit.status(p.id, { text: "Tap ▶ for the next level or ◀ for the map", labels: { ...actionLabels, [title.menu.ok]: "▶ Next", [title.menu.back]: "◀ Map" } });
      } else kit.status(p.id, { text: title.levels[cursor]!.brief, labels: actionLabels });
    }
  }, [phase, pilot.id, cursor]); // eslint-disable-line react-hooks/exhaustive-deps

  const handle = (evs: SimEvent[]) => {
    const pilotId = live.current.pilot.id;
    for (const e of evs) {
      if (e.sfx) sfx.play(e.sfx);
      if (e.shake) shake.current = Math.max(shake.current, e.shake);
      if (!e.toast && !e.buzz) continue;
      const to = !title.coop ? [pilotId] : e.player !== undefined ? [ids[e.player]?.id ?? pilotId] : ids.map((p) => p.id);
      for (const pid of to) {
        if (e.toast) kit.toast(pid, e.toast, e.tone ?? "info");
        if (e.buzz) bridge.event(pid, "vibrate", { ms: e.buzz });
      }
    }
  };

  // phone actions
  useEffect(() => {
    return kit.onAction((id, action) => {
      const L = live.current;
      if (L.paused || finished.current || (id !== L.pilot.id && !title.coop)) return;
      const m = title.menu;
      if (L.phase === "play") {
        const s = sim.current;
        if (s && !s.outcome()) {
          handle(s.act(action, ids.findIndex((p) => p.id === id)));
          // puzzles (Buzz Field) can finish on a move, not just on a tick
          const o = s.outcome();
          if (o) setTimeout(() => endLevel(o), o.won ? 600 : 900);
        }
        return;
      }
      if (L.phase === "story") {
        if (action === m.ok) beginLevel(L.cursor);
        return;
      }
      if (L.phase === "result") {
        if (action === m.ok) {
          const won = L.result?.outcome.won;
          const next = won && L.cursor + 1 < title.levels.length && isOpen(L.progress.stars, L.cursor + 1) ? L.cursor + 1 : L.cursor;
          setCursor(next);
          setTurn((t) => t + 1);
          setResult(null);
          // alone (or together): straight into the level; with friends the next pilot starts from the map
          if (ids.length === 1 || title.coop) openLevel(next);
          else setPhase("map");
        } else if (action === m.back) {
          setTurn((t) => t + 1);
          setResult(null);
          setPhase("map");
        }
        return;
      }
      // map
      if (action === m.prev) {
        setCursor((c) => Math.max(0, c - 1));
        sfx.play("move");
      } else if (action === m.next) {
        setCursor((c) => (c + 1 < title.levels.length && isOpen(L.progress.stars, c + 1) ? c + 1 : c));
        sfx.play("move");
      } else if (action === m.ok) {
        if (isOpen(L.progress.stars, L.cursor)) {
          sfx.play("select");
          openLevel(L.cursor);
        }
      } else if (action === m.back) {
        sfx.play("back");
        finish();
      }
    });
  }, [kit]); // eslint-disable-line react-hooks/exhaustive-deps

  // story cards move on by themselves after a while
  useEffect(() => {
    if (phase !== "story") return;
    const t = setTimeout(() => beginLevel(live.current.cursor), QUICK ? 1500 : 15000);
    return () => clearTimeout(t);
  }, [phase]); // eslint-disable-line react-hooks/exhaustive-deps

  // render loop
  const drawRef = useRef<Draw | null>(null);
  useEffect(() => {
    const cv = canvas.current;
    if (!cv) return;
    const ctx = cv.getContext("2d")!;
    const d = new Draw(ctx, atlas);
    drawRef.current = d;
    const lite = getQuality().tier === "lite";
    let raf = 0;
    let last = performance.now();
    let hudAt = 0;
    let t = 0;
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(50, now - last);
      last = now;
      const L = live.current;
      const s = sim.current;
      if (L.phase === "play" && s && !L.paused && !s.outcome()) {
        t += dt / 1000;
        if (s.steer) ids.forEach((p, i) => {
          const r = kit.get(p.id);
          s.steer!(i, r.x, r.y);
        });
        handle(s.step(dt));
        const o = s.outcome();
        if (o) setTimeout(() => endLevel(o), o.won ? 600 : 900);
      }
      // size: whole cells, centred in the canvas
      const dpr = Math.min(window.devicePixelRatio || 1, lite ? 1 : 2);
      const W = cv.clientWidth, H = cv.clientHeight;
      if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) {
        cv.width = Math.round(W * dpr);
        cv.height = Math.round(H * dpr);
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, cv.width, cv.height);
      if (!s || (L.phase !== "play" && L.phase !== "result")) return;
      d.cell = Math.max(4, Math.floor(Math.min(cv.width / s.cols, cv.height / s.rows)));
      shake.current *= 0.9;
      const sx = shake.current > 0.01 ? (Math.random() - 0.5) * shake.current * d.cell : 0;
      const sy = shake.current > 0.01 ? (Math.random() - 0.5) * shake.current * d.cell : 0;
      d.ox = Math.floor((cv.width - s.cols * d.cell) / 2 + sx);
      d.oy = Math.floor((cv.height - s.rows * d.cell) / 2 + sy);
      d.t = t;
      s.draw(d);
      if (now - hudAt > 150) {
        hudAt = now;
        root.current?.setAttribute("data-grid", JSON.stringify({ phase: L.phase, level: L.cursor, pilot: L.pilot.name, hud: s.hud(), outcome: s.outcome(), ...s.debug() }));
        rerender((n) => n + 1);
      }
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [atlas]); // eslint-disable-line react-hooks/exhaustive-deps

  // test state outside play (map/story/result)
  useEffect(() => {
    if (phase === "play") return;
    root.current?.setAttribute("data-grid", JSON.stringify({
      phase, level: cursor, pilot: pilot.name, stars: progress.stars, total: total(progress.stars), skin: progress.skin, theme: progress.theme,
      outcome: result?.outcome ?? null, fresh: result?.fresh.map((r) => r.id) ?? [],
    }));
  }, [phase, cursor, pilot.name, progress, result]);

  const s = sim.current;
  const hud = phase === "play" && s ? s.hud() : null;
  const level = title.levels[cursor]!;
  const world = title.story.worlds[level.world]!;
  const owned = new Set(unlocked(title, progress.stars).map((r) => r.id));
  const upcoming = nextReward(title, progress.stars);
  const bg = title.themes[progress.theme] ?? title.themes[""];

  return (
    <div ref={root} className="tv grid-bg" style={{ background: bg }} data-grid="{}">
      <div className="grid-top">
        <span className="grid-title">{title.emoji} {title.name}</span>
        <span className="grid-level">Level {cursor + 1} · {level.name}</span>
        <span className="grid-pilot">🎮 {title.coop ? ids.map((p) => p.name).join(" + ") : pilot.name}</span>
        {hud && (
          <>
            <span className="grid-goal">
              {hud.goal}
              <span className="grid-bar"><span style={{ width: `${Math.round(Math.min(1, hud.progress) * 100)}%` }} /></span>
            </span>
            {hud.lives !== undefined && <span className="grid-lives">{"❤".repeat(Math.max(0, hud.lives))}</span>}
            <span className="grid-score">{hud.score.toLocaleString("en")}</span>
            <span className="grid-time">{Math.floor(hud.seconds / 60)}:{String(Math.floor(hud.seconds % 60)).padStart(2, "0")}</span>
          </>
        )}
      </div>
      <canvas ref={canvas} className="grid-board" />

      {phase === "map" && (
        <div className="grid-overlay grid-map">
          <h2>{world.name}</h2>
          <div className="grid-levels">
            {title.levels.map((l, i) => {
              const open = isOpen(progress.stars, i);
              return (
                <div key={i} className={`grid-level-card ${i === cursor ? "cur" : ""} ${open ? "" : "locked"}`}>
                  <span className="no">{open ? i + 1 : "🔒"}</span>
                  <span className="nm">{l.name}</span>
                  <Stars n={progress.stars[i] ?? 0} />
                </div>
              );
            })}
          </div>
          <p className="grid-brief">{level.brief}</p>
          <div className="grid-rewards">
            {title.rewards.map((r) => (
              <RewardChip key={r.id} r={r} owned={owned.has(r.id)} atlas={atlas} worn={(r.kind === "skin" && progress.skin === r.id) || (r.kind === "theme" && progress.theme === r.id)} />
            ))}
          </div>
          <p className="grid-hint">
            ★ {total(progress.stars)} / {title.levels.length * 3}
            {upcoming ? ` · ${upcoming.stars - total(progress.stars)} more ★ for ${upcoming.name}` : " · Every reward unlocked!"}
            {" · "}{title.coop ? "" : <><b>{pilot.name}</b>: </>}{title.menu.hint}
          </p>
        </div>
      )}

      {phase === "story" && (
        <div className="grid-overlay grid-story">
          {atlas && <SpriteImg atlas={atlas} id={title.story.heroSprite} size={140} />}
          <h2>{world.name}</h2>
          <p>{world.text}</p>
          <p className="grid-hint">{title.story.heroName} is counting on you, {title.coop ? "both of you" : pilot.name}. Tap ▶ to start.</p>
        </div>
      )}

      {phase === "result" && result && (
        <div className="grid-overlay grid-result">
          <h2>{result.outcome.won ? "Level clear!" : "So close!"}</h2>
          <div className="grid-big-stars"><Stars n={result.outcome.stars} /></div>
          <ul className="grid-checks">
            {result.outcome.checks.map((c, i) => (
              <li key={i} className={c.ok ? "ok" : ""}>{c.ok ? "★" : "☆"} {c.text}</li>
            ))}
          </ul>
          <p className="grid-score-line">{title.coop ? "Together you" : name(pilot.id)} scored <b>{result.outcome.score.toLocaleString("en")}</b>{result.best ? " · new best!" : ""}</p>
          {result.fresh.length > 0 && (
            <div className="grid-unlocked">
              <span>Unlocked:</span>
              {result.fresh.map((r) => <RewardChip key={r.id} r={r} owned atlas={atlas} />)}
            </div>
          )}
          <p className="grid-hint">{title.coop ? "" : <>Next up: <b>{ids[(turn + 1) % ids.length]!.name}</b> · </>}▶ next level · ◀ map</p>
        </div>
      )}
    </div>
  );
}
