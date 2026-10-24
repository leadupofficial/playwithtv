/**
 * One GHAT RUSH match on the TV: owns the race simulation, the CPU brains, the view, sound and the phones'
 * feedback, and turns race events into juice (messages, shakes, sparks, slow motion, vibration). The React
 * component only mounts it and draws the HUD it reports.
 */
import type { PlayerView } from "@playwithtv/protocol";
import type { QualityProfile } from "../../quality/tier";
import type { ControlPlayers } from "../controlKit";
import type { GameBridge } from "../types";
import { GameClock } from "../kit3d/juice";
import { DT, FULL, QUICK, lapOf, newRace, standings, step, type Race, type RaceEvent } from "./race";
import { BOOST_COST, driftLevel, type Kind, type RacerInput } from "./racer";
import { cpuInput, newBrain, type Brain } from "./cpu";
import { GhatControls } from "./controls";
import { GhatView, type DrawView } from "./view";
import { GhatAudio } from "./audio";
import { liveGoats, liveRacers, liveTraffic, replayPoses, type RacerPose } from "./actors";
import { director, flyover, replayCam } from "./camera";
import { splitLayout } from "./layout";
import { pickAwards } from "./awards";
import { toWorld } from "./track";
import { ITEM_LABEL } from "./items";
import type { HudState, PlayerHud } from "./Hud";

const CPU_CREW: Array<[string, string]> = [["Rapid Rani", "#ff9f1c"], ["Chai Charlie", "#2ec4b6"], ["Ghat Guru", "#b5179e"], ["Monsoon Mani", "#7bd389"], ["Hairpin Hari", "#f15bb5"], ["Tea Leaf Tara", "#00bbf9"]];
const KIND_ORDER: Kind[] = ["auto", "scooter", "car"];
const ORD = ["1st", "2nd", "3rd", "4th", "5th", "6th", "7th", "8th"];

export interface SessionOpts { quick: boolean; seed: number; profile: QualityProfile }

export class Session {
  readonly race: Race;
  readonly controls: GhatControls;
  readonly audio: GhatAudio;
  view!: GhatView;
  readonly names = new Map<string, string>();
  readonly colors = new Map<string, string>();
  readonly humans: string[];
  private brains = new Map<string, Brain>();
  private inputs = new Map<string, RacerInput>();
  private clock = new GameClock();
  private acc = 0;
  private msgs = new Map<string, PlayerHud["msgs"]>();
  private msgKey = 0;
  private count: number | null = null;
  private goFlash = 0;
  private replayT = 0;
  private fps = 0;
  private frames = 0;
  private fpsT = 0;
  private time = 0;
  private lastPhone = 0;
  private lastWreckBy = new Map<string, string>();
  private racerPoses: RacerPose[] = [];
  private startedAt = Date.now();
  /** Smoothed CPU milliseconds per frame: simulation, scene dressing, draw submission. */
  private ms = { sim: 0, dress: 0, draw: 0 };
  readonly layout;

  constructor(players: PlayerView[], private kit: ControlPlayers, private bridge: GameBridge, readonly o: SessionOpts) {
    this.humans = players.map((p) => p.id);
    const entrants = players.map((p, i) => ({ id: p.id, cpu: false, kind: KIND_ORDER[i % 3]! }));
    for (const p of players) {
      this.names.set(p.id, p.name);
      this.colors.set(p.id, p.color);
    }
    const crew = CPU_CREW.filter(([, c]) => !players.some((p) => p.color.toLowerCase() === c));
    for (let i = 0; entrants.length < 6; i++) {
      const id = `cpu${i}`;
      const [name, color] = crew[i % crew.length]!;
      entrants.push({ id, cpu: true, kind: KIND_ORDER[(entrants.length) % 3]! });
      this.names.set(id, name);
      this.colors.set(id, color);
      this.brains.set(id, newBrain(i + 3));
    }
    this.race = newRace(entrants, { ...(o.quick ? QUICK : FULL), seed: o.seed });
    this.controls = new GhatControls(kit, bridge, this.humans);
    this.controls.start();
    this.audio = new GhatAudio(this.humans.length);
    this.layout = splitLayout(this.humans.length);
  }

  async load(canvas: HTMLCanvasElement, onProgress: (p: number) => void) {
    const field = this.race.racers.map((r) => ({ kind: r.kind, color: this.colors.get(r.id)! }));
    const [view] = await Promise.all([GhatView.create(canvas, this.o.profile, this.race.track, field, this.humans.length, onProgress), this.audio.load()]);
    this.view = view;
  }

  private say(id: string, text: string, color = "#fff", big = false) {
    if (!this.humans.includes(id)) return;
    const list = this.msgs.get(id) ?? [];
    list.push({ key: ++this.msgKey, text, color, big });
    while (list.length > 3) list.shift();
    this.msgs.set(id, list);
  }
  private vibrate(id: string, ms: number) {
    if (this.humans.includes(id)) this.bridge.event(id, "vibrate", { ms });
  }
  private cam(id: string) {
    const i = this.humans.indexOf(id);
    return i >= 0 ? this.view.cams[i] : null;
  }
  private pose(id: string) {
    return this.racerPoses.find((p) => p.id === id) ?? null;
  }

  private handle(events: RaceEvent[]) {
    const n = (id: string) => this.names.get(id) ?? id;
    for (const e of events) {
      switch (e.kind) {
        case "count":
          this.count = e.n;
          this.audio.play(`v${e.n}`, 0.9);
          break;
        case "go":
          this.count = 0;
          this.goFlash = 1.2;
          this.audio.play("go", 1);
          this.controls.flush();
          for (const id of this.humans) this.cam(id)?.punch(0.6);
          break;
        case "takedown": {
          const p = this.pose(e.victim);
          if (p) this.view.wreckAt(p);
          this.clock.hitStop(0.08);
          this.clock.slowMo(0.45, 0.6);
          this.audio.play("crash", 1);
          this.say(e.by, "TAKEDOWN!", "#ff4d4d", true);
          this.say(e.victim, `${n(e.by)} got you!`, "#ff9a9a");
          this.lastWreckBy.set(e.victim, n(e.by));
          this.cam(e.by)?.shake(0.5);
          this.cam(e.victim)?.shake(0.9);
          this.vibrate(e.by, 120);
          this.vibrate(e.victim, 400);
          if (this.humans.includes(e.by)) this.kit.toast(e.by, `💥 Takedown on ${n(e.victim)}!`, "good");
          break;
        }
        case "crash": {
          const p = this.pose(e.id);
          if (p) this.view.wreckAt(p);
          this.audio.play("crash", 0.8);
          this.say(e.id, "CRASHED!", "#ff6b6b", true);
          this.lastWreckBy.delete(e.id);
          this.cam(e.id)?.shake(0.9);
          this.vibrate(e.id, 350);
          break;
        }
        case "bump":
          if (e.impact > 3) {
            this.audio.play("bump", Math.min(1, e.impact / 10));
            const p = this.pose(e.a);
            if (p) this.view.sparksAt(p, "#ffd27a", 6);
            this.cam(e.a)?.shake(0.15);
            this.cam(e.b)?.shake(0.25);
            this.vibrate(e.a, 40);
            this.vibrate(e.b, 70);
          }
          break;
        case "wall":
          if (e.impact > 2.5) {
            const p = this.pose(e.id);
            if (p) this.view.sparksAt(p, "#ffcf7a", 8, 7);
            this.audio.play("scrape", 0.5);
            this.cam(e.id)?.shake(0.2);
            this.vibrate(e.id, 50);
          }
          break;
        case "nearMiss":
          this.say(e.id, e.oncoming ? "NEAR MISS! ++" : "NEAR MISS +", "#7df9ff");
          this.audio.play("tick", 0.6, 1.4);
          break;
        case "draft":
          this.say(e.id, "DRAFTING", "#b8f2ff");
          break;
        case "air":
          this.say(e.id, "BIG AIR!", "#ffe066");
          break;
        case "land":
          this.cam(e.id)?.shake(Math.min(0.5, e.impact * 0.04));
          this.vibrate(e.id, 60);
          break;
        case "driftLevel":
          this.audio.play("tick", 0.5, 1 + e.level * 0.25);
          if (e.level === 3) this.vibrate(e.id, 30);
          break;
        case "turbo":
          this.say(e.id, e.level === 3 ? "ULTRA TURBO!" : e.level === 2 ? "SUPER TURBO!" : "TURBO!", ["", "#41b8ff", "#ff9a1f", "#d04bff"][e.level]);
          this.audio.play("boost", 0.6, 0.9 + e.level * 0.1);
          this.cam(e.id)?.punch(0.3 + e.level * 0.15);
          this.vibrate(e.id, 40 + e.level * 20);
          break;
        case "boost":
          this.audio.play("boost", 0.9);
          this.cam(e.id)?.punch(0.9);
          this.vibrate(e.id, 120);
          break;
        case "pickup":
          this.audio.play("pickup", 0.5);
          break;
        case "item":
          this.audio.play("item", 0.8);
          if (e.item === "horn") this.audio.horn();
          if (e.item === "splash") {
            const p = this.pose(e.id);
            if (p) this.view.splashAt(p);
            this.audio.play("splash", 1);
          }
          this.say(e.id, ITEM_LABEL[e.item].toUpperCase(), "#fff");
          break;
        case "splashed":
          this.say(e.id, "SPLASHED!", "#9ad9ff");
          this.vibrate(e.id, 200);
          break;
        case "coconutHit":
          this.say(e.id, "COCONUT'D!", "#d9a35c");
          this.say(e.by, "BULLSEYE!", "#d9a35c");
          this.cam(e.id)?.shake(0.4);
          this.vibrate(e.id, 150);
          break;
        case "goat":
          this.say(e.id, "BAAA! GOAT!", "#fff");
          this.audio.horn();
          this.cam(e.id)?.shake(0.35);
          this.vibrate(e.id, 120);
          break;
        case "goatDodge":
          this.say(e.id, "GOAT DODGE +", "#c6ff8a");
          break;
        case "lap":
          this.say(e.id, e.final ? "FINAL LAP!" : `LAP ${e.lap}`, e.final ? "#ff5d5d" : "#fff", e.final);
          break;
        case "finish": {
          this.say(e.id, `FINISHED ${ORD[e.place - 1]}!`, "#ffd23f", true);
          if (this.humans.includes(e.id)) {
            this.kit.outcome(e.id, e.place === 1 ? "You rule the ghat!" : `You finished ${ORD[e.place - 1]}`, e.place === 1 ? "🏆" : e.place <= 3 ? "🥈" : "🛺");
            if (e.place === 1) this.audio.play("win", 1);
          }
          break;
        }
        case "respawn":
          this.lastWreckBy.delete(e.id);
          break;
        case "phase":
          if (e.phase === "race") this.count = 0;
          break;
      }
    }
  }

  /** Advances and draws one frame. Returns true when the match is over. */
  frame(now: number, realDt: number, paused: boolean): boolean {
    const race = this.race;
    this.frames++;
    if (now - this.fpsT >= 1000) {
      this.fps = Math.round((this.frames * 1000) / (now - this.fpsT));
      this.frames = 0;
      this.fpsT = now;
    }
    let simDt = 0;
    const t0 = performance.now();
    if (!paused) {
      simDt = this.clock.tick(Math.min(0.1, realDt));
      this.acc += simDt;
      let steps = 0;
      while (this.acc >= DT && steps++ < 6) {
        this.acc -= DT;
        for (const r of race.racers) this.inputs.set(r.id, r.cpu ? cpuInput(race, r, this.brains.get(r.id)!, DT) : this.controls.read(r.id, DT));
        this.handle(step(race, DT, this.inputs));
      }
      if (this.acc > DT * 6) this.acc = 0;
      this.time += simDt;
    }
    this.goFlash = Math.max(0, this.goFlash - realDt);
    if (race.phase === "race" && this.goFlash <= 0) this.count = null;

    // poses: the replay plays the saved clip in slow motion
    const replay = race.phase === "replay" ? race.recorder.best : null;
    let racers: RacerPose[], traffic, goats;
    if (replay) {
      this.replayT += realDt * 0.45;
      const fi = Math.min(replay.frames.length - 1, Math.floor(this.replayT * 30));
      ({ racers, traffic, goats } = replayPoses(race, replay.frames[fi]!, this.colors, this.time));
    } else {
      racers = liveRacers(race, this.colors, this.racerPoses);
      traffic = liveTraffic(race);
      goats = liveGoats(race);
    }
    this.racerPoses = racers;
    const pickups = race.pickups.map((p) => ({ ...toWorld(race.track, p.s, p.d), on: p.t <= 0 }));
    const coconuts = race.coconuts.map((c) => ({ ...toWorld(race.track, c.s, c.d), spin: c.spin }));
    if (race.phase === "podium") this.podiumPoses(racers);
    const t1 = performance.now();
    this.view.dress(racers, traffic, goats, pickups, coconuts, this.time, paused ? 0 : realDt);
    const t2 = performance.now();

    // cameras
    const views: DrawView[] = [];
    const full = { x: 0, y: 0, w: 1, h: 1 };
    const cam0 = this.view.extra[0]!;
    if (race.phase === "intro") {
      flyover(cam0, race.track, race.phaseT / race.opts.introSeconds);
      views.push({ rect: full, camera: cam0, focus: null });
    } else if (replay) {
      const victim = racers[race.racers.findIndex((r) => r.id === replay.victim)]!;
      replayCam(cam0, victim, this.replayT * 0.8 + 0.6);
      views.push({ rect: full, camera: cam0, focus: victim });
    } else if (race.phase === "podium") {
      const top = racers.find((r) => r.visible)!;
      const a = this.time * 0.25;
      cam0.position.set(top.x + Math.sin(a) * 13, top.y + 4.5, top.z + Math.cos(a) * 13);
      cam0.lookAt(top.x, top.y + 1.5, top.z);
      cam0.fov = 45;
      cam0.updateProjectionMatrix();
      views.push({ rect: full, camera: cam0, focus: top });
    } else {
      this.humans.forEach((id, i) => {
        const p = racers.find((r) => r.id === id)!;
        const r = race.racers.find((x) => x.id === id)!;
        const cam = this.view.cams[i]!;
        cam.update(p, realDt, Math.min(1, r.v / 40), now / 1000);
        views.push({ rect: this.layout.player[i]!, camera: cam.camera, focus: p });
      });
      const leader = standings(race)[0]!;
      const lp = racers.find((r) => r.id === leader.id)!;
      this.layout.director.forEach((rect, k) => {
        const cam = this.view.extra[k % 2]!;
        director(cam, lp, this.time + k * 3);
        views.push({ rect, camera: cam, focus: lp });
      });
    }
    this.view.draw(views, this.time);
    const t3 = performance.now();
    const k = 0.1;
    this.ms.sim += (t1 - t0 - this.ms.sim) * k;
    this.ms.dress += (t2 - t1 - this.ms.dress) * k;
    this.ms.draw += (t3 - t2 - this.ms.draw) * k;

    // engines
    this.humans.forEach((id, i) => {
      const r = race.racers.find((x) => x.id === id)!;
      this.audio.engine(i, Math.min(1, r.v / 42), r.boostT > 0 || r.turboT > 0, race.phase === "race" || race.phase === "countdown");
    });

    // phones
    if (now - this.lastPhone > 300) {
      this.lastPhone = now;
      for (const id of this.humans) {
        const r = race.racers.find((x) => x.id === id)!;
        this.kit.status(id, {
          text: race.phase === "race" ? `${ORD[r.place - 1]} · Lap ${lapOf(race, r)}/${race.opts.laps}${r.item ? ` · ${ITEM_LABEL[r.item]} ready` : ""}` : race.phase === "intro" || race.phase === "countdown" ? "Get ready…" : "Race over!",
          bars: [
            { label: "Boost", value: r.meter, color: r.meter >= BOOST_COST ? "#ff6a00" : "#888" },
            { label: "Drift", value: Math.min(1, r.driftT / 2), color: ["#888", "#41b8ff", "#ff9a1f", "#d04bff"][driftLevel(r)] },
          ],
        });
      }
    }
    for (const [id, list] of this.msgs) this.msgs.set(id, list.filter((m) => this.msgKey - m.key < 6));
    return race.over;
  }

  private podiumPoses(racers: RacerPose[]) {
    const order = standings(this.race);
    const base = toWorld(this.race.track, 40, -(this.race.track.hw[20]! + 0));
    const h = base.heading;
    const rx = -Math.cos(h), rz = Math.sin(h);
    const spots = [[0, 1.5], [-3.4, 1.0], [3.4, 0.6]];
    for (const p of racers) p.visible = false;
    order.slice(0, 3).forEach((r, i) => {
      const p = racers.find((x) => x.id === r.id)!;
      const [off, hgt] = spots[i]!;
      p.visible = true;
      p.x = base.x + rx * off!;
      p.z = base.z + rz * off!;
      p.y = base.y + hgt!;
      p.yaw = h + Math.PI + 0.5 + Math.sin(this.time * 2 + i) * 0.2;
      p.wrecked = false;
      p.boosting = false;
      p.drift = 0;
      p.tumble = 0;
      p.speed = 0;
    });
  }

  hud(): HudState {
    const race = this.race;
    const order = standings(race);
    const players: PlayerHud[] = this.humans.map((id, i) => {
      const r = race.racers.find((x) => x.id === id)!;
      return {
        id, name: this.names.get(id)!, color: this.colors.get(id)!, rect: this.layout.player[i]!,
        place: r.place, field: race.racers.length, lap: lapOf(race, r), laps: race.opts.laps, kmh: Math.round(r.v * 3.6),
        meter: r.meter, item: r.item, rolling: r.rollT > 0, level: driftLevel(r), drifting: r.drift !== 0,
        blind: r.blindT, wrecked: r.wreckT > 0, by: r.wreckT > 0 ? this.lastWreckBy.get(id) ?? null : null, finished: r.finishedAt !== null,
        msgs: this.msgs.get(id) ?? [],
      };
    });
    const fmt = (t: number | null) => (t === null ? "—" : `${Math.floor(t / 60)}:${(t % 60).toFixed(2).padStart(5, "0")}`);
    const best = race.recorder.best;
    const prefer = new Set(this.humans);
    return {
      phase: race.phase, count: this.count, players,
      results: race.phase === "results" ? order.map((r) => ({ name: this.names.get(r.id)!, color: this.colors.get(r.id)!, time: fmt(r.finishedAt) })) : null,
      replay: best ? { by: this.names.get(best.by)!, victim: this.names.get(best.victim)!, byColor: this.colors.get(best.by)! } : null,
      awards: race.phase === "podium" ? pickAwards(race.racers, 4, prefer).map((a) => ({ ...a, name: this.names.get(a.id)!, color: this.colors.get(a.id)! })) : null,
      podium: order.slice(0, 3).map((r) => ({ name: this.names.get(r.id)!, color: this.colors.get(r.id)! })),
    };
  }

  debug() {
    const race = this.race;
    const info = this.view.renderer.info.render;
    return {
      phase: race.phase, time: +race.time.toFixed(1), fps: this.fps, ms: { sim: +this.ms.sim.toFixed(1), dress: +this.ms.dress.toFixed(1), draw: +this.ms.draw.toFixed(1) }, calls: info.calls, tris: info.triangles, tier: this.o.profile.tier,
      views: this.layout.player.length + this.layout.director.length, laps: race.opts.laps, length: race.track.length,
      finish: race.finishOrder, replay: !!race.recorder.best,
      racers: race.racers.map((r) => ({
        id: r.id, name: this.names.get(r.id), cpu: r.cpu, kind: r.kind, place: r.place, lap: lapOf(race, r), s: Math.round(r.s), d: +r.d.toFixed(1),
        v: Math.round(r.v), meter: +r.meter.toFixed(2), item: r.item, drift: r.drift, wrecked: r.wreckT > 0, done: r.finishedAt !== null,
        // steering hint for tests: how the road bends ahead (-1 left … 1 right)
        turn: +Math.max(-1, Math.min(1, -r.d * 0.08 - r.a * 1.2 - curvHint(race, r.s) * 9)).toFixed(2),
        stats: { takedowns: r.stats.takedowns, wrecked: r.stats.wrecked, crashes: r.stats.crashes, nearMisses: r.stats.nearMisses, turbos: r.stats.turbos.reduce((a, b) => a + b, 0), boosts: r.stats.boosts, items: r.stats.items, air: +r.stats.air.toFixed(1) },
        got: r.cpu ? null : this.controls.received(r.id),
      })),
    };
  }

  results() {
    const order = standings(this.race);
    return { order: order.map((r) => r.id), ms: Date.now() - this.startedAt };
  }

  dispose() {
    this.controls.dispose();
    this.audio.dispose();
    this.view?.dispose();
  }
}

function curvHint(race: Race, s: number) {
  let c = 0;
  for (let a = 4; a <= 20; a += 4) c += race.track.curv[Math.floor(((s + a) % race.track.length + race.track.length) % race.track.length / 2) % race.track.n]!;
  return c / 5;
}

