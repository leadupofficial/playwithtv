import { useEffect, useRef, useState } from "react";
import type { Gesture, MotionFrame } from "@scp/motion";
import { PhoneMotion, motionSupported, requestMotionPermission, savedSensitivity } from "./motion";

/**
 * /sensors: what this phone's motion sensors report, live. Used to check a phone before playing, to tune
 * sensitivity, and to record real traces for the motion SDK's test fixtures (packages/motion/test/fixtures).
 */
export function SensorLab() {
  const motion = useRef(new PhoneMotion());
  const [state, setState] = useState<"idle" | "on" | "denied" | "unsupported">("idle");
  const [frame, setFrame] = useState<MotionFrame | null>(null);
  const [log, setLog] = useState<Gesture[]>([]);
  const [sens, setSens] = useState(savedSensitivity);
  const [recording, setRecording] = useState(false);
  const [note, setNote] = useState("");

  useEffect(() => {
    const m = motion.current;
    const off = m.onGesture((g) => setLog((l) => [g, ...l].slice(0, 12)));
    const id = setInterval(() => m.active && setFrame(m.frame()), 100);
    return () => {
      off();
      clearInterval(id);
      m.stop();
    };
  }, []);

  async function start() {
    if (!motionSupported()) return setState("unsupported");
    if (!(await requestMotionPermission())) return setState("denied");
    motion.current.start();
    setState("on");
  }

  function record() {
    const m = motion.current;
    m.startRecording();
    setRecording(true);
    setTimeout(() => {
      const trace = m.stopRecording(`${note || "unlabelled"} · ${navigator.userAgent}`);
      setRecording(false);
      const url = URL.createObjectURL(new Blob([JSON.stringify(trace)], { type: "application/json" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `motion-trace-${Date.now()}.json`;
      a.click();
      URL.revokeObjectURL(url);
    }, 10_000);
  }

  const n = (x: number | undefined, d = 2) => (x === undefined ? "–" : x.toFixed(d));
  return (
    <div className="phone sensor-lab">
      <h1>Sensor lab</h1>
      {state === "idle" && <button className="btn" onClick={() => void start()}>Start motion sensors</button>}
      {state === "unsupported" && <div className="notice">This browser can't read motion sensors here. Use Chrome (Android) or Safari (iPhone) on an https link.</div>}
      {state === "denied" && <div className="notice">Motion access was blocked. iPhone: Settings → Safari → Motion &amp; Orientation Access.</div>}
      {state === "on" && (
        <>
          <table className="lab-table"><tbody>
            <tr><th>Roll (steer)</th><td>{n(frame?.roll)}</td><td>{n(frame?.rollDeg, 0)}°</td></tr>
            <tr><th>Pitch (tip)</th><td>{n(frame?.pitch)}</td><td>{n(frame?.pitchDeg, 0)}°</td></tr>
            <tr><th>Yaw (turn rate)</th><td>{n(frame?.yaw)}</td><td /></tr>
            <tr><th>Samples / s</th><td>{frame?.health.rateHz ?? "–"}</td><td>{frame?.health.stale ? "⚠ stale" : "live"}</td></tr>
            <tr><th>Gyroscope</th><td>{frame?.health.hasRotation ? "yes" : "no"}</td><td>{frame?.health.hasLinear ? "linear accel: yes" : "linear accel: no"}</td></tr>
            <tr><th>Holding still</th><td>{frame?.still ? "yes" : "no"}</td><td /></tr>
          </tbody></table>
          <div className="row">
            <button className="btn secondary" onClick={() => motion.current.calibrate()}>Set neutral here</button>
          </div>
          <label className="sens">Sensitivity {sens.toFixed(1)}
            <input type="range" min={0.5} max={2} step={0.1} value={sens} onChange={(e) => {
              const v = Number(e.target.value);
              setSens(v);
              motion.current.setSensitivity(v);
            }} />
          </label>
          <h2>Gestures</h2>
          <ol className="lab-log">{log.map((g, i) => <li key={i}>{g.kind} · strength {g.strength.toFixed(2)}</li>)}</ol>
          <h2>Record a test trace</h2>
          <input className="input" placeholder="What you'll do, e.g. 'three pushes, phone upright'" value={note} onChange={(e) => setNote(e.target.value)} />
          <button className="btn" disabled={recording} onClick={record}>{recording ? "Recording 10 s…" : "Record 10 seconds"}</button>
          <p className="hint">Only motion readings are recorded: no camera, microphone or location.</p>
        </>
      )}
    </div>
  );
}
