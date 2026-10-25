import { useEffect, useRef, useState } from "react";
import type { PlayerView } from "@playwithtv/protocol";
import type { GameComponent, GameProps } from "../types";
import { ControlPlayers } from "../controlKit";
import { ControlTutorial } from "../ControlTutorial";
import { useQuality } from "../../quality/store";
import type { PlatGameDef } from "./game";
import { PlatControls } from "./input";
import { Hud } from "./Hud";
import { PlatSession, type HudState } from "./session";
import type { Mode } from "./types";
import "./plat.css";

const params = () => (typeof location !== "undefined" ? new URLSearchParams(location.search) : new URLSearchParams());

/**
 * Any kitplat game on the TV: get ready (practise JUMP) → pick co-op or race → levels → podium with awards.
 * `?quick=1` plays the short version, `?mode=coop|race` skips the mode screen.
 */
export function makePlatformer(def: PlatGameDef): GameComponent {
  function PlatformerGame({ players, bridge, paused, onFinish }: GameProps) {
    const humans = useRef(players.filter((p) => p.connected).slice(0, 4)).current;
    const kit = useRef<ControlPlayers | null>(null);
    kit.current ??= new ControlPlayers(bridge, humans.map((p) => p.id), def.controls);
    const controls = useRef<PlatControls | null>(null);
    controls.current ??= new PlatControls(kit.current, bridge, humans.map((p) => p.id));
    const q = params();
    const quick = q.get("quick") === "1";
    const forced = q.get("mode") as Mode | null;
    const [stage, setStage] = useState<"tutorial" | "mode" | "play">("tutorial");
    const [mode, setMode] = useState<Mode>(forced && def.spec.modes.includes(forced) ? forced : def.spec.modes[0]!);
    useEffect(() => {
      kit.current!.start();
      controls.current!.start();
      return () => { controls.current!.dispose(); kit.current!.dispose(); };
    }, []);
    if (stage === "tutorial") {
      return (
        <div className="tv" style={{ background: def.colors[1] }}>
          <ControlTutorial title={`${def.emoji} ${def.title}`} players={humans} kit={kit.current} practice={["jump"]} quick={quick}
            onDone={() => { controls.current!.flush(); setStage(forced || quick || def.spec.modes.length < 2 ? "play" : "mode"); }} />
        </div>
      );
    }
    if (stage === "mode") {
      return <ModeSelect def={def} humans={humans} kit={kit.current} controls={controls.current} onDone={(m) => { setMode(m); controls.current!.flush(); setStage("play"); }} />;
    }
    return <Play def={def} humans={humans} kit={kit.current} controls={controls.current} bridge={bridge} paused={paused} onFinish={onFinish} mode={mode} quick={quick} />;
  }
  return PlatformerGame;
}

function ModeSelect({ def, humans, kit, controls, onDone }: { def: PlatGameDef; humans: PlayerView[]; kit: ControlPlayers; controls: PlatControls; onDone(m: Mode): void }) {
  const modes = def.spec.modes;
  const [pick, setPick] = useState(0);
  const [left, setLeft] = useState(12);
  const pickRef = useRef(0);
  pickRef.current = pick;
  useEffect(() => {
    let lastX = 0;
    const first = humans[0]?.id;
    const inp = { x: 0, y: 0, jump: false, jumpPressed: false, run: false, action: false };
    const id = setInterval(() => {
      if (!first) return;
      controls.read(first, inp);
      const x = inp.x > 0.5 ? 1 : inp.x < -0.5 ? -1 : 0;
      if (x !== 0 && x !== lastX) setPick((p) => Math.max(0, Math.min(modes.length - 1, p + x)));
      lastX = x;
      for (const h of humans.slice(1)) controls.read(h.id, inp);
      if (inp.jumpPressed || inp.action) onDone(modes[pickRef.current]!);
    }, 50);
    const key = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") setPick(0);
      if (e.key === "ArrowRight") setPick(Math.min(1, modes.length - 1));
      if (e.key === "Enter" || e.key === " ") onDone(modes[pickRef.current]!);
    };
    window.addEventListener("keydown", key);
    const t = setInterval(() => setLeft((s) => s - 1), 1000);
    for (const h of humans) kit.status(h.id, { text: humans[0]?.id === h.id ? "◀ ▶ to choose, JUMP to start" : `${humans[0]?.name ?? "Player 1"} is choosing the mode…` });
    return () => { clearInterval(id); clearInterval(t); window.removeEventListener("keydown", key); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (left <= 0) onDone(modes[pickRef.current]!); }, [left]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="plat-root" data-plat-modes={modes[pick]}>
      <div className="plat-modes" style={{ ["--a" as string]: def.colors[0], ["--b" as string]: def.colors[1] }}>
        <h1>{def.emoji} {def.title}</h1>
        <div className="row">
          {modes.map((m, i) => (
            <div key={m} className={`plat-mode ${i === pick ? "on" : ""}`} data-mode={m}>
              <b>{m === "coop" ? "🤝" : "🏁"} {def.modeNames[m]}</b>
              {def.modeBlurbs[m]}
            </div>
          ))}
        </div>
        <p>{humans[0]?.name ?? "Player 1"}: ◀ ▶ to choose, JUMP to start · starts in {Math.max(0, left)} s</p>
      </div>
    </div>
  );
}

function Play({ def, humans, kit, controls, bridge, paused, onFinish, mode, quick }: {
  def: PlatGameDef; humans: PlayerView[]; kit: ControlPlayers; controls: PlatControls; bridge: GameProps["bridge"]; paused: boolean;
  onFinish: GameProps["onFinish"]; mode: Mode; quick: boolean;
}) {
  const quality = useQuality();
  const canvas = useRef<HTMLCanvasElement>(null);
  const overlay = useRef<HTMLDivElement>(null);
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const [debug, setDebug] = useState("");
  const [hud, setHud] = useState<HudState | null>(null);
  const [progress, setProgress] = useState(0);
  const [failed, setFailed] = useState(false);
  const ready = quality.ready;
  useEffect(() => {
    if (!ready) return;
    const s = new PlatSession({
      def, canvas: canvas.current!, overlay: overlay.current!, profile: quality.profile, tier: quality.tier, players: humans, kit, controls, bridge, mode, quick,
      paused: () => pausedRef.current, onProgress: setProgress, onHud: setHud, onDebug: setDebug, onFinish,
    });
    s.start().catch((e) => { console.error(e); setFailed(true); });
    return () => s.dispose();
  }, [ready]); // eslint-disable-line react-hooks/exhaustive-deps
  const { w, h } = quality.profile.resolution;
  return (
    <div className="plat-root" data-plat={debug}>
      <canvas ref={canvas} className="plat-canvas" width={w} height={h} />
      <div ref={overlay} className="plat-overlay" />
      {hud && <Hud state={hud} emoji={def.emoji} />}
      {!debug && !failed && (
        <div className="plat-loading" style={{ ["--a" as string]: def.colors[0], ["--b" as string]: def.colors[1] }}>
          <h1>{def.emoji} {def.title}</h1>
          <div>{def.tagline}</div>
          <div className="bar"><div style={{ width: `${Math.round(progress * 100)}%` }} /></div>
        </div>
      )}
      {failed && <div className="paused-overlay"><div className="big-title">Couldn't load the level</div><p className="hint">Check the connection and start the game again.</p></div>}
      {paused && <div className="paused-overlay"><div className="big-title">⏸ Paused</div><p className="hint">Reconnecting…</p></div>}
    </div>
  );
}
