import type { CSSProperties } from "react";
import { RECIPES, type RecipeId } from "./recipes";
import type { LevelResult, Phase } from "./engine";
import type { SpriteManifest } from "../kit25d/manifest";
import { BASE } from "./view/assets";

export interface HudTicket { id: number; recipe: RecipeId; left: number; limit: number }
export interface HudState {
  phase: Phase;
  level: number;
  levelName: string;
  subtitle: string;
  timeLeft: number;
  points: number;
  team: number;
  thresholds: [number, number, number];
  tickets: HudTicket[];
  banner: { text: string; tone: "warn" | "dark" | "info" } | null;
  result: LevelResult | null;
  menu: RecipeId[];
}

const CSS = `
.tt-hud{position:absolute;inset:0;pointer-events:none;font-family:"Baloo 2",system-ui,sans-serif;color:#fff}
.tt-rail{position:absolute;left:28px;top:18px;display:flex;gap:14px;align-items:flex-start}
.tt-rail::before{content:"";position:absolute;left:-10px;right:-10px;top:-6px;height:10px;border-radius:5px;background:linear-gradient(#e6b65a,#9b6a22);box-shadow:0 3px 6px rgba(0,0,0,.4)}
.tt-ticket{position:relative;width:176px;background:#fbf3dc;border-radius:6px 6px 14px 14px;padding:8px 8px 10px;color:#2a1a12;
  box-shadow:0 8px 16px rgba(0,0,0,.45);transform-origin:50% -8px;animation:tt-in .55s cubic-bezier(.2,1.6,.4,1) both}
.tt-ticket::before{content:"";position:absolute;left:50%;top:-12px;width:22px;height:16px;margin-left:-11px;border-radius:4px;background:#c98a2c;box-shadow:0 2px 0 #7a4f12}
.tt-ticket.urgent{animation:tt-in .55s cubic-bezier(.2,1.6,.4,1) both, tt-wobble .5s ease-in-out infinite}
.tt-ticket b{display:block;font-size:22px;line-height:1.05;text-align:center;font-weight:800;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.tt-icons{display:flex;justify-content:center;gap:2px;height:62px;align-items:center;margin:2px 0 4px}
.tt-icon{width:72px;height:52px;background-repeat:no-repeat;filter:drop-shadow(0 2px 2px rgba(0,0,0,.25))}
.tt-bar{height:12px;border-radius:6px;background:#d9cbb0;overflow:hidden}
.tt-bar>i{display:block;height:100%;border-radius:6px;transition:width .2s linear}
.tt-score{position:absolute;right:30px;top:18px;width:330px;background:rgba(20,12,34,.82);border:4px solid #f0b632;border-radius:22px;padding:10px 18px 14px;box-shadow:0 8px 18px rgba(0,0,0,.45)}
.tt-score .row{display:flex;justify-content:space-between;align-items:baseline}
.tt-score .pts{font-size:58px;font-weight:900;line-height:1;color:#ffd23f;text-shadow:0 3px 0 #7a3b00}
.tt-score .clock{font-size:40px;font-weight:800}
.tt-score .clock.low{color:#ff6b6b;animation:tt-pulse .5s ease-in-out infinite alternate}
.tt-stars{position:relative;height:16px;margin-top:22px;border-radius:8px;background:rgba(255,255,255,.15)}
.tt-stars>i{position:absolute;left:0;top:0;bottom:0;border-radius:8px;background:linear-gradient(90deg,#ffb43a,#ffe066)}
.tt-stars>span{position:absolute;top:-24px;font-size:28px;transform:translateX(-50%);filter:grayscale(1) brightness(.6)}
.tt-stars>span.on{filter:none;animation:tt-pop .5s cubic-bezier(.2,1.8,.4,1)}
.tt-banner{position:absolute;left:50%;top:210px;transform:translateX(-50%);padding:12px 36px;border-radius:999px;font-size:44px;font-weight:900;white-space:nowrap;
  box-shadow:0 8px 20px rgba(0,0,0,.5);animation:tt-in .5s cubic-bezier(.2,1.6,.4,1) both}
.tt-banner.warn{background:#ffcf33;color:#3a1d00;animation:tt-in .5s both, tt-shake .35s ease-in-out infinite}
.tt-banner.dark{background:#1b1640;color:#cfd6ff;border:3px solid #6f74ff}
.tt-banner.info{background:#8a1f2a;color:#fff3d6;border:4px solid #f0b632}
.tt-card{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);min-width:860px;text-align:center;background:linear-gradient(#8a1f2a,#5c1018);
  border:6px solid #f0b632;border-radius:34px;padding:30px 50px 36px;box-shadow:0 20px 50px rgba(0,0,0,.6);animation:tt-in .6s cubic-bezier(.2,1.5,.4,1) both}
.tt-card h1{margin:0;font-size:92px;line-height:1;color:#ffd23f;-webkit-text-stroke:4px #3a0d12;paint-order:stroke fill}
.tt-card h2{margin:6px 0 0;font-size:44px;color:#fff3d6}
.tt-card p{margin:10px 0 0;font-size:32px;color:#ffe9c0}
.tt-card .menu{display:flex;justify-content:center;gap:10px;margin-top:18px}
.tt-card .menu .tt-icon{width:92px;height:67px;background-color:#fbf3dc;border-radius:16px}
.tt-big-stars{font-size:110px;letter-spacing:10px;margin-top:6px}
.tt-big-stars span{display:inline-block;animation:tt-pop .6s cubic-bezier(.2,1.8,.4,1) both}
.tt-big-stars span.off{filter:grayscale(1) brightness(.45)}
@keyframes tt-in{from{transform:translateY(-40px) scale(.3);opacity:0}to{opacity:1}}
@keyframes tt-wobble{0%,100%{rotate:-3deg}50%{rotate:3deg}}
@keyframes tt-pulse{to{transform:scale(1.12)}}
@keyframes tt-pop{0%{transform:scale(.2)}70%{transform:scale(1.3)}100%{transform:scale(1)}}
@keyframes tt-shake{0%,100%{translate:0}25%{translate:-6px}75%{translate:6px}}
`;

/** CSS for one item from the food sprite atlas (real rendered food on the tickets). */
export function foodIcon(food: SpriteManifest & { names?: string[] }, name: string, boxW: number, boxH: number): CSSProperties {
  const i = food.names?.indexOf(name) ?? -1;
  const r = food.frames[i];
  if (!r) return {};
  const k = Math.min(boxW / r.w, boxH / r.h);
  return {
    backgroundImage: `url(${BASE}/${food.image})`,
    backgroundSize: `${food.size.w * k}px ${food.size.h * k}px`,
    backgroundPosition: `${-r.x * k + (boxW - r.w * k) / 2}px ${-r.y * k + (boxH - r.h * k) / 2}px`,
  };
}

function iconsOf(id: RecipeId): string[] {
  return id === "coffee" ? ["coffee"] : RECIPES[id].parts;
}

export function Hud({ s, food }: { s: HudState; food: (SpriteManifest & { names?: string[] }) | null }) {
  const mm = Math.floor(Math.max(0, s.timeLeft) / 60), ss = Math.floor(Math.max(0, s.timeLeft) % 60);
  const top = s.thresholds[2] * 1.15;
  const pct = (v: number) => `${Math.min(100, (v / top) * 100)}%`;
  const icon = (n: string, w: number, h: number) => (food ? <div key={n} className="tt-icon" style={{ ...foodIcon(food, n, w, h), width: w, height: h }} /> : <span key={n}>{n}</span>);
  return (
    <div className="tt-hud">
      <style>{CSS}</style>
      {(s.phase === "service" || s.phase === "countdown") && (
        <>
          <div className="tt-rail" data-tickets={s.tickets.length}>
            {s.tickets.map((t) => {
              const f = t.left / t.limit;
              return (
                <div key={t.id} className={`tt-ticket ${f < 0.25 ? "urgent" : ""}`} data-ticket={t.recipe}>
                  <b>{RECIPES[t.recipe].name}</b>
                  <div className="tt-icons">{iconsOf(t.recipe).map((n) => icon(n, iconsOf(t.recipe).length > 2 ? 52 : 72, 52))}</div>
                  <div className="tt-bar"><i style={{ width: `${f * 100}%`, background: f > 0.5 ? "#4cc95a" : f > 0.25 ? "#ffc12e" : "#ff4b3a" }} /></div>
                </div>
              );
            })}
          </div>
          <div className="tt-score">
            <div className="row">
              <span className="pts" data-score={s.points}>🪙 {s.points}</span>
              <span className={`clock ${s.timeLeft < 15 ? "low" : ""}`}>⏱ {mm}:{String(ss).padStart(2, "0")}</span>
            </div>
            <div className="tt-stars">
              <i style={{ width: pct(s.points) }} />
              {s.thresholds.map((t, i) => <span key={i} className={s.points >= t ? "on" : ""} style={{ left: pct(t) }}>⭐</span>)}
            </div>
          </div>
        </>
      )}
      {s.banner && s.phase === "service" && <div key={s.banner.text} className={`tt-banner ${s.banner.tone}`}>{s.banner.text}</div>}
      {s.phase === "intro" && (
        <div className="tt-card" data-card="intro">
          <p style={{ marginTop: 0 }}>🚂 TIFFIN TORNADO EXPRESS</p>
          <h1>Service {s.level + 1}</h1>
          <h2>{s.levelName}</h2>
          <p>{s.subtitle}</p>
          <div className="menu">{s.menu.map((r) => <div key={r} style={{ display: "flex", gap: 2 }}>{iconsOf(r).map((n) => icon(n, 92, 67))}</div>).slice(0, 7)}</div>
        </div>
      )}
      {s.phase === "levelEnd" && s.result && (
        <div className="tt-card" data-card="level-end">
          <h2 style={{ marginTop: 0 }}>Service {s.level + 1} done!</h2>
          <div className="tt-big-stars">
            {[0, 1, 2].map((i) => <span key={i} className={i < s.result!.stars ? "" : "off"} style={{ animationDelay: `${0.3 + i * 0.35}s` }}>⭐</span>)}
          </div>
          <h1>🪙 {s.result.points}</h1>
          <p>{s.result.served} served · {s.result.expired} missed · team total {s.team}</p>
        </div>
      )}
    </div>
  );
}
