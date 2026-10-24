/** Before the camera turns on: what happens to the video, safety, standing or seated, and how hard to go. */
export type Intensity = "gentle" | "normal" | "sweaty";
export interface CamSettings { seated: boolean; intensity: Intensity }

const KEY = "pwtv.camera";
export const PRIVACY = "Your camera video never leaves this phone. Only moves like 'squat' or 'jump' are sent to the TV. Nothing is recorded or uploaded.";

export function loadSettings(): CamSettings {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<CamSettings>;
    return { seated: !!s.seated, intensity: s.intensity === "gentle" || s.intensity === "sweaty" ? s.intensity : "normal" };
  } catch {
    return { seated: false, intensity: "normal" };
  }
}
export function saveSettings(s: CamSettings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* private mode */
  }
}

/** Jump threshold per intensity (body heights): gentle players only need a small hop. */
export const JUMP_RISE: Record<Intensity, number> = { gentle: 0.07, normal: 0.1, sweaty: 0.12 };
export const INTENSITY_CODE: Record<Intensity, number> = { gentle: 0, normal: 0.5, sweaty: 1 };

export function CameraSetup({ settings, onChange, clear, onClear, onStart, onFallback, title }: {
  settings: CamSettings;
  onChange(s: CamSettings): void;
  clear: boolean;
  onClear(): void;
  onStart(): void;
  onFallback(): void;
  title: string;
}) {
  const opt = <K extends keyof CamSettings>(k: K, v: CamSettings[K], label: string) => (
    <button type="button" className={`cam-opt ${settings[k] === v ? "on" : ""}`} aria-pressed={settings[k] === v} onClick={() => onChange({ ...settings, [k]: v })}>{label}</button>
  );
  return (
    <div className="cam-setup">
      <div className="cam-col">
        <h2>📷 {title}: camera play</h2>
        <p className="cam-privacy" role="note">🔒 {PRIVACY}</p>
        <p className="cam-disclaimer">
          Move at your own pace and stop if anything hurts or you feel dizzy. Skip it if a doctor has told you not to
          exercise. Children play with a grown-up nearby.
        </p>
        <button type="button" className="link-btn" onClick={onFallback}>🎮 Play with buttons instead</button>
      </div>
      <div className="cam-col">
        <div className="cam-row" role="group" aria-label="How you play">{opt("seated", false, "🧍 Standing")}{opt("seated", true, "🪑 Seated")}</div>
        <div className="cam-row" role="group" aria-label="Intensity">
          {opt("intensity", "gentle", "🌱 Gentle")}{opt("intensity", "normal", "💪 Normal")}{opt("intensity", "sweaty", "🔥 Sweaty")}
        </div>
        <p className="cam-tip">Prop this phone up sideways at hip height, 2–3 m away, screen facing you.</p>
        <button type="button" className={`cam-clear ${clear ? "on" : ""}`} aria-pressed={clear} onClick={onClear}>
          {clear ? "✓ Space is clear" : "⬜ I've cleared the space around me (no furniture, pets or people within reach)"}
        </button>
        <button type="button" className="btn cam-start" disabled={!clear} onClick={onStart}>📷 Turn on camera</button>
      </div>
    </div>
  );
}
