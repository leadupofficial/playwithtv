import { useEffect, useMemo, useRef, useState } from "react";
import { MODE_CODE, MODE_DIVISOR, type ControlAction, type ControlSpec, type PoseMove } from "@playwithtv/protocol";
import type { InputSender } from "../inputSender";
import type { PadEvent } from "../GamePad";
import { BONES, PoseTracker, type PoseOutput } from "./poseActions";
import { CameraRunner, type CamStatus } from "./cameraRunner";
import { CameraSetup, INTENSITY_CODE, JUMP_RISE, loadSettings, saveSettings, type CamSettings } from "./CameraSetup";
import "./camera.css";

type Status = { text?: string; bars?: Array<{ label: string; value: number; color?: string }> };
type View = Pick<PoseOutput, "state" | "message" | "calib">;

/** Which action a body move means for this game (standing or seated). */
function poseMap(spec: ControlSpec, seated: boolean) {
  const m = new Map<PoseMove, ControlAction>();
  for (const a of spec.actions) for (const p of (seated ? a.seatedPoses ?? a.poses : a.poses) ?? []) if (!m.has(p)) m.set(p, a);
  return m;
}

/**
 * Camera state for the TV (axes.cs): 0 off · 0.25 setting up or downloading · 0.5 calibrating ·
 * 0.75 tracking lost · 1 tracking. The TV shows "step back" hints and pauses scoring from it.
 */
function camState(cam: CamStatus, v: View | null): number {
  if (cam.phase !== "running") return cam.phase === "asking" || cam.phase === "loading" ? 0.25 : 0;
  if (!v || v.state === "need-body" || v.state === "calibrating") return 0.5;
  return v.state === "lost" ? 0.75 : 1;
}

/**
 * Camera mode on the phone: set-up (privacy, safety, seated or standing, intensity), then the camera with a
 * skeleton overlay while calibrating, then a big rep counter while playing (the preview is hidden to save
 * battery). Moves become the game's actions; lean, squat depth and tracking go out as axes.
 */
export function CameraPad({ input, spec, lastEvent, color, onFallback }: {
  input: InputSender;
  spec: ControlSpec;
  lastEvent: PadEvent | null;
  color: string;
  /** Switch this player to the next control mode (buttons): no camera, or a phone too slow for it. */
  onFallback(): void;
}) {
  const [settings, setSettings] = useState<CamSettings>(loadSettings);
  const [clear, setClear] = useState(false);
  const [cam, setCam] = useState<CamStatus>({ phase: "off", progress: 0, fps: 0, inferMs: 0, delegate: "", slow: false });
  const [view, setView] = useState<View | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [flash, setFlash] = useState<{ text: string; at: number } | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [toast, setToast] = useState<{ text: string; at: number } | null>(null);
  const [outcome, setOutcome] = useState<{ text: string; emoji?: string } | null>(null);
  const [preview, setPreview] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const runner = useRef<CameraRunner | null>(null);
  const last = useRef<PoseOutput | null>(null);
  const viewRef = useRef<View | null>(null);
  const map = useMemo(() => poseMap(spec, settings.seated), [spec, settings.seated]);
  const mapRef = useRef(map);
  mapRef.current = map;
  const main = spec.actions.find((a) => a.poses?.length);
  const pauseAction = spec.actions.find((a) => (a.poses ?? []).includes("hands-on-head"));
  const tracker = () => new PoseTracker({ seated: settings.seated, jumpRise: JUMP_RISE[settings.intensity] });

  const onFrame = (o: PoseOutput) => {
    last.current = o;
    for (const mv of o.moves) {
      const a = mapRef.current.get(mv);
      if (!a) continue;
      input.tap(a.id);
      setCounts((c) => ({ ...c, [a.id]: (c[a.id] ?? 0) + 1 }));
      try {
        navigator.vibrate?.(a.id === pauseAction?.id ? [40, 60, 40] : 25);
      } catch { /* iPhone: no vibration */ }
      const perfect = mv === "squat" && o.quality >= 0.8;
      setFlash({ text: perfect ? "PERFECT form!" : mv === "squat" && o.quality < 0.5 ? `${a.label} · sit a little deeper` : a.label, at: Date.now() });
    }
    const v = viewRef.current;
    if (!v || v.state !== o.state || v.message !== o.message || Math.abs(v.calib - o.calib) > 0.05) {
      viewRef.current = { state: o.state, message: o.message, calib: o.calib };
      setView(viewRef.current);
    }
    drawSkeleton(canvas.current, o);
  };
  const onFrameRef = useRef(onFrame);
  onFrameRef.current = onFrame;

  useEffect(() => {
    const r = new CameraRunner(video.current!, tracker(), (o) => onFrameRef.current(o), setCam);
    runner.current = r;
    const vis = () => !document.hidden && r.checkTrack();
    document.addEventListener("visibilitychange", vis);
    return () => {
      document.removeEventListener("visibilitychange", vis);
      r.dispose(); // leaving the game or switching mode turns the camera off
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (runner.current) runner.current.tracker = tracker();
  }, [settings.seated, settings.intensity]); // eslint-disable-line react-hooks/exhaustive-deps

  // axes out, 20 times a second
  useEffect(() => {
    const id = setInterval(() => {
      const o = last.current;
      const ok = cam.phase === "running" && o?.state === "ready";
      input.axes({
        x: ok ? o!.lean : 0, y: ok ? o!.depth : 0, ok: ok ? 1 : 0, m: MODE_CODE.camera / MODE_DIVISOR,
        s: settings.seated ? 1 : 0, i: INTENSITY_CODE[settings.intensity], q: o?.quality ?? 0, cs: camState(cam, viewRef.current),
      });
    }, 50);
    return () => clearInterval(id);
  }, [input, cam, settings]);

  // what the TV tells this phone
  useEffect(() => {
    if (!lastEvent) return;
    const d = lastEvent.data ?? {};
    if (lastEvent.event === "status") setStatus(d as Status);
    if (lastEvent.event === "toast") setToast({ text: String(d.text ?? ""), at: lastEvent.at });
    if (lastEvent.event === "outcome") {
      setOutcome({ text: String(d.text ?? ""), emoji: d.emoji as string | undefined });
      runner.current?.stop(); // the game is over: camera off
    }
    if (lastEvent.event === "vibrate") try { navigator.vibrate?.(Number(d.ms ?? 50)); } catch { /* unsupported */ }
  }, [lastEvent]);

  const change = (s: CamSettings) => {
    setSettings(s);
    saveSettings(s);
  };
  const start = () => void runner.current?.start();
  const live = cam.phase === "asking" || cam.phase === "loading" || cam.phase === "running";
  const playing = cam.phase === "running" && view?.state !== "need-body" && view?.state !== "calibrating";
  const showVideo = live && (!playing || preview);
  const fresh = (x: { at: number } | null, ms: number) => !!x && Date.now() - x.at < ms;
  const line = fresh(flash, 900) ? flash!.text : fresh(toast, 2500) ? toast!.text : "";
  const reps = main ? counts[main.id] ?? 0 : 0;
  const repWord = settings.seated ? "arm raises" : main?.poses?.[0] === "squat" ? "squats" : "moves";

  let panel: React.ReactNode;
  if (outcome) {
    panel = <div className="pad-panel calib" style={{ borderColor: color }}><span style={{ fontSize: 64 }}>{outcome.emoji ?? "🏁"}</span><b>{outcome.text}</b><span className="cam-small">Camera is off.</span></div>;
  } else if (cam.phase === "off") {
    panel = <CameraSetup title={spec.title} settings={settings} onChange={change} clear={clear} onClear={() => setClear((c) => !c)} onStart={start} onFallback={onFallback} />;
  } else if (cam.phase === "error" || cam.phase === "stopped") {
    panel = (
      <div className="pad-panel cam-center" style={{ borderColor: color }}>
        <span style={{ fontSize: 48 }}>{cam.phase === "error" ? "🚫" : "📷"}</span>
        <b>{cam.phase === "error" ? cam.error : "Camera is off."}</b>
        <button type="button" className="btn cam-start" onClick={start}>{cam.phase === "error" ? "Try again" : "Tap to resume the camera"}</button>
        <button type="button" className="link-btn" onClick={onFallback}>🎮 Play with buttons instead</button>
      </div>
    );
  } else if (!playing) {
    panel = (
      <div className="cam-side">
        {cam.phase === "asking" && <b>Allow the camera when your phone asks.</b>}
        {cam.phase === "loading" && (
          <>
            <b>Getting body tracking ready…</b>
            <div className="mini" aria-label="Download progress"><div style={{ width: `${Math.round(cam.progress * 100)}%`, background: color }} /></div>
            <span className="cam-small">{Math.round(cam.progress * 100)}% · about 17 MB, once per phone</span>
          </>
        )}
        {cam.phase === "running" && (
          <>
            <b className="cam-msg">{view?.message || "Step back until your whole body fits"}</b>
            <div className="cam-ring" style={{ background: `conic-gradient(${color} ${Math.round((view?.calib ?? 0) * 360)}deg, rgba(255,255,255,0.12) 0)` }}><span>{Math.round((view?.calib ?? 0) * 100)}%</span></div>
            <span className="cam-small">{settings.seated ? "Sit so your head, arms and hips fit in the outline" : "Stand inside the outline, arms down, feet in view"}</span>
          </>
        )}
      </div>
    );
  } else {
    const lost = view?.state === "lost";
    panel = (
      <div className="cam-play" style={{ borderColor: color }}>
        <div className="cam-count" aria-live="polite"><b data-reps={reps}>{reps}</b><span>{repWord}</span></div>
        <div className="cam-mid">
          <span className={`cam-track ${lost ? "bad" : "ok"}`}>{lost ? `⚠️ ${view?.message}` : "✓ Tracking you"}</span>
          {status?.text && <span className="pad-status">{status.text}</span>}
          {status?.bars?.map((b) => (
            <span key={b.label} className="pad-bar"><span>{b.label}</span><span className="mini"><span style={{ width: `${Math.round(b.value * 100)}%`, background: b.color ?? color }} /></span></span>
          ))}
          <span className={`pad-flash ${line ? "on" : ""}`}>{line}</span>
          {cam.slow && <button type="button" className="link-btn" onClick={onFallback}>This phone is struggling: play with buttons instead</button>}
        </div>
        {pauseAction && <button type="button" className="cam-pause" onClick={() => input.tap(pauseAction.id)}>⏸<span>Pause</span></button>}
      </div>
    );
  }

  return (
    <div className="cam-pad" data-cam={cam.phase} data-track={view?.state ?? ""} data-fps={cam.fps} data-infer={cam.inferMs.toFixed(1)} data-delegate={cam.delegate}>
      {live && (
        <div className="cam-bar">
          <span className="cam-on"><i />Camera on · video stays on this phone</span>
          {playing && <button type="button" className="chip" onClick={() => setPreview((p) => !p)}>{preview ? "Hide me" : "Show me"}</button>}
          {playing && <button type="button" className="chip" onClick={() => runner.current?.tracker.recalibrate()}>⟳ Re-calibrate</button>}
          <button type="button" className="chip" onClick={() => runner.current?.stop()}>⏹ Stop camera</button>
        </div>
      )}
      <div className={`cam-main ${showVideo ? "with-video" : ""}`}>
        <div className={`cam-video ${showVideo ? "" : "hidden"}`}>
          <video ref={video} playsInline muted autoPlay aria-label="Your camera (stays on this phone)" />
          <canvas ref={canvas} width={320} height={240} aria-hidden />
          {showVideo && !playing && <Silhouette seated={settings.seated} />}
        </div>
        {panel}
      </div>
    </div>
  );
}

/** Body outline to stand inside while calibrating. */
function Silhouette({ seated }: { seated: boolean }) {
  return (
    <svg className="cam-silhouette" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet" aria-hidden>
      <circle cx="50" cy={seated ? 30 : 13} r="6" />
      {seated
        ? <path d="M38 40 Q50 36 62 40 L66 66 L60 66 L58 80 L42 80 L40 66 L34 66 Z" />
        : <path d="M38 22 Q50 18 62 22 L66 50 L61 50 L59 92 L53 92 L50 58 L47 92 L41 92 L39 50 L34 50 Z" />}
    </svg>
  );
}

/** The skeleton over the (mirrored) preview, so the player sees what the phone sees. Lines only, never pixels. */
function drawSkeleton(c: HTMLCanvasElement | null, o: PoseOutput) {
  if (!c || c.offsetParent === null) return;
  const g = c.getContext("2d");
  if (!g) return;
  g.clearRect(0, 0, c.width, c.height);
  const p = o.points;
  if (!p) return;
  const idx = (i: number) => [0, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28].indexOf(i);
  g.lineWidth = 4;
  g.lineCap = "round";
  for (const [a, b] of BONES) {
    const pa = p[idx(a)]!, pb = p[idx(b)]!;
    g.strokeStyle = pa.v && pb.v ? (o.state === "ready" ? "#3ee08f" : "#ffd23f") : "rgba(255,93,115,0.6)";
    g.beginPath();
    g.moveTo(pa.x * c.width, pa.y * c.height);
    g.lineTo(pb.x * c.width, pb.y * c.height);
    g.stroke();
  }
  g.fillStyle = "#fff";
  for (const q of p) if (q.v) g.fillRect(q.x * c.width - 3, q.y * c.height - 3, 6, 6);
}
