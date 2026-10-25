import type { CSSProperties } from "react";
import { RECIPES, type RecipeId } from "./recipes";
import type { LevelResult, Phase } from "./engine";
import type { SpriteManifest } from "../kit25d/manifest";
import { BASE } from "./view/assets";
import "./hud.css";

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

/** CSS for one item from the food sprite atlas (real rendered food on the tickets). */
export function foodIcon(food: SpriteManifest & { names?: string[] }, name: string, boxW: number, boxH: number): CSSProperties {
  const i = food.names?.indexOf(name) ?? -1;
  const r = food.frames[i];
  if (!r) return {};
  const k = Math.min(boxW / r.w, boxH / r.h) * 1.7; // the cells have room for shadows: zoom onto the food
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
