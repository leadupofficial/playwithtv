/** CITY RIVALS heads-up display: per view (place, lap, gate arrow, speed, boost), the garage, countdown, a city map, results. */
import type { HudState, RiderHud } from "./session";
import { EXTENT } from "./district";
import { KINDS, STATS } from "./car";

const ORD = (n: number) => `${n}${n === 1 ? "ST" : n === 2 ? "ND" : n === 3 ? "RD" : "TH"}`;
const LEVEL = ["", "#41b8ff", "#ff9a1f", "#d04bff"];
const ICON: Record<string, string> = { auto: "🛺", scooter: "🛵", car: "🚗" };
const time = (ms: number) => `${Math.floor(ms / 60000)}:${((ms % 60000) / 1000).toFixed(1).padStart(4, "0")}`;

function Bars({ k }: { k: (typeof KINDS)[number] }) {
  const s = STATS[k];
  const row = (label: string, v: number) => (
    <div className="cr-stat"><span>{label}</span><i><b style={{ width: `${Math.round(v * 100)}%` }} /></i></div>
  );
  return <>{row("Speed", s.vmax / 40)}{row("Grip", s.grip / 9)}{row("Turn", s.turn / 3.2)}</>;
}

function Garage({ s }: { s: HudState }) {
  const humans = s.riders.filter((r) => !r.cpu);
  return (
    <div className="cr-garage">
      <h1>CITY RIVALS</h1>
      <p className="cr-sub">Steer to pick your ride · BOOST to lock it in</p>
      <div className="cr-picks">
        {humans.map((r) => (
          <div key={r.id} className={`cr-pick${r.locked ? " locked" : ""}`} style={{ borderColor: r.color }}>
            <div className="cr-who" style={{ color: r.color }}>{r.name}</div>
            <div className="cr-ride">
              {KINDS.map((k, i) => <span key={k} className={i === r.pick ? "on" : ""}>{ICON[k]}</span>)}
            </div>
            <div className="cr-kind">{STATS[KINDS[r.pick]!].label}</div>
            <Bars k={KINDS[r.pick]!} />
            <div className="cr-lock">{r.locked ? "✔ LOCKED IN" : "◀ ▶ · BOOST"}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Map({ s, me }: { s: HudState; me: string | null }) {
  const P = (v: number) => `${((v + 12) / (EXTENT + 24)) * 100}%`;
  const rider = s.riders.find((r) => r.id === me);
  const next = rider ? s.gates[rider.next] : null;
  const mine = rider ? s.coinsOn[s.riders.indexOf(rider)] : null;
  return (
    <div className="cr-map">
      {s.coins.map((c, i) => (mine ? mine[i] : true) && <i key={i} className="cr-coin" style={{ left: P(c.x), top: P(c.z) }} />)}
      {s.gates.map((g, i) => <b key={i} className={`cr-gate${next === g ? " next" : ""}`} style={{ left: P(g.x), top: P(g.z) }}>{i === 0 ? "🏁" : i}</b>)}
      {s.riders.map((r) => (
        <em key={r.id} className={r.id === me ? "me" : ""} style={{ left: P(r.x), top: P(r.z), background: r.color, transform: `translate(-50%,-50%) rotate(${-r.yaw}rad)` }} />
      ))}
    </div>
  );
}

function View({ s, r, rect }: { s: HudState; r: RiderHud; rect: HudState["views"][number]["rect"] }) {
  const small = rect.h < 0.6;
  const msgs = s.msgs[r.id] ?? [];
  return (
    <div className={`cr-view${small ? " small" : ""}`} style={{ left: `${rect.x * 100}%`, top: `${rect.y * 100}%`, width: `${rect.w * 100}%`, height: `${rect.h * 100}%` }}>
      <div className="cr-tag" style={{ background: r.color }}>{r.name}</div>
      <div className="cr-place"><b>{ORD(r.place)}</b><span>/{s.riders.length}</span></div>
      <div className="cr-lap">LAP {r.lap}/{r.laps} · GATE {r.gate}/{r.gates}</div>
      {s.phase === "race" && !r.done && (
        <div className="cr-arrow" style={{ transform: `rotate(${-r.bearing}rad)`, color: r.color }}>➤</div>
      )}
      <div className="cr-speed">
        <b>{r.kmh}</b><span>km/h</span>
        <div className="cr-meter"><i style={{ width: `${Math.round(r.meter * 100)}%` }} className={r.boostReady ? "ready" : ""} /></div>
        {r.drift > 0 && <div className="cr-drift" style={{ background: LEVEL[r.drift] }}>DRIFT {"●".repeat(r.drift)}</div>}
      </div>
      <div className="cr-msgs">{msgs.map((m) => <div key={m.key} className={`cr-msg ${m.tone}`}>{m.text}</div>)}</div>
      {r.done && s.phase === "race" && <div className="cr-done">🏁 {ORD(r.place)}</div>}
    </div>
  );
}

export function Hud({ s }: { s: HudState }) {
  if (s.phase === "garage") return <Garage s={s} />;
  if (s.phase === "results") {
    return (
      <div className="cr-results">
        <h1>🏆 CITY RIVALS</h1>
        <ol>
          {s.order.map((o, i) => (
            <li key={o.id} style={{ borderColor: o.color }}>
              <b>{ORD(i + 1)}</b><span style={{ color: o.color }}>{o.name}</span>
              <em>{o.ms !== null ? time(o.ms) : "DNF"}</em><small>🪙 {o.coins}{o.best ? ` · best lap ${time(o.best)}` : ""}</small>
            </li>
          ))}
        </ol>
        {s.best && <p className="cr-sub">Fastest lap: {s.best.name} · {time(s.best.ms)}</p>}
      </div>
    );
  }
  const views = s.views.filter((v) => v.rider);
  return (
    <div className="cr-hud">
      {s.phase === "intro" && <div className="cr-intro"><h1>CITY RIVALS</h1><p>Checkpoint Rush · any route you like · follow the beacon</p></div>}
      {(s.phase === "race" || s.phase === "countdown") && views.map((v) => {
        const r = s.riders.find((x) => x.id === v.rider)!;
        return <View key={r.id} s={s} r={r} rect={v.rect} />;
      })}
      {(s.phase === "race" || s.phase === "countdown") && <Map s={s} me={views.length === 1 ? views[0]!.rider : null} />}
      {s.phase === "countdown" && s.count > 0 && <div className="cr-count" key={s.count}>{s.count}</div>}
      {s.phase === "race" && s.clock < 1.2 && <div className="cr-count go">GO!</div>}
      {s.phase === "race" && <div className="cr-clock">{time(Math.round(s.clock * 1000))}</div>}
    </div>
  );
}
