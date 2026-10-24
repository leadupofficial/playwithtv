import { useEffect } from "react";
import { Link } from "react-router-dom";
import { installSpatialNav } from "../tv/spatialNav";
import "./quality.css";

/**
 * /tv/hosting: how to get "power-host mode": a laptop or PC renders the games at the high or ultra tier and the
 * TV only shows the picture (Chrome tab casting or an HDMI cable). Phones join exactly as before.
 */
export function HostingHelp() {
  useEffect(() => installSpatialNav(), []);
  return (
    <div className="tv">
      <div className="center-screen">
        <div className="hosting">
          <h1 className="big-title">Console-quality graphics</h1>
          <p className="hint">Your TV is great at showing pictures but slow at drawing 3D. Let a laptop draw the game and the TV just shows it.</p>
          <div className="hosting-ways">
            <div className="panel">
              <div className="section-title">Cast (no cable)</div>
              <ol>
                <li>On a laptop or PC on the same Wi-Fi, open <strong>{location.host}/tv</strong> in Chrome.</li>
                <li>Chrome menu <strong>⋮ → Cast, save and share → Cast…</strong></li>
                <li>Pick your TV, choose <strong>Sources → Cast tab</strong>.</li>
                <li>Press <strong>F11</strong> for full screen. Phones scan the code as usual.</li>
              </ol>
            </div>
            <div className="panel">
              <div className="section-title">HDMI cable (sharpest)</div>
              <ol>
                <li>Plug the laptop into the TV with an HDMI cable and pick that input on the TV.</li>
                <li>Open <strong>{location.host}/tv</strong> in Chrome, full screen (<strong>F11</strong>).</li>
                <li>Graphics switch to <strong>High</strong> or <strong>Ultra</strong> by themselves.</li>
              </ol>
            </div>
          </div>
          <p className="hint">Casting adds a little delay to the picture; HDMI adds none. Your choice is remembered on each device.</p>
          <div className="row" style={{ justifyContent: "center" }}>
            <Link className="btn" to="/tv" data-nav autoFocus>Back to the games</Link>
            <Link className="btn secondary" to="/tv/showroom" data-nav>Compare in the showroom</Link>
          </div>
        </div>
      </div>
    </div>
  );
}
