import { useEffect, useMemo, useRef, useState } from "react";
import { GESTURE_SCALE, STRONG, frameAxes } from "@playwithtv/motion";
import { MODE_CODE, MODE_DIVISOR, buttonsFor, type ControlAction, type ControlMode, type ControlSpec, type GestureName, type SwipeName } from "@playwithtv/protocol";
import type { InputSender } from "./inputSender";
import type { PhoneMotion } from "./motion";
import { Stick } from "./pad/Stick";
import { Touchpad } from "./pad/Touchpad";
import { ActionButtons } from "./pad/ActionButtons";
import { t } from "../i18n";

export interface PadEvent { event: string; data?: Record<string, unknown>; at: number }

/** `labels` lets a game relabel its buttons live (e.g. a context icon on one ACTION button). */
type Status = { text?: string; bars?: Array<{ label: string; value: number; color?: string }>; labels?: Record<string, string> };

/** Which action a gesture or swipe means for this game (a strong gesture may mean a power move). */
function resolver(spec: ControlSpec) {
  const byGesture = new Map<string, ControlAction>();
  const bySwipe = new Map<string, ControlAction>();
  const strong = new Map<string, ControlAction>();
  for (const a of spec.actions) {
    for (const g of a.gestures ?? []) if (!byGesture.has(g)) byGesture.set(g, a);
    for (const s of a.swipes ?? []) if (!bySwipe.has(s)) bySwipe.set(s, a);
    if (a.strongOf) strong.set(a.strongOf, a);
  }
  return {
    gesture(kind: GestureName, strength: number) {
      const a = byGesture.get(kind);
      if (!a) return null;
      return strength >= STRONG ? (strong.get(a.id) ?? a) : a;
    },
    swipe(s: SwipeName | "tap") {
      return bySwipe.get(s) ?? null;
    },
  };
}

/**
 * The one in-game controller. The game's ControlSpec says which modes it offers; the player's chosen mode
 * decides what is drawn. Whatever the mode, the phone sends the same signals (axes.x/y, taps per action,
 * held actions), so games never need to know how a player is controlling them.
 */
export function GamePad({ input, motion, spec, mode, lastEvent, color, recentre }: {
  input: InputSender;
  motion: PhoneMotion;
  spec: ControlSpec;
  mode: ControlMode;
  lastEvent: PadEvent | null;
  color: string;
  /** Changes when the player asks to re-centre; restarts calibration. */
  recentre: number;
}) {
  const tilted = mode === "motion" || mode === "hybrid";
  const [phase, setPhase] = useState<"calibrating" | "ready">(!tilted || (spec.calibrate === false && motion.engine.isCalibrated) ? "ready" : "calibrating");
  const [flash, setFlash] = useState<{ text: string; at: number } | null>(null);
  const [tilt, setTilt] = useState({ x: 0, y: 0 });
  const [stale, setStale] = useState(false);
  const [status, setStatus] = useState<Status | null>(null);
  const [toast, setToast] = useState<{ text: string; tone: string; at: number } | null>(null);
  const [outcome, setOutcome] = useState<{ text: string; emoji?: string } | null>(null);
  const pad = useRef({ x: 0, y: 0 });
  const firstRecentre = useRef(recentre);
  const map = useMemo(() => resolver(spec), [spec]);
  const buttons = buttonsFor(spec, mode).map((b) => (status?.labels?.[b.id] ? { ...b, label: status.labels[b.id]! } : b));

  const fire = (a: ControlAction) => {
    input.tap(a.id);
    setFlash({ text: a.label, at: Date.now() });
  };

  // calibration (tilt modes): wait for stillness (max 4 s), then the current hold becomes neutral
  useEffect(() => {
    if (recentre !== firstRecentre.current && tilted) setPhase("calibrating");
  }, [recentre, tilted]);
  useEffect(() => {
    if (phase !== "calibrating") return;
    const started = Date.now();
    const id = setInterval(() => {
      const f = motion.frame();
      if ((f.still && Date.now() - started > 700) || Date.now() - started > 4000) {
        motion.calibrate();
        setTimeout(() => input.tap("calibrated"), 120);
        navigator.vibrate?.(40);
        setPhase("ready");
      }
    }, 100);
    return () => clearInterval(id);
  }, [phase, motion, input]);

  // movement out, 20 times a second (the sender throttles), plus sensor health in tilt modes
  useEffect(() => {
    const m = MODE_CODE[mode] / MODE_DIVISOR; // axes are clamped to [-1, 1]: send the mode code 0..4 as 0..1
    const id = setInterval(() => {
      if (tilted) {
        const f = motion.frame();
        input.axes(phase === "ready" ? { ...frameAxes(f), m } : { x: 0, y: 0, roll: 0, pitch: 0, yaw: 0, ok: 0, m });
        setTilt({ x: f.roll, y: f.pitch });
        setStale(f.health.stale);
      } else {
        input.axes({ x: pad.current.x, y: pad.current.y, roll: 0, pitch: 0, yaw: 0, ok: 1, m });
      }
    }, 50);
    return () => clearInterval(id);
  }, [motion, input, phase, mode, tilted]);

  // bat-style swings are detected only for games that map them
  useEffect(() => {
    motion.engine.settings.swing = spec.actions.some((a) => a.gestures?.includes("swing"));
  }, [motion, spec]);

  // gestures → actions (motion mode only: in hybrid the buttons do the actions, so a bump can't fire one)
  useEffect(() => motion.onGesture((g) => {
    if (mode !== "motion" || phase !== "ready") return;
    const a = map.gesture(g.kind, g.strength);
    if (!a) return;
    input.axes({ gs: g.strength / GESTURE_SCALE }); // the strength rides along with the tap (ControlReader.gesture)
    fire(a);
    navigator.vibrate?.(g.strength >= STRONG ? 35 : 12);
  }), [motion, mode, phase, map]); // eslint-disable-line react-hooks/exhaustive-deps

  // what the TV tells this phone
  useEffect(() => {
    if (!lastEvent) return;
    const d = lastEvent.data ?? {};
    if (lastEvent.event === "status") setStatus(d as Status);
    if (lastEvent.event === "toast") setToast({ text: String(d.text ?? ""), tone: String(d.tone ?? "info"), at: lastEvent.at });
    if (lastEvent.event === "outcome") setOutcome({ text: String(d.text ?? ""), emoji: d.emoji as string | undefined });
    if (lastEvent.event === "vibrate") navigator.vibrate?.(Number(d.ms ?? 50));
  }, [lastEvent]);

  const fresh = (x: { at: number } | null, ms: number) => !!x && Date.now() - x.at < ms;
  const line = fresh(flash, 700) ? flash!.text : fresh(toast, 2500) ? toast!.text : "";

  if (tilted && stale && motion.active) {
    return (
      <button className="start-gate" onClick={() => { motion.stop(); motion.start(); }}>
        <span style={{ fontSize: 56 }}>📵</span><b>{t("ctl.stale")}</b>
      </button>
    );
  }
  if (outcome) {
    return <div className="pad-panel calib" style={{ borderColor: color }}><span style={{ fontSize: 64 }}>{outcome.emoji ?? "🏁"}</span><b>{outcome.text}</b></div>;
  }
  if (phase === "calibrating") {
    return <div className="pad-panel calib" style={{ borderColor: color }}><div className="calib-ring" style={{ borderColor: color }} /><b>{t("ctl.calibrate")}</b></div>;
  }

  const info = (
    <div className="pad-info">
      <span className="pad-title">{spec.title}</span>
      {status?.text && <span className="pad-status">{status.text}</span>}
      {status?.bars?.map((b) => (
        <span key={b.label} className="pad-bar"><span>{b.label}</span><span className="mini"><span style={{ width: `${Math.round(b.value * 100)}%`, background: b.color ?? color }} /></span></span>
      ))}
      <span className={`pad-flash ${line ? "on" : ""}`}>{line}</span>
    </div>
  );
  const hint = spec.hints?.[mode];
  const tiltDot = (
    <div className="tilt-dot-wrap" aria-hidden><div className="tilt-dot" style={{ background: color, transform: `translate(${tilt.x * 40}px, ${-tilt.y * 40}px)` }} /></div>
  );
  const actionsEl = buttons.length > 0 && (
    <ActionButtons actions={buttons} onTap={(id) => fire(buttons.find((b) => b.id === id)!)} onHold={(id, down) => input.hold(id, down)} />
  );

  return (
    <div className={`game-pad mode-${mode}`} style={{ borderColor: color }} data-mode={mode}>
      {info}
      <div className="pad-body">
        {mode === "buttons" && (
          <>
            {spec.stick !== "none" && <div className="pad-left"><Stick kind={spec.stick} onChange={(x, y) => {
              // a new direction (an arrow pressed or let go) goes out at once instead of on the next 50 ms tick
              const turned = Math.sign(x) !== Math.sign(pad.current.x) || Math.sign(y) !== Math.sign(pad.current.y);
              pad.current = { x, y };
              if (turned) input.axesNow({ x, y, roll: 0, pitch: 0, yaw: 0, ok: 1, m: MODE_CODE[mode] / MODE_DIVISOR });
            }} /></div>}
            <div className="pad-right">{actionsEl}</div>
          </>
        )}
        {mode === "hybrid" && (
          <>
            <div className="pad-left tilt-side">{tiltDot}<span className="hint">{hint ?? "tilt to move"}</span></div>
            <div className="pad-right">{actionsEl}</div>
          </>
        )}
        {mode === "motion" && (
          <div className="pad-motion">
            <div className="mp-watch">👀 {t("ctl.watchTv")}</div>
            {tiltDot}
            {hint && <span className="hint">{hint}</span>}
          </div>
        )}
        {mode === "touchpad" && (
          <>
            <div className="pad-left wide">
              <Touchpad
                onMove={(x, y) => { pad.current = { x, y }; }}
                onSwipe={(s) => { const a = map.swipe(s); if (a) fire(a); }}
              />
            </div>
            {buttons.length > 0 && <div className="pad-right narrow">{actionsEl}</div>}
          </>
        )}
      </div>
    </div>
  );
}
