import { useEffect, useRef, useState } from "react";
import type { GestureKind } from "@playwithtv/motion";
import type { PlayerView } from "@playwithtv/protocol";
import { AVATARS } from "../avatars";
import { t } from "../i18n";
import { type MotionControl, type MotionPlayers, motionLabel } from "./motionKit";

const MAX_MS = 30_000;
const COUNTDOWN = 3;

/**
 * Calibration + practice before every motion game, on the TV: each player's card shows whether their phone
 * is calibrated, a live tilt dot, and ticks for each practice gesture they have performed. Starts when everyone
 * is ready (after a 3 s countdown), after 30 s, or when the host presses OK on the remote.
 */
export function MotionTutorial({ title, players, kit, controls, practice, onDone, quick }: {
  title: string;
  players: PlayerView[];
  kit: MotionPlayers;
  controls: MotionControl[];
  practice: GestureKind[];
  onDone(): void;
  quick?: boolean;
}) {
  const [, tick] = useState(0);
  const [countdown, setCountdown] = useState<number | null>(null);
  const started = useRef(Date.now());
  const done = useRef(false);
  const finish = () => {
    if (done.current) return;
    done.current = true;
    onDone();
  };

  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 100);
    const key = (e: KeyboardEvent) => (e.key === "Enter" || e.key === " ") && finish();
    window.addEventListener("keydown", key);
    return () => {
      clearInterval(id);
      window.removeEventListener("keydown", key);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const ready = (p: PlayerView) => {
    const r = kit.get(p.id);
    return r.calibrations > 0 && r.ok && practice.every((g) => kit.seen.get(p.id)?.has(g));
  };
  const active = players.filter((p) => p.connected);
  const allReady = active.length > 0 && active.every(ready);

  useEffect(() => {
    if (allReady && countdown === null) setCountdown(quick ? 1 : COUNTDOWN);
    if (!allReady && countdown !== null && countdown > 0) setCountdown(null);
  }, [allReady]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (countdown === null) return;
    if (countdown <= 0) return finish();
    const id = setTimeout(() => setCountdown((c) => (c ?? 1) - 1), 1000);
    return () => clearTimeout(id);
  }, [countdown]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (Date.now() - started.current > MAX_MS) finish();
  });

  return (
    <div className="tutorial" data-tutorial>
      <h1 className="big-title" style={{ fontSize: "2.2em" }}>{title}</h1>
      <p className="hint">{t("tut.title")}</p>
      <ul className="tut-controls">
        {controls.map((c) => <li key={c.motion + c.label}><b>{motionLabel(c.motion)}</b><span>{c.label}</span></li>)}
      </ul>
      <div className="tut-players">
        {active.map((p) => {
          const r = kit.get(p.id);
          const calibrated = r.calibrations > 0 && r.ok;
          return (
            <div key={p.id} className={`tut-card ${ready(p) ? "ready" : ""}`} style={{ borderColor: p.color }} data-player={p.name}>
              <div className="tut-head"><span className="avatar" style={{ boxShadow: `0 0 0 0.15em ${p.color}` }}>{AVATARS[p.avatar].emoji}</span><b>{p.name}</b></div>
              <div className="tut-tilt"><div style={{ background: p.color, transform: `translate(${r.roll * 46}px, ${-r.pitch * 46}px)` }} /></div>
              <div className={`tut-step ${calibrated ? "ok" : ""}`}>{calibrated ? `✓ ${t("tut.ready")}` : r.lastUpdate ? t("tut.hold") : t("tut.noSensor")}</div>
              {practice.map((g) => (
                <div key={g} className={`tut-step ${kit.seen.get(p.id)?.has(g) ? "ok" : ""}`}>
                  {kit.seen.get(p.id)?.has(g) ? "✓" : "○"} {t("tut.try")}: {motionLabel(g)}
                </div>
              ))}
            </div>
          );
        })}
      </div>
      <p className="hint">{countdown !== null ? t("tut.starting", { n: countdown }) : t("tut.skip")}</p>
    </div>
  );
}
