import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { installSpatialNav } from "../tv/spatialNav";
import { setQualityOverride, useQuality } from "../quality/store";
import { type QualitySetting, TIERS } from "../quality/tier";
import { LiteView } from "./LiteView";
import { RealtimeView } from "./RealtimeView";
import type { ViewControl, ViewStats } from "./common";
import "./showroom.css";

const NAME: Record<QualitySetting, string> = { auto: "Auto", lite: "Lite", high: "High", ultra: "Ultra" };
const WHAT: Record<string, string> = {
  lite: "Pre-rendered in Blender: 16-direction lit sprites + a hardware-decoded video loop. Runs on a 1 GB TV.",
  high: "Real-time PBR: HDRI sky light, soft shadows, AgX tone mapping, bloom + FXAA.",
  ultra: "Real-time PBR at 1440p: bigger shadow maps, ambient occlusion (GTAO), bloom + SMAA.",
};

/**
 * /tv/showroom: the test vehicle in every render tier, switchable with the remote (D-pad + OK), so the owner can
 * compare on the TV and on a laptop. `?quality=lite|high|ultra` opens a tier directly.
 */
export default function Showroom() {
  const q = useQuality();
  const control = useRef<ViewControl>({ angle: 0.5, spin: true });
  const [spin, setSpin] = useState(true);
  useEffect(() => installSpatialNav(), []);
  // stats belong to the tier that reported them: a tier switch starts from empty (no effect, so a fast
  // first report, e.g. a cached video's first frame, can never be wiped by a late reset)
  const tierRef = useRef(q.tier);
  tierRef.current = q.tier;
  const [tagged, setTagged] = useState<{ tier: string; s: ViewStats }>({ tier: q.tier, s: {} });
  const stats = tagged.tier === q.tier ? tagged.s : {};
  const onStats = useCallback((s: ViewStats) => setTagged((old) => ({ tier: tierRef.current, s: old.tier === tierRef.current ? { ...old.s, ...s } : s })), []);
  const nudge = (d: number) => {
    control.current.angle += d;
  };
  const chosen = q.override ?? q.setting;
  const debug = JSON.stringify({ tier: q.tier, setting: chosen, ready: q.ready, view: q.profile.prerendered ? "lite" : "realtime", ...stats });

  return (
    <div className="tv showroom" data-showroom={debug}>
      <div className="showroom-stage">
        {!q.ready ? null : q.profile.prerendered
          ? <LiteView key="lite" profile={q.profile} control={control} onStats={onStats} />
          : <RealtimeView key={q.tier} profile={q.profile} control={control} onStats={onStats} />}
      </div>
      <div className="showroom-hud">
        <div className="tv-header">
          <div className="brand"><b>Showroom</b><span className="hint">&nbsp;· the same car in every graphics tier</span></div>
          <div className="row">
            {(["auto", ...TIERS] as QualitySetting[]).map((t, i) => (
              <button key={t} className={`chip showroom-tab ${chosen === t ? "on" : ""}`} data-nav autoFocus={i === 0}
                data-tier-tab={t} onClick={() => setQualityOverride(t === "auto" ? null : t)}>
                {NAME[t]}{t === "auto" && q.detection ? ` (${NAME[q.detection.tier]})` : ""}
              </button>
            ))}
          </div>
        </div>
        <div className="showroom-bottom">
          <div className="panel showroom-info">
            <div className="section-title">{NAME[q.tier]} tier</div>
            <div>{WHAT[q.tier]}</div>
            <div className="hint">
              {stats.error ? `⚠️ ${stats.error}` : stats.loaded ? `${stats.fps ?? "…"} fps · ${stats.calls ?? "…"} draw calls${stats.tris ? ` · ${(stats.tris / 1000).toFixed(1)}k triangles` : ""}` : "Loading…"}
              {" · "}{q.profile.resolution.w}×{q.profile.resolution.h}
            </div>
            {q.detection && <div className="hint showroom-why">Detected: {NAME[q.detection.tier]} ({q.detection.reasons.slice(0, 3).join("; ")})</div>}
          </div>
          <div className="row">
            <button className="btn secondary" data-nav onClick={() => nudge(-Math.PI / 8)} aria-label="Turn left">◀</button>
            <button className="btn secondary" data-nav onClick={() => { control.current.spin = !spin; setSpin(!spin); }}>{spin ? "⏸ Stop" : "⟳ Spin"}</button>
            <button className="btn secondary" data-nav onClick={() => nudge(Math.PI / 8)} aria-label="Turn right">▶</button>
            <Link className="btn" to="/tv" data-nav>Back</Link>
          </div>
        </div>
      </div>
    </div>
  );
}
