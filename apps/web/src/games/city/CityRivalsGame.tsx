import { useEffect, useRef, useState } from "react";
import type { PlayerView } from "@playwithtv/protocol";
import type { GameProps } from "../types";
import { ControlPlayers } from "../controlKit";
import { ControlTutorial } from "../ControlTutorial";
import { useQuality } from "../../quality/store";
import { placings } from "../scoring";
import { raceScore } from "../ghat/awards";
import { CONTROLS } from "./controls";
import { CitySession, MAX_PLAYERS } from "./session";
import { Hud } from "./Hud";
import type { HudState } from "./session";
import "./city.css";

export { CONTROLS };
const QUICK = typeof location !== "undefined" && new URLSearchParams(location.search).get("quick") === "1";

/** CITY RIVALS on the TV: 1–4 players drive one compact city district in split screen; CPUs fill the field to four. */
export function CityRivalsGame({ players, bridge, paused, onFinish }: GameProps) {
  const humans = useRef(players.filter((p) => p.connected).slice(0, MAX_PLAYERS)).current;
  const kit = useRef<ControlPlayers | null>(null);
  kit.current ??= new ControlPlayers(bridge, humans.map((p) => p.id), CONTROLS);
  const [practising, setPractising] = useState(true);
  const { profile, ready } = useQuality();
  useEffect(() => {
    kit.current!.start();
    return () => kit.current!.dispose();
  }, []);
  if (practising) {
    return (
      <div className="tv" style={{ background: "#2a1f33" }}>
        <ControlTutorial title="🏙️ CITY RIVALS" players={humans} kit={kit.current} practice={["boost"]} quick={QUICK} onDone={() => setPractising(false)} />
      </div>
    );
  }
  if (!ready) return <div className="cr-root"><div className="cr-loading"><h1>CITY RIVALS</h1></div></div>;
  return <Race humans={humans} kit={kit.current} bridge={bridge} paused={paused} onFinish={onFinish} profile={profile} />;
}

function Race({ humans, kit, bridge, paused, onFinish, profile }: {
  humans: PlayerView[]; kit: ControlPlayers; bridge: GameProps["bridge"]; paused: boolean; onFinish: GameProps["onFinish"]; profile: ReturnType<typeof useQuality>["profile"];
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const [progress, setProgress] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [hud, setHud] = useState<HudState | null>(null);
  const [debug, setDebug] = useState("");

  useEffect(() => {
    let alive = true, raf = 0, reported = false;
    const session = new CitySession(humans, kit, bridge, { quick: QUICK, seed: (Math.random() * 2 ** 31) >>> 0, profile });
    session.load(canvas.current!, setProgress).then(() => {
      if (!alive) return;
      setLoaded(true);
      let last = performance.now(), lastHud = 0;
      const tick = (now: number) => {
        raf = requestAnimationFrame(tick);
        const dt = Math.min(0.1, (now - last) / 1000);
        last = now;
        const over = session.frame(now, dt, pausedRef.current);
        if (now - lastHud > 90) {
          lastHud = now;
          setHud(session.hud());
          setDebug(JSON.stringify(session.debug()));
        }
        if (over && !reported) {
          reported = true;
          const { order, ms } = session.results();
          const scores = new Map(order.filter((id) => humans.some((h) => h.id === id)).map((id) => [id, raceScore(order.indexOf(id) + 1, order.length)]));
          onFinish(placings(scores), ms);
        }
      };
      raf = requestAnimationFrame(tick);
    }).catch((e) => {
      console.error(e);
      if (alive) setFailed(true);
    });
    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      session.dispose();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="cr-root" data-city={debug}>
      <canvas ref={canvas} className="cr-canvas" width={profile.resolution.w} height={profile.resolution.h} />
      {hud && <Hud s={hud} />}
      {!loaded && !failed && (
        <div className="cr-loading">
          <div style={{ textAlign: "center" }}>
            <h1>CITY RIVALS</h1>
            <p>Switching on the street lights… {Math.round(progress * 100)}%</p>
            <div className="bar"><i style={{ width: `${Math.round(progress * 100)}%` }} /></div>
          </div>
        </div>
      )}
      {failed && <div className="paused-overlay"><div className="big-title">Couldn't load the city</div><p className="hint">Check the connection and start the game again.</p></div>}
      {paused && <div className="paused-overlay"><div className="big-title">⏸ Paused</div><p className="hint">Reconnecting…</p></div>}
    </div>
  );
}
