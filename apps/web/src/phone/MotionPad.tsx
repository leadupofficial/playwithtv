import { useEffect, useRef, useState } from "react";
import { STRONG, frameAxes, strongKey, type GestureKind } from "@scp/motion";
import type { InputSender } from "./inputSender";
import type { PhoneMotion } from "./motion";
import { t } from "../i18n";

/** What a game's controller.layout data may contain (all optional). */
export interface MotionLayout {
  title?: string;
  /** The moves this game uses, shown as a reminder: [{ motion: "roll", label: "steer" }]. */
  controls?: Array<{ motion: GestureKind | "roll" | "pitch" | "yaw"; label: string }>;
  /** false = keep the current calibration (e.g. the next round of the same game). */
  calibrate?: boolean;
}

export interface PadEvent { event: string; data?: Record<string, unknown>; at: number }

const motionLabel = (m: string) => t(`motion.${m}` as Parameters<typeof t>[0]);

/**
 * The one controller every game uses. During play the screen needs no touches: tilt streams as axes,
 * gestures go out as tap counters, and the phone mostly says "watch the TV". Calibration happens
 * automatically when the player holds still (or after 4 s), at the start of every game.
 */
export function MotionPad({ input, motion, layout, lastEvent, color, recentre }: {
  input: InputSender;
  motion: PhoneMotion;
  layout: MotionLayout;
  lastEvent: PadEvent | null;
  color: string;
  /** Changes when the player asks to re-centre; restarts calibration. */
  recentre: number;
}) {
  const [phase, setPhase] = useState<"calibrating" | "ready">(layout.calibrate === false && motion.engine.isCalibrated ? "ready" : "calibrating");
  const [flash, setFlash] = useState<{ text: string; at: number } | null>(null);
  const [tilt, setTilt] = useState({ roll: 0, pitch: 0 });
  const [stale, setStale] = useState(false);
  const [status, setStatus] = useState<{ text?: string; bars?: Array<{ label: string; value: number; color?: string }> } | null>(null);
  const [toast, setToast] = useState<{ text: string; tone: string; at: number } | null>(null);
  const [outcome, setOutcome] = useState<{ text: string; emoji?: string } | null>(null);
  const firstRecentre = useRef(recentre);

  // calibration: wait for stillness (max 4 s), then the current hold becomes neutral
  useEffect(() => {
    if (recentre !== firstRecentre.current) setPhase("calibrating");
  }, [recentre]);
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

  // stream tilt (the sender throttles to 20 Hz) and watch sensor health
  useEffect(() => {
    const id = setInterval(() => {
      const f = motion.frame();
      input.axes(phase === "ready" ? frameAxes(f) : { roll: 0, pitch: 0, yaw: 0, ok: 0 });
      setTilt({ roll: f.roll, pitch: f.pitch });
      setStale(f.health.stale);
    }, 50);
    return () => clearInterval(id);
  }, [motion, input, phase]);

  // gestures out
  useEffect(() => motion.onGesture((g) => {
    if (phase !== "ready") return;
    input.tapMany(g.strength >= STRONG ? [g.kind, strongKey(g.kind)] : [g.kind]);
    setFlash({ text: motionLabel(g.kind), at: Date.now() });
    navigator.vibrate?.(g.strength >= STRONG ? 35 : 12);
  }), [motion, input, phase]);

  // what the TV tells this phone
  useEffect(() => {
    if (!lastEvent) return;
    const d = lastEvent.data ?? {};
    if (lastEvent.event === "status") setStatus(d as typeof status);
    if (lastEvent.event === "toast") setToast({ text: String(d.text ?? ""), tone: String(d.tone ?? "info"), at: lastEvent.at });
    if (lastEvent.event === "outcome") setOutcome({ text: String(d.text ?? ""), emoji: d.emoji as string | undefined });
    if (lastEvent.event === "vibrate") navigator.vibrate?.(Number(d.ms ?? 50));
  }, [lastEvent]);

  const freshFlash = flash && Date.now() - flash.at < 700;
  const freshToast = toast && Date.now() - toast.at < 2500;

  if (stale && motion.active) {
    return (
      <button className="start-gate" onClick={() => { motion.stop(); motion.start(); }}>
        <span style={{ fontSize: 56 }}>📵</span><b>{t("ctl.stale")}</b>
      </button>
    );
  }

  return (
    <div className="motion-pad" style={{ borderColor: color }}>
      {phase === "calibrating" ? (
        <div className="calib"><div className="calib-ring" style={{ borderColor: color }} /><b>{t("ctl.calibrate")}</b></div>
      ) : outcome ? (
        <div className="calib"><span style={{ fontSize: 64 }}>{outcome.emoji ?? "🏁"}</span><b>{outcome.text}</b></div>
      ) : (
        <>
          <div className="mp-title">{layout.title ?? ""}</div>
          <div className="mp-watch">👀 {t("ctl.watchTv")}</div>
          {status?.text && <div className="mp-status">{status.text}</div>}
          {status?.bars && (
            <div className="mp-bars">{status.bars.map((b) => (
              <div key={b.label} className="mp-bar"><span>{b.label}</span><div className="mini"><div style={{ width: `${Math.round(b.value * 100)}%`, background: b.color ?? color }} /></div></div>
            ))}</div>
          )}
          <div className={`mp-flash ${freshFlash ? "on" : ""}`}>{freshFlash ? flash!.text : freshToast ? toast!.text : ""}</div>
          <div className="mp-row">
            <div className="tilt-dot-wrap" aria-hidden><div className="tilt-dot" style={{ background: color, transform: `translate(${tilt.roll * 40}px, ${-tilt.pitch * 40}px)` }} /></div>
            <ul className="mp-controls">{layout.controls?.map((c) => <li key={c.motion + c.label}><b>{motionLabel(c.motion)}</b> {c.label}</li>)}</ul>
          </div>
        </>
      )}
    </div>
  );
}
