import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Link, Route, Routes } from "react-router-dom";
import "./styles.css";
import { TvApp } from "./tv/TvApp";
import { JoinApp } from "./phone/JoinApp";
import { AdminApp } from "./admin/AdminApp";
import { Stage } from "./tv/Stage";
import { SensorLab } from "./phone/SensorLab";
import "./install"; // catches the browser's one-time install event as early as possible

function Home() {
  return (
    <div className="tv">
      <div className="center-screen">
        <div style={{ display: "flex", flexDirection: "column", gap: "1.2em", alignItems: "center" }}>
          <h1 className="big-title">Scan · Connect · Play</h1>
          <p className="hint">Open this page on the TV, then scan the code with your phone. No app needed.</p>
          <div className="row">
            <Link className="btn" to="/tv" autoFocus>This is the TV</Link>
            <Link className="btn secondary" to="/join">Join with my phone</Link>
          </div>
        </div>
      </div>
    </div>
  );
}

// Installable app + instant repeat visits (production only: the dev server must never be cached).
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => void navigator.serviceWorker.register("/sw.js").catch(() => undefined));
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Stage><Home /></Stage>} />
        <Route path="/tv" element={<Stage><TvApp /></Stage>} />
        <Route path="/play" element={<Stage><TvApp /></Stage>} />
        <Route path="/join" element={<JoinApp />} />
        <Route path="/controller" element={<JoinApp />} />
        <Route path="/admin" element={<AdminApp />} />
        <Route path="/sensors" element={<SensorLab />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
);
