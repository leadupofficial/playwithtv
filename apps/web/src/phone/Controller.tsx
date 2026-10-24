import { useEffect, useRef, useState } from "react";
import type { ControlMode, ControlSpec, ControllerType, GameResult, PlayerView, RoomView } from "@playwithtv/protocol";
import { HubSocket, type SocketStatus } from "../net";
import { AVATARS } from "../avatars";
import type { PhoneSession } from "./JoinApp";
import { InputSender } from "./inputSender";
import { PhoneMotion, goLandscape, motionSupported, requestMotionPermission, savedSensitivity } from "./motion";
import { GamePad, type PadEvent } from "./GamePad";
import { t } from "../i18n";
import { PhoneLink } from "../rtc";
import { ScreenWake, type WakeState } from "./wakeLock";
import { InstallBanner } from "../InstallBanner";

const PICKS_KEY = "pwtv.controls";
const MODE_LABEL: Record<ControlMode, string> = { buttons: "🎮 Buttons", motion: "🎯 Motion", hybrid: "⚡ Hybrid", touchpad: "👆 Touchpad" };

/** Each player's preferred control mode per game, remembered on this phone. */
function loadPicks(): Record<string, ControlMode> {
  try {
    return JSON.parse(localStorage.getItem(PICKS_KEY) ?? "{}");
  } catch {
    return {};
  }
}
function savePicks(p: Record<string, ControlMode>) {
  try {
    localStorage.setItem(PICKS_KEY, JSON.stringify(p));
  } catch {
    /* private mode: remembered for this visit only */
  }
}

export function buzz(ms: number | number[]) {
  try {
    navigator.vibrate?.(ms);
  } catch {
    /* not supported (iPhone Safari) */
  }
}

/**
 * The phone in a room. Setup uses taps (join, allow motion, ready); once a game starts the phone becomes the
 * game's controller (GamePad) in the mode this player picked: buttons, motion, hybrid or touchpad.
 */
export function Controller({ session, onLeave }: { session: PhoneSession; onLeave: (forget: boolean) => void }) {
  const [status, setStatus] = useState<SocketStatus>("connecting");
  const [room, setRoom] = useState<RoomView | null>(null);
  const [layout, setLayout] = useState<{ type: ControllerType; data?: Record<string, unknown>; n: number }>({ type: "lobby", n: 0 });
  const [fatal, setFatal] = useState<string | null>(null);
  const [latency, setLatency] = useState({ ms: 0, direct: false });
  const [lastEvent, setLastEvent] = useState<PadEvent | null>(null);
  const [started, setStarted] = useState(false);
  const [motionState, setMotionState] = useState<"unknown" | "ok" | "denied" | "unsupported">("unknown");
  const [recentre, setRecentre] = useState(0);
  const [picks, setPicks] = useState<Record<string, ControlMode>>(loadPicks);
  const socket = useRef<HubSocket | null>(null);
  const input = useRef<InputSender | null>(null);
  const motion = useRef(new PhoneMotion());
  const wake = useRef(new ScreenWake());
  const [wakeState, setWakeState] = useState<WakeState>("off");

  useEffect(() => {
    const s = new HubSocket({ type: "hello", v: 1, role: "controller", roomId: session.roomId, playerToken: session.playerToken });
    socket.current = s;
    const link = new PhoneLink(s); // same Wi-Fi as the TV: motion goes straight to it, not via the server
    input.current = new InputSender(s, (seq, state) => link.send(seq, state));
    s.onStatus(setStatus);
    s.on((m) => {
      if (m.type === "welcome" || m.type === "room.state") setRoom(m.room);
      if (m.type === "controller.layout") {
        input.current?.release();
        setLayout((l) => ({ type: m.layout, data: m.data, n: l.n + 1 }));
        setLastEvent(null);
      }
      if (m.type === "tv.event") setLastEvent({ event: m.event, data: m.data, at: Date.now() });
      if (m.type === "room.expired") setFatal("This game session has ended. Scan the TV code to join again.");
      if (m.type === "error" && (m.code === "unauthorized" || m.code === "room_not_found")) setFatal(m.message);
    });
    const lat = setInterval(() => setLatency(link.mode === "direct" ? { ms: link.rttMs, direct: true } : { ms: s.latencyMs, direct: false }), 2000);
    const hide = () => document.hidden && input.current?.release(); // never leave tilt "held" in a background tab
    document.addEventListener("visibilitychange", hide);
    const m = motion.current;
    const w = wake.current;
    const offWake = w.onChange(setWakeState);
    return () => {
      offWake();
      w.stop();
      clearInterval(lat);
      document.removeEventListener("visibilitychange", hide);
      input.current?.stop();
      m.stop();
      link.close();
      s.close();
    };
  }, [session.roomId, session.playerToken]);

  /** Must run inside a tap: iPhone motion permission, full screen and the landscape lock all need a user gesture. */
  async function start() {
    void wake.current.start(); // motion play means no touches: keep the screen from sleeping
    await goLandscape();
    if (!motionSupported()) {
      setMotionState("unsupported");
    } else if (await requestMotionPermission()) {
      motion.current.start();
      setMotionState("ok");
    } else {
      setMotionState("denied");
    }
    setStarted(true);
  }

  const me: PlayerView | undefined = room?.players.find((p) => p.id === session.playerId);
  const spec = layout.type === "game" ? (layout.data as unknown as ControlSpec | undefined) : undefined;
  const modes = (spec?.modes ?? []).filter((m) => (m === "motion" || m === "hybrid" ? motionState === "ok" : true));
  const mode: ControlMode | undefined = spec ? (picks[spec.title] && modes.includes(picks[spec.title]!) ? picks[spec.title] : modes[0]) : undefined;
  const nextMode = () => {
    if (!spec || !mode || modes.length < 2) return;
    const next = modes[(modes.indexOf(mode) + 1) % modes.length]!;
    const p = { ...picks, [spec.title]: next };
    setPicks(p);
    savePicks(p);
    input.current?.release();
  };

  if (fatal) {
    return (
      <div className="phone">
        <div className="ctl-message"><div><h1>Session ended</h1><p>{fatal}</p></div></div>
        <button className="btn" onClick={() => onLeave(true)}>Join again</button>
      </div>
    );
  }

  return (
    <div className="phone controller" data-wake={wakeState}>
      <div className="rotate-hint"><div style={{ fontSize: 72 }}>📱↻</div><h1>{t("ctl.rotate")}</h1><p>{t("ctl.rotateHint")}</p></div>

      {!started ? (
        <button className="start-gate" onClick={() => void start()}>
          <span style={{ fontSize: 64 }}>{me ? AVATARS[me.avatar].emoji : "🎮"}</span>
          <b>{t("ctl.start")}</b>
          <span>{t("ctl.startHint")}</span>
        </button>
      ) : (
        <>
          <div className="status-bar">
            <span className="me">
              <span className="swatch" style={{ background: me?.color ?? "#888" }} />
              {me ? `${AVATARS[me.avatar].emoji} ${me.name}` : "…"}
            </span>
            <span className="row" style={{ gap: 8 }}>
              {mode && modes.length > 1 && <button className="chip mode-chip" onClick={nextMode} aria-label="Change controls">{MODE_LABEL[mode]} ⇄</button>}
              {(mode === "motion" || mode === "hybrid") && <button className="chip" onClick={() => setRecentre((n) => n + 1)}>⟳ {t("ctl.recentre")}</button>}
              <span className="chip" aria-live="polite" data-link={latency.direct ? "direct" : "server"}>
                <span className={`dot ${status === "open" ? "on" : ""}`} />
                {status !== "open" ? (status === "reconnecting" ? "Reconnecting…" : "Connecting…")
                  : `${latency.direct ? "⚡ Direct" : "☁"} ${latency.ms || "–"} ms`}
              </span>
              <button className="chip" onClick={() => {
                socket.current?.send({ type: "player.leave" });
                onLeave(true);
              }}>{t("ctl.leave")}</button>
            </span>
          </div>

          {wakeState !== "on" && <div className="wake-hint" data-wake={wakeState}>{t("ctl.wake")}</div>}
          <video className="keep-awake" ref={(el) => wake.current.attach(el)} src="/keepawake.mp4" muted playsInline loop preload="auto" aria-hidden />
          <div className="ctl-body">
            {spec && !mode ? (
              <div className="ctl-message">{motionState === "denied" ? t("ctl.denied") : t("ctl.noSensors")}</div>
            ) : layout.type === "lobby" ? (
              <Lobby room={room} me={me} data={layout.data} motion={motion.current} onReady={(r) => socket.current?.send({ type: "player.ready", ready: r })} />
            ) : input.current && spec && mode ? (
              <GamePad
                key={`${layout.n}-${mode}`}
                input={input.current}
                motion={motion.current}
                spec={spec}
                mode={mode}
                lastEvent={lastEvent}
                color={me?.color ?? "#7c3aed"}
                recentre={recentre}
              />
            ) : null}
          </div>
        </>
      )}
    </div>
  );
}

function Lobby({ room, me, data, motion, onReady }: {
  room: RoomView | null; me?: PlayerView; data?: Record<string, unknown>; motion: PhoneMotion; onReady: (r: boolean) => void;
}) {
  const results = data?.results as GameResult[] | undefined;
  const mine = results?.find((r) => r.playerId === me?.id);
  const title = (data?.title as string | undefined) ?? (room?.gameId ? "Game selected" : null);
  const [sens, setSens] = useState(savedSensitivity);
  return (
    <>
    <InstallBanner />
    <div className="lobby-pad">
      <div className="ctl-message">
        <div>
          {mine ? (
            <>
              <div style={{ fontSize: 56 }}>{mine.place === 1 ? "🏆" : mine.place <= 3 ? "🎉" : "👏"}</div>
              <h1>{mine.place === 1 ? "You won!" : `You came #${mine.place}`}</h1>
              <p>Score {Math.round(mine.score)} · look at the TV for a rematch</p>
            </>
          ) : (
            <>
              <h1>You're in!</h1>
              <p>{title ? `${title} is up next. Watch the TV.` : "Look at the TV. The host picks a game with the remote."}</p>
              <p className="hint">{room?.players.filter((p) => p.connected).length ?? 0} player(s) connected</p>
            </>
          )}
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <button className={`btn ${me?.ready ? "secondary" : ""}`} onClick={() => onReady(!me?.ready)}>
          {me?.ready ? "✅ Ready (tap to undo)" : "I'm ready"}
        </button>
        <label className="sens">{t("ctl.sensitivity")}
          <input type="range" min={0.5} max={2} step={0.1} value={sens} onChange={(e) => {
            const v = Number(e.target.value);
            setSens(v);
            motion.setSensitivity(v);
          }} />
        </label>
      </div>
    </div>
    </>
  );
}
