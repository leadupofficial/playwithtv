import { useEffect, useRef, useState } from "react";
import type { PlayerView } from "@playwithtv/protocol";
import type { GameProps } from "../types";
import { ControlPlayers } from "../controlKit";
import { ControlTutorial } from "../ControlTutorial";
import { placings } from "../scoring";
import { useQuality } from "../../quality/store";
import type { QualityProfile } from "../../quality/tier";
import { DT, type Ev, type Match, newMatch, stars, step, verbFor } from "./engine";
import { LEVELS } from "./levels";
import { CONTROLS, TiffinControls } from "./input";
import { Hud, type HudState } from "./Hud";
import { TiffinAudio } from "./audio";
import { feedback, phoneStatus } from "./phones";
import { awardsFor } from "./awards";
import { showAwards } from "../kit3d/podium";
import type { KitchenView, ViewLook } from "./view/types";
import { BASE } from "./view/assets";
import type { SpriteManifest } from "../kit25d/manifest";

export { CONTROLS };
const QUICK = typeof location !== "undefined" && new URLSearchParams(location.search).get("quick") === "1";

/** Tiffin Tornado on the TV: 1–4 chefs, three services on a kitchen carriage. */
export function TiffinGame({ players, bridge, paused, onFinish }: GameProps) {
  const chefs = useRef(players.filter((p) => p.connected).slice(0, 4)).current;
  const kit = useRef<ControlPlayers | null>(null);
  kit.current ??= new ControlPlayers(bridge, chefs.map((p) => p.id), CONTROLS);
  const controls = useRef<TiffinControls | null>(null);
  controls.current ??= new TiffinControls(kit.current, chefs.map((p) => p.id));
  const [practising, setPractising] = useState(true);
  useEffect(() => {
    kit.current!.start();
    controls.current!.start();
    return () => {
      controls.current!.dispose();
      kit.current!.dispose();
    };
  }, []);
  if (practising) {
    return (
      <div className="tv" style={{ background: "radial-gradient(circle at 50% 30%, #8a1f2a, #2a0a10)" }}>
        <ControlTutorial title="🫓 Tiffin Tornado" players={chefs} kit={kit.current} practice={["act", "dash"]} quick={QUICK} onDone={() => setPractising(false)} />
      </div>
    );
  }
  return <Kitchen chefs={chefs} kit={kit.current} controls={controls.current} bridge={bridge} paused={paused} onFinish={onFinish} />;
}

function Kitchen({ chefs, kit, controls, bridge, paused, onFinish }: {
  chefs: PlayerView[]; kit: ControlPlayers; controls: TiffinControls; bridge: GameProps["bridge"]; paused: boolean; onFinish: GameProps["onFinish"];
}) {
  const quality = useQuality();
  const canvas = useRef<HTMLCanvasElement>(null);
  const overlay = useRef<HTMLDivElement>(null);
  const awardsEl = useRef<HTMLDivElement>(null);
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const [debug, setDebug] = useState("");
  const [hud, setHud] = useState<HudState | null>(null);
  const [food, setFood] = useState<(SpriteManifest & { names?: string[] }) | null>(null);
  const [progress, setProgress] = useState(0);
  const [failed, setFailed] = useState("");

  useEffect(() => {
    void fetch(`${BASE}/food.json`).then((r) => r.json()).then(setFood).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!quality.ready) return;
    let alive = true, raf = 0;
    let view: KitchenView | null = null;
    const audio = new TiffinAudio();
    const profile: QualityProfile = quality.profile;
    const looks = new Map<string, ViewLook>(chefs.map((p) => [p.id, { name: p.name, color: p.color }]));
    const m: Match = newMatch(chefs.map((p) => p.id), { seed: (Math.random() * 2 ** 31) >>> 0, quick: QUICK });
    const startedAt = Date.now();

    (async () => {
      void audio.load();
      if (profile.prerendered) {
        const { LiteView } = await import("./view/lite");
        const v = new LiteView(canvas.current!, overlay.current!, profile, looks);
        await v.load(setProgress);
        view = v;
      } else {
        const { CineView } = await import("./view/cine");
        const v = new CineView(canvas.current!, overlay.current!, profile, looks);
        await v.load(setProgress);
        view = v;
      }
      await view.level(m);
      if (!alive) return view.dispose();
      loop(view);
    })().catch((e) => alive && setFailed(String(e)));

    function loop(v: KitchenView) {
      let last = performance.now(), acc = 0, frames = 0, fps = 0, fpsT = last, lastDebug = 0, lastPhone = 0;
      let loading = false, reported = false, resultsAt = 0;
      const banners = { text: "", tone: "info" as "warn" | "dark" | "info", until: 0 };
      const events: Ev[] = [];
      const frame = (now: number) => {
        raf = requestAnimationFrame(frame);
        frames++;
        if (now - fpsT >= 1000) { fps = Math.round((frames * 1000) / (now - fpsT)); frames = 0; fpsT = now; }
        const real = Math.min(0.25, (now - last) / 1000); // slow GPUs: catch up (up to 15 fixed steps)
        last = now;
        events.length = 0;
        if (!pausedRef.current && !loading) {
          acc += real;
          let steps = 0;
          while (acc >= DT && steps++ < 15) {
            acc -= DT;
            const inputs = new Map(m.chefs.map((c) => [c.id, controls.read(c.id, verbFor(m, c.id))]));
            const lvl = m.levelIndex;
            events.push(...step(m, DT, inputs));
            if (m.levelIndex !== lvl) {
              loading = true;
              controls.flush();
              void v.level(m).then(() => { loading = false; }, (err) => { setFailed(String(err)); });
              break;
            }
          }
          if (acc > DT * 15) acc = 0;
        }
        for (const e of events) {
          feedback(e, m, audio, bridge, kit, banners, now);
          if (e.kind === "phase" && e.phase === "countdown") controls.flush();
        }
        audio.update(real, m.phase === "service" ? m.kitchen.tiles.filter((t) => (t.code === "t" || t.code === "k") && t.item && t.item.kind !== "burnt" && !t.fire).length : 0, m.phase === "intro" && m.levelIndex === 0 ? Math.max(0, 1 - m.phaseT / (QUICK ? 2 : 6)) : m.speed);
        v.frame(m, pausedRef.current ? 0 : real, events);

        if (now - lastDebug > 120) {
          lastDebug = now;
          const info = v.info();
          setDebug(JSON.stringify({
            phase: m.phase, level: m.levelIndex, t: +m.t.toFixed(1), seconds: m.seconds, points: m.levelPoints, team: m.teamPoints, fps, calls: info.calls, tris: info.tris,
            tier: profile.tier, doors: m.kitchen.doorsShut, dark: +m.dark.toFixed(2), sway: +m.sway.toFixed(2), results: m.results,
            orders: m.book.orders.map((o) => ({ id: o.id, recipe: o.recipe, left: +o.left.toFixed(1) })),
            chefs: m.chefs.map((c) => ({ id: c.id, name: looks.get(c.id)?.name, x: +c.x.toFixed(2), z: +c.z.toFixed(2), fx: +c.fx.toFixed(2), fz: +c.fz.toFixed(2), holding: c.holding?.kind ?? null, parts: c.holding?.parts ?? null, verb: verbFor(m, c.id), serves: c.stats.serves, points: c.stats.points, got: controls.got.get(c.id) })),
            tiles: m.kitchen.tiles.filter((t) => t.code !== "." && t.code !== "#").map((t) => ({ code: t.code, c: t.c, r: t.r, item: t.item?.kind ?? null, stock: t.stock, fire: t.fire > 0 })),
            cols: m.kitchen.w, rows: m.kitchen.h, layout: m.level.layout,
          }));
          const res = m.results[m.results.length - 1] ?? null;
          setHud({
            phase: m.phase, level: m.levelIndex, levelName: m.level.name, subtitle: m.level.subtitle, timeLeft: m.seconds - m.t, points: m.levelPoints, team: m.teamPoints,
            thresholds: stars(m), tickets: m.book.orders.map((o) => ({ id: o.id, recipe: o.recipe, left: o.left, limit: o.limit })),
            banner: now < banners.until ? { text: banners.text, tone: banners.tone } : m.kitchen.doorsShut ? { text: "🚉 Platform stop! Gangway shut: pass dishes through the hatch", tone: "info" } : null,
            result: m.phase === "levelEnd" ? res : null, menu: m.level.menu,
          });
        }
        if (now - lastPhone > 250) {
          lastPhone = now;
          for (const c of m.chefs) phoneStatus(kit, m, c.id);
        }
        if (m.phase === "results") {
          if (!resultsAt) {
            resultsAt = now;
            const cards = awardsFor(m.chefs).map((a) => ({ emoji: a.emoji, title: a.title, name: looks.get(a.playerId)?.name ?? "", color: looks.get(a.playerId)?.color ?? "#fff", detail: a.detail }));
            const totalStars = m.results.reduce((s, r) => s + r.stars, 0);
            showAwards(awardsEl.current!, `⭐ ${totalStars}/${m.results.length * 3}  ·  ${m.teamPoints} TEAM POINTS`, cards);
            audio.play("congrats");
            audio.horn(1.6);
            const ranked = placings(new Map(m.chefs.map((c) => [c.id, c.stats.points])));
            for (const r of ranked) kit.outcome(r.playerId, `${totalStars} ⭐ · ${m.teamPoints} team points · you made ${m.chefs.find((c) => c.id === r.playerId)!.stats.points}`, r.place === 1 ? "👨‍🍳" : "🫓");
          }
          if (!reported && now - resultsAt > (QUICK ? 6000 : 12000)) {
            reported = true;
            onFinish(placings(new Map(m.chefs.map((c) => [c.id, c.stats.points]))), Date.now() - startedAt);
          }
        }
      };
      raf = requestAnimationFrame(frame);
    }
    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      view?.dispose();
      audio.dispose();
    };
  }, [quality.ready]); // eslint-disable-line react-hooks/exhaustive-deps

  const { w, h } = quality.profile.resolution;
  return (
    <div style={{ position: "absolute", inset: 0, background: "#120a10", overflow: "hidden" }} data-tiffin={debug}>
      <canvas ref={canvas} width={w} height={h} style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }} />
      <div ref={overlay} style={{ position: "absolute", inset: 0, pointerEvents: "none", fontFamily: "system-ui, sans-serif" }} />
      {hud && <Hud s={hud} food={food} />}
      <div ref={awardsEl} style={{ position: "absolute", inset: 0, pointerEvents: "none" }} />
      {!debug && !failed && (
        <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center" }}>
          <div className="big-title">🚂 Boarding the Tiffin Tornado Express… {Math.round(progress * 100)}%</div>
        </div>
      )}
      {failed && <div className="paused-overlay"><div className="big-title">Couldn't load the kitchen</div><p className="hint">{failed}</p></div>}
      {paused && <div className="paused-overlay"><div className="big-title">⏸ Paused</div><p className="hint">Reconnecting…</p></div>}
    </div>
  );
}

export const LEVEL_COUNT = LEVELS.length;
