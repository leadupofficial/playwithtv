/**
 * CITY RIVALS session (TV side): phones → inputs → the event (fixed 60 Hz steps) → the 3D view, the HUD, sounds,
 * phone buzzes and status lines. Up to four people; CPUs fill the field to four.
 */
import type { PlayerView } from "@playwithtv/protocol";
import type { QualityProfile } from "../../quality/tier";
import type { ControlPlayers } from "../controlKit";
import type { GameBridge } from "../types";
import { GhatControls } from "../ghat/controls";
import { GhatAudio } from "../ghat/audio";
import { splitLayout, type Layout } from "../ghat/layout";
import { CONTROLS, pickEdge, type PickEdge } from "./controls";
import { BOOST_COST, driftLevel, speedOf, type CarInput } from "./car";
import { cpuDrive, newBrain, type CpuBrain } from "./cpu";
import { SPACING } from "./district";
import { DT, FULL, QUICK, garage, gateBearing, newEvent, placeOf, results, standings, step, totalGates, type CityEvent, type EventEvent } from "./event";
import { CityView, type ViewSlot } from "./view";
import { KINDS, STATS } from "./car";

const CPU_CREW: Array<[string, string]> = [["Rapid Rani", "#ff9f1c"], ["Auto Anna", "#2ec4b6"], ["Signal Selvi", "#b5179e"], ["Flyover Faiz", "#7bd389"]];
const ORD = ["1st", "2nd", "3rd", "4th"];
export const MAX_PLAYERS = 4;

export interface CitySessionOpts { quick: boolean; seed: number; profile: QualityProfile }

export interface RiderHud {
  id: string; name: string; color: string; cpu: boolean;
  place: number; lap: number; laps: number; gate: number; gates: number; kmh: number; meter: number; boostReady: boolean;
  drift: 0 | 1 | 2 | 3; bearing: number; next: number; done: boolean; kind: string; pick: number; locked: boolean;
  x: number; z: number; yaw: number;
}
export interface Msg { key: number; text: string; tone: "good" | "bad" | "info" }
export interface HudState {
  phase: CityEvent["phase"]; count: number; clock: number;
  riders: RiderHud[]; views: Array<{ rect: ViewSlot["rect"]; rider: string | null }>;
  msgs: Record<string, Msg[]>;
  gates: Array<{ x: number; z: number }>;
  coins: Array<{ x: number; z: number }>;
  /** Per rider (riders order): which of their coins are still out. */
  coinsOn: boolean[][];
  best: { name: string; ms: number } | null;
  order: Array<{ id: string; name: string; color: string; ms: number | null; coins: number; best: number | null }>;
}

export class CitySession {
  readonly event: CityEvent;
  readonly humans: string[];
  private names = new Map<string, string>();
  private colors = new Map<string, string>();
  private controls: GhatControls;
  private picks = new Map<string, PickEdge>();
  private view!: CityView;
  private audio: GhatAudio;
  private layout: Layout;
  private acc = 0;
  private count = 0;
  private msgKey = 0;
  private msgs = new Map<string, Msg[]>();
  private lastPhone = 0;
  private fps = 0;
  private frames = 0;
  private fpsT = 0;
  /** Autopilot brains for the humans: only to tell tests (and the HUD arrow) which way the route goes. */
  private guides = new Map<string, CpuBrain>();
  private hint = new Map<string, number>();
  private over = false;
  /** Average ms a frame spends simulating and drawing (shown in debug: the target-hardware check). */
  private cost = { sim: 0, draw: 0 };
  private resultsT = 0;

  constructor(players: PlayerView[], private kit: ControlPlayers, private bridge: GameBridge, readonly o: CitySessionOpts) {
    this.humans = players.slice(0, MAX_PLAYERS).map((p) => p.id);
    for (const p of players) {
      this.names.set(p.id, p.name);
      this.colors.set(p.id, p.color);
    }
    this.event = newEvent(this.humans, { ...(o.quick ? QUICK : FULL), seed: o.seed });
    const crew = CPU_CREW.filter(([, c]) => !players.some((p) => p.color.toLowerCase() === c));
    this.event.riders.filter((r) => r.cpu).forEach((r, i) => {
      const [name, color] = crew[i % crew.length]!;
      this.names.set(r.id, name);
      this.colors.set(r.id, color);
    });
    for (const id of this.humans) {
      this.picks.set(id, { armed: true });
      this.guides.set(id, newBrain(1));
    }
    this.controls = new GhatControls(kit, bridge, this.humans);
    this.controls.start();
    this.audio = new GhatAudio(this.humans.length, { rain: false });
    this.layout = splitLayout(Math.max(1, this.humans.length));
  }

  async load(canvas: HTMLCanvasElement, onProgress?: (p: number) => void) {
    const field = this.event.riders.map((r) => ({ color: this.colors.get(r.id)! }));
    const [view] = await Promise.all([CityView.create(canvas, this.o.profile, this.event.district, field, this.layout.player.length + this.layout.director.length, onProgress), this.audio.load()]);
    this.view = view;
  }

  private name = (id: string) => this.names.get(id) ?? id;
  private vibrate(id: string, ms: number) {
    if (this.humans.includes(id)) this.bridge.event(id, "vibrate", { ms });
  }
  private say(id: string, text: string, tone: Msg["tone"] = "info") {
    if (!this.humans.includes(id)) return;
    const list = this.msgs.get(id) ?? [];
    list.push({ key: ++this.msgKey, text, tone });
    this.msgs.set(id, list.slice(-3));
  }

  private inputs(): Map<string, CarInput> {
    const m = new Map<string, CarInput>();
    for (const id of this.humans) {
      const r = this.controls.read(id, DT);
      m.set(id, { steer: r.steer, drift: r.drift, boost: r.boost });
    }
    return m;
  }

  private onEvents(list: EventEvent[]) {
    const e = this.event;
    for (const x of list) {
      switch (x.kind) {
        case "count":
          this.count = x.n;
          this.audio.play(`v${x.n}`, 0.9);
          break;
        case "go":
          this.count = 0;
          this.controls.flush();
          this.audio.play("go", 1);
          for (const id of this.humans) this.vibrate(id, 60);
          break;
        case "pick":
          this.audio.play("tick", 0.5, 1.2);
          this.vibrate(x.id, 15);
          break;
        case "lock":
          this.audio.play("pickup", 0.6);
          this.vibrate(x.id, 40);
          if (this.humans.includes(x.id)) this.kit.toast(x.id, `${STATS[x.vehicle].label} locked in`, "good");
          break;
        case "crash":
          this.audio.play("crash", Math.min(1, x.speed / 18));
          this.vibrate(x.id, 160);
          this.say(x.id, "💥 Crash!", "bad");
          break;
        case "scrape":
          this.audio.play("scrape", 0.35);
          break;
        case "bump":
          this.audio.play("bump", Math.min(1, x.speed / 10));
          this.vibrate(x.a, 50);
          this.vibrate(x.b, 50);
          break;
        case "launch":
          this.audio.play("item", 0.5, 0.8);
          break;
        case "land":
          if (x.air > 0.35) {
            this.audio.play("bump", 0.5, 0.7);
            this.vibrate(x.id, x.big ? 90 : 40);
            if (x.big) this.say(x.id, `🛫 Big air ${x.air.toFixed(1)} s!`, "good");
          }
          break;
        case "turbo":
          this.audio.play("boost", 0.6, 0.9 + x.level * 0.1);
          this.vibrate(x.id, 30 + x.level * 15);
          break;
        case "boost":
          this.audio.play("boost", 0.9);
          this.vibrate(x.id, 80);
          break;
        case "coin":
          this.audio.play("pickup", 0.35, 1.3);
          this.vibrate(x.id, 12);
          break;
        case "gate":
          if (this.humans.includes(x.id)) {
            this.audio.play("tick", 0.6, 1.5);
            this.vibrate(x.id, 25);
          }
          break;
        case "lap":
          if (this.humans.includes(x.id)) {
            const s = (x.ms / 1000).toFixed(1);
            this.say(x.id, x.best ? `⏱ Lap ${x.lap}: ${s} s · best lap!` : `⏱ Lap ${x.lap}: ${s} s`, x.best ? "good" : "info");
          }
          break;
        case "finish":
          if (this.humans.includes(x.id)) {
            this.vibrate(x.id, x.place === 1 ? 300 : 120);
            this.say(x.id, `🏁 ${ORD[x.place - 1]}!`, x.place === 1 ? "good" : "info");
            if (x.place === 1) this.audio.play("win", 1);
          }
          break;
        case "reset":
          this.say(x.id, "🔄 Back on the road", "info");
          break;
        case "phase":
          if (x.phase === "results") {
            const order = standings(e);
            order.forEach((r, i) => {
              if (!this.humans.includes(r.id)) return;
              this.kit.outcome(r.id, i === 0 ? "You rule the city!" : `You finished ${ORD[i]}`, i === 0 ? "🏆" : i <= 2 ? "🥈" : "🛺");
            });
          }
          break;
      }
    }
  }

  /** One animation frame: true once the results have been shown long enough. */
  frame(now: number, dt: number, paused: boolean): boolean {
    this.frames++;
    this.fpsT += dt;
    if (this.fpsT >= 1) {
      this.fps = Math.round(this.frames / this.fpsT);
      this.frames = 0;
      this.fpsT = 0;
    }
    const e = this.event;
    const t0 = performance.now();
    if (!paused) {
      this.acc = Math.min(this.acc + dt, DT * 8);
      while (this.acc >= DT) {
        this.acc -= DT;
        if (e.phase === "garage") {
          for (const id of this.humans) {
            const steer = this.kit.get(id).x;
            const dir = pickEdge(this.picks.get(id)!, steer);
            const inp = this.controls.read(id, DT);
            const ev: EventEvent[] = [];
            garage(e, id, { left: dir < 0, right: dir > 0, ok: inp.boost }, ev);
            this.onEvents(ev);
          }
          this.onEvents(step(e, DT, new Map()));
        } else if (e.phase === "race") {
          this.onEvents(step(e, DT, this.inputs()));
        } else {
          if (e.phase === "intro" || e.phase === "countdown") this.controls.flush();
          this.onEvents(step(e, DT, new Map()));
        }
        if (e.phase === "results") {
          this.resultsT += DT;
          if (this.resultsT >= e.opts.resultsSeconds) this.over = true;
        }
      }
    }
    // the autopilot's steer for each human (HUD arrow and test hint)
    if (e.phase === "race") {
      for (const id of this.humans) {
        const r = e.riders.find((q) => q.id === id)!;
        const g = e.district.gates[r.next]!, g2 = e.district.gates[(r.next + 1) % e.district.gates.length]!;
        const node = (q: { x: number; z: number }) => e.graph.crossing(Math.round(q.x / SPACING), Math.round(q.z / SPACING));
        this.hint.set(id, cpuDrive(e.graph, this.guides.get(id)!, r.car, node(g), node(g2), e.clock).steer);
      }
    }
    const t1 = performance.now();
    // audio
    this.humans.forEach((id, i) => {
      const c = e.riders.find((r) => r.id === id)!.car;
      this.audio.engine(i, Math.min(1, speedOf(c) / 38), c.boostT > 0, e.phase === "race" || e.phase === "countdown");
    });
    // picture
    const cars = e.riders.map((r) => r.car);
    this.view.sync(cars, e.coins.map((list) => list.map((c) => c.on)), dt);
    this.view.draw(this.slots(), cars, e.phase === "race" || e.phase === "countdown" ? "chase" : e.phase === "garage" ? "grid" : "orbit", dt);
    const t2 = performance.now();
    this.cost.sim += (t1 - t0 - this.cost.sim) * 0.05;
    this.cost.draw += (t2 - t1 - this.cost.draw) * 0.05;
    // phones
    if (now - this.lastPhone > 300) {
      this.lastPhone = now;
      for (const id of this.humans) {
        const r = e.riders.find((x) => x.id === id)!;
        const text = e.phase === "garage" ? (r.locked ? `${STATS[KINDS[r.pick]!].label} locked in · waiting…` : "Steer to pick a ride · BOOST to lock it in")
          : e.phase === "race" ? `${ORD[placeOf(e, id) - 1]} · Lap ${r.lap}/${e.opts.laps} · Gate ${(r.cleared % e.district.gates.length) + 1}/${e.district.gates.length}`
          : e.phase === "results" ? "Race over!" : "Get ready…";
        this.kit.status(id, {
          text,
          bars: [
            { label: "Boost", value: r.car.meter, color: r.car.meter >= BOOST_COST ? "#ff6a00" : "#888" },
            { label: "Drift", value: Math.min(1, r.car.driftT / 2), color: ["#888", "#41b8ff", "#ff9a1f", "#d04bff"][driftLevel(r.car)] },
          ],
        });
      }
    }
    for (const [id, list] of this.msgs) this.msgs.set(id, list.filter((m) => this.msgKey - m.key < 6));
    return this.over;
  }

  private slots(): ViewSlot[] {
    const e = this.event;
    const lead = standings(e)[0]!;
    const out: ViewSlot[] = this.layout.player.map((rect, i) => {
      const id = this.humans[i];
      const k = id ? e.riders.findIndex((r) => r.id === id) : e.riders.indexOf(lead);
      const r = e.riders[k]!;
      return { rect, car: k, gate: r.next, color: this.colors.get(r.id)! };
    });
    // spare quarter (3 players): follow the race leader
    for (const rect of this.layout.director) out.push({ rect, car: e.riders.indexOf(lead), gate: lead.next, color: this.colors.get(lead.id)! });
    return out;
  }

  hud(): HudState {
    const e = this.event;
    const gates = e.district.gates.length;
    const riders: RiderHud[] = e.riders.map((r) => ({
      id: r.id, name: this.name(r.id), color: this.colors.get(r.id)!, cpu: r.cpu,
      place: placeOf(e, r.id), lap: Math.min(r.lap, e.opts.laps), laps: e.opts.laps, gate: (r.cleared % gates) + 1, gates,
      kmh: Math.round(speedOf(r.car) * 3.6), meter: r.car.meter, boostReady: r.car.meter >= BOOST_COST - 1e-6,
      drift: driftLevel(r.car), bearing: gateBearing(e, r), next: r.next, done: r.finishedAt !== null, kind: STATS[r.car.kind].label, pick: r.pick, locked: r.locked,
      x: r.car.x, z: r.car.z, yaw: r.car.yaw,
    }));
    const slots = this.slots();
    const order = standings(e).map((r) => ({
      id: r.id, name: this.name(r.id), color: this.colors.get(r.id)!, ms: r.finishedAt !== null ? Math.round(r.finishedAt * 1000) : null,
      coins: r.car.stats.coins, best: r.laps.length ? Math.min(...r.laps) : null,
    }));
    return {
      phase: e.phase, count: this.count, clock: e.clock, riders,
      views: slots.map((s, i) => ({ rect: s.rect, rider: i < this.layout.player.length ? (this.humans[i] ?? null) : null })),
      msgs: Object.fromEntries(this.msgs), gates: e.district.gates.map((g) => ({ x: g.x, z: g.z })),
      coins: e.district.coins.map((c) => ({ x: c.x, z: c.z })),
      coinsOn: e.coins.map((list) => list.map((c) => c.on)),
      best: e.bestLap ? { name: this.name(e.bestLap.id), ms: e.bestLap.ms } : null, order,
    };
  }

  debug() {
    const e = this.event;
    const info = this.view?.renderer.info.render;
    return {
      phase: e.phase, clock: +e.clock.toFixed(1), fps: this.fps, ms: { sim: +this.cost.sim.toFixed(2), draw: +this.cost.draw.toFixed(2) }, calls: info?.calls ?? 0, tris: info?.triangles ?? 0, tier: this.o.profile.tier,
      views: this.layout.player.length + this.layout.director.length, laps: e.opts.laps, gates: totalGates(e),
      riders: e.riders.map((r) => ({
        id: r.id, name: this.name(r.id), cpu: r.cpu, kind: r.car.kind, pick: r.pick, locked: r.locked, place: placeOf(e, r.id), lap: r.lap, cleared: r.cleared,
        next: r.next, kmh: Math.round(speedOf(r.car) * 3.6), meter: +r.car.meter.toFixed(2), done: r.finishedAt !== null,
        x: +r.car.x.toFixed(1), z: +r.car.z.toFixed(1), y: +r.car.y.toFixed(1), drift: driftLevel(r.car), air: r.car.air,
        turn: r.cpu ? 0 : +(this.hint.get(r.id) ?? 0).toFixed(2),
        stats: { ...r.car.stats, air: +r.car.stats.air.toFixed(1) },
        got: r.cpu ? null : this.controls.received(r.id),
      })),
    };
  }

  results() {
    return results(this.event);
  }

  dispose() {
    this.controls.dispose();
    this.audio.dispose();
    this.view?.dispose();
  }
}

export { CONTROLS };
