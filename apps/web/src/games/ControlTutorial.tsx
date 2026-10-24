import { useEffect, useRef, useState } from "react";
import type { ControlMode, PlayerView } from "@playwithtv/protocol";
import { AVATARS } from "../avatars";
import { t } from "../i18n";
import { MODE_ICON, type ControlPlayers } from "./controlKit";

const MAX_MS = 30_000;
const COUNTDOWN = 3;
const MODE_TITLE: Record<ControlMode, string> = { buttons: "Buttons", motion: "Motion", hybrid: "Hybrid", touchpad: "Touchpad" };

/**
 * Get-ready screen before every game, on the TV. It explains each control mode the game offers (players pick
 * theirs on the phone), then shows each player's card: their mode, a live movement dot, whether a tilting
 * phone is calibrated, and a tick per practice action (done with a button, a gesture or a swipe: whatever
 * that player uses). Starts when everyone is ready (3 s countdown), after 30 s, or on OK from the remote.
 */
export function ControlTutorial({ title, players, kit, practice, onDone, quick }: {
  title: string;
  players: PlayerView[];
  kit: ControlPlayers;
  /** Action ids every player does once before the game starts. */
  practice: string[];
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

  const active = players.filter((p) => p.connected);
  const allReady = active.length > 0 && active.every((p) => kit.ready(p.id, practice));
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

  const spec = kit.spec;
  const label = (id: string) => spec.actions.find((a) => a.id === id)?.label ?? id;
  return (
    <div className="tutorial" data-tutorial>
      <h1 className="big-title" style={{ fontSize: "2.2em" }}>{title}</h1>
      <p className="hint">{t("tut.title")} · pick your controls on your phone</p>
      <ul className="tut-modes">
        {spec.modes.map((m, i) => (
          <li key={m}>
            <b>{MODE_ICON[m]} {MODE_TITLE[m]}{i === 0 ? " ★" : ""}</b>
            <span>{spec.hints?.[m] ?? ""}</span>
          </li>
        ))}
      </ul>
      <div className="tut-players">
        {active.map((p) => {
          const r = kit.get(p.id);
          const mode = kit.mode(p.id);
          const tilt = mode === "motion" || mode === "hybrid";
          const live = r.ok && (!tilt || r.calibrations > 0);
          return (
            <div key={p.id} className={`tut-card ${kit.ready(p.id, practice) ? "ready" : ""}`} style={{ borderColor: p.color }} data-player={p.name} data-mode={mode}>
              <div className="tut-head">
                <span className="avatar" style={{ boxShadow: `0 0 0 0.15em ${p.color}` }}>{AVATARS[p.avatar].emoji}</span>
                <b>{p.name}</b>
                <span className="tut-mode">{r.lastUpdate ? `${MODE_ICON[mode]} ${MODE_TITLE[mode]}` : ""}</span>
              </div>
              <div className="tut-tilt"><div style={{ background: p.color, transform: `translate(${r.x * 46}px, ${-r.y * 46}px)` }} /></div>
              <div className={`tut-step ${live ? "ok" : ""}`}>
                {live ? `✓ ${t("tut.ready")}` : !r.lastUpdate ? t("tut.noSensor") : tilt ? t("tut.hold") : "…"}
              </div>
              {practice.map((a) => (
                <div key={a} className={`tut-step ${kit.seen.get(p.id)?.has(a) ? "ok" : ""}`}>
                  {kit.seen.get(p.id)?.has(a) ? "✓" : "○"} {t("tut.try")}: {label(a)}
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
