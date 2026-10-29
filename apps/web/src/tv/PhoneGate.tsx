import { useState, type ReactNode } from "react";
import { screenForm } from "../device";

const KEY = "pwtv.phoneAsTv";

/** Steps shown wherever a phone lands on a TV-side page: the TV shows the game, the phone is the controller. */
export function HowToPlay() {
  return (
    <ol className="how-to">
      <li>On your <b>TV or laptop</b>, open <b>{location.host}</b> and choose <b>This is the TV</b>.</li>
      <li>A code and a QR appear on the big screen. <b>Scan it</b> with this phone's camera (or tap Join and type the code).</li>
      <li>Pick a game on the TV. This phone becomes your controller.</li>
    </ol>
  );
}

/** The home page on a phone: joining is what a phone is for, so it comes first and full width. */
export function PhoneHome() {
  return (
    <div className="phone phone-home">
      <img src="/icons/icon-192.png" alt="" width={84} height={84} style={{ borderRadius: 20, alignSelf: "center" }} />
      <h1 style={{ textAlign: "center" }}>Play With TV</h1>
      <p className="hint" style={{ margin: 0, textAlign: "center" }}>Party games on your TV. Phones are the controllers. No app, no account.</p>
      <a className="btn" href="/join" data-testid="phone-join">🎮 Join a game on a TV</a>
      <HowToPlay />
      <a className="link-quiet" href="/tv">Use this phone as the screen instead</a>
      <p className="credit">Play With TV · by <b>Leadup Technologies</b></p>
    </div>
  );
}

/**
 * The TV page opened on a phone is almost always someone who tapped the wrong button: it shows a lobby too small to
 * read and opens a room nobody can join. Explain and offer the controller instead, before any room is created.
 */
export function PhoneGate({ children }: { children: ReactNode }) {
  const [anyway, setAnyway] = useState(() => {
    try {
      return screenForm() !== "phone" || sessionStorage.getItem(KEY) === "1";
    } catch {
      return true;
    }
  });
  if (anyway) return <>{children}</>;
  return (
    <div className="phone phone-home" role="dialog" aria-label="This is a phone">
      <h1>📱 This is the phone</h1>
      <p className="hint" style={{ margin: 0 }}>The game shows on a big screen and your phone is the controller.</p>
      <a className="btn" href="/join">🎮 Join a TV with this phone</a>
      <HowToPlay />
      <button
        type="button"
        className="link-quiet"
        onClick={() => {
          try {
            sessionStorage.setItem(KEY, "1");
          } catch { /* storage blocked: still let them through */ }
          setAnyway(true);
        }}
      >
        Use this phone as the screen anyway
      </button>
    </div>
  );
}
