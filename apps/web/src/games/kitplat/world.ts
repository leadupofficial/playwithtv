/**
 * kitplat/world: builds a level's world and advances it one fixed step: moving platforms, tile states (gates,
 * crumbling floors, timed spikes), heroes (heroes.ts), foes, projectiles, the boss, the shared camera and the
 * co-op / race rules (bubbles, team wipes, stragglers, finishing). Pure: the view reads the world, never writes it.
 */
import { type BossEvent, bossVulnerable, hitBoss, newBoss, stepBoss } from "./boss";
import { VIEW_H, clampCam, newCam, offScreen, updateCam, type Target } from "./camera";
import { Collider } from "./collide";
import { kill, newFoe, overlaps, stepFoe, type FoeKind } from "./foes";
import { Tile, parseLevel, setTile, type LevelDef } from "./level";
import { NO_INPUT, newMover, type PadInput } from "./player";
import { reviveAt, safeSpot, stepHero, touchFoesAndBoss } from "./heroes";
import type { EventKind, GameEvent, GameSpec, Hero, Item, Mode, World } from "./types";

export const INTRO_S = 2.2;
export const CLEAR_S = 3.2;

const emptyStats = () => ({ jumps: 0, stomps: 0, falls: 0, hits: 0, gems: 0, revives: 0, bubbles: 0, crates: 0, boosts: 0, bonks: 0,
  powers: 0, bossHits: 0, checkpoints: 0, levers: 0, loops: 0, kicks: 0, topSpeed: 0, airTime: 0 });

export function newHero(slot: number, id: string, x: number, y: number, hearts: number): Hero {
  return {
    ...newMover(x, y), slot, id, hearts, inv: 0, power: null, powerT: 0, shield: 0, down: "", downT: 0, checkpoint: { x, y },
    finished: false, finishT: 0, place: 0, score: 0, levelScore: 0, combo: 0, boostT: 0, flipT: 0, hurtT: 0, landT: -9, landV: 0,
    loop: null, shotCd: 0, stragT: 0, groundY: y, stats: emptyStats(),
  };
}

/** A world for one level. Pass the previous heroes to carry scores and stats across levels. */
export function createWorld(spec: GameSpec, def: LevelDef, ids: string[], mode: Mode, seed = 1, carry?: Hero[]): World {
  const level = parseLevel(def);
  const col = new Collider(level);
  const heroes = ids.map((id, i) => {
    const h = newHero(i, id, level.start.x + (i - (ids.length - 1) / 2) * 0.7, level.start.y, spec.hearts);
    const prev = carry?.find((c) => c.id === id);
    if (prev) { h.score = prev.score; h.stats = prev.stats; }
    return h;
  });
  const items: Item[] = [];
  const foes = [];
  const movers: World["movers"] = [];
  let bossAt: { x: number; y: number } | null = null;
  let p = 0;
  for (const e of level.entities) {
    const it = (kind: Item["kind"], x = e.x, y = e.y, power: string | null = null) =>
      items.push({ kind, x, y, taken: false, t: 0, power, on: false, pull: -1 });
    switch (e.kind) {
      case "gem": it("gem", e.x, e.y + 0.5); break;
      case "biggem": it("biggem", e.x, e.y + 0.5); break;
      case "powerup": {
        const list = def.powerups ?? spec.powers.map((q) => q.id);
        it("powerup", e.x, e.y + 0.5, list.length ? list[p++ % list.length]! : null);
        break;
      }
      case "spring": case "boost": case "checkpoint": case "goal": case "leverA": case "leverB": case "loop": it(e.kind); break;
      case "walker": case "hopper": case "flyer": case "curler": foes.push(newFoe(foes.length, e.kind as FoeKind, e.x, e.y)); break;
      case "moverH": case "moverV": {
        const m = def.movers?.[movers.length] ?? {};
        const w = m.w ?? 3;
        movers.push({ x0: e.x, y0: e.y + 1, axis: e.kind === "moverH" ? "h" : "v", travel: m.travel ?? 4, period: m.period ?? 4 });
        col.platforms.push({ x: e.x, y: e.y + 1, hw: w / 2, dx: 0, dy: 0, active: true });
        break;
      }
      case "boss": bossAt = { x: e.x, y: e.y }; break;
      default: break;
    }
  }
  const bdef = spec.bosses.find((b) => b.id === def.boss);
  const boss = bossAt && bdef ? newBoss(bdef, bossAt.x, bossAt.y, [Math.max(0, bossAt.x - 13), Math.min(level.w, bossAt.x + 8)]) : null;
  const cam = newCam(level.start.x + 4, level.start.y + VIEW_H * 0.3);
  clampCam(cam, level.w, level.h);
  return {
    spec, level, col, mode, heroes, foes, items, boss, movers, cam, phase: "intro", phaseT: 0, time: 0, clock: def.time,
    teamCheckpoint: { ...level.start }, gateT: [0, 0], crumble: new Float32Array(level.w * level.h), continues: 0, events: [],
    finishOrder: [], firstFinishT: 0, done: false, seed: seed >>> 0 || 1, wipeT: 0, bossAt,
    shots: Array.from({ length: 12 }, () => ({ x: 0, y: 0, vx: 0, vy: 0, life: 0, slot: 0, alive: false })),
  };
}

export function emit(w: World, kind: EventKind, x: number, y: number, slot = -1, v = 0) {
  w.events.push({ kind, x, y, slot, v } as GameEvent);
}

export function rand(w: World): number {
  let t = (w.seed = (w.seed + 0x6d2b79f5) >>> 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** Are timed spikes at column c out right now? (2.4 s cycle, out for 1 s, neighbouring columns offset.) */
export function spikesOut(w: World, c: number): boolean {
  return ((w.time + (c % 4) * 0.15) % 2.4) < 1.0;
}

const targets: Target[] = [0, 1, 2, 3].map(() => ({ x: 0, y: 0, vx: 0, grounded: false, weight: 0 }));
let curWorld: World | null = null;
const onBossEvent = (e: BossEvent) => { if (curWorld) bossEvent(curWorld, e); };

function anyHeroIn(w: World, t: Tile): boolean {
  for (const h of w.heroes) if (!h.down && w.col.touches(h.body, t, 0.02)) return true;
  return false;
}

/** Advances the world by dt (DT). `inputs[slot]`; edges (jumpPressed, action) are read once. Clears w.events first. */
export function stepWorld(w: World, inputs: PadInput[], dt: number) {
  w.events.length = 0;
  w.phaseT += dt;
  if (w.phase === "intro") {
    if (w.phaseT >= INTRO_S) { w.phase = "play"; w.phaseT = 0; emit(w, "go", w.cam.x, w.cam.y); }
    else { updateCamera(w, dt); return; }
  }
  if (w.phase === "clear" || w.phase === "timeup") {
    for (const h of w.heroes) {
      if (h.down) continue;
      h.body.vx *= 0.9;
      stepHero(w, h, NO_INPUT, dt);
    }
    updateCamera(w, dt);
    if (w.phaseT >= CLEAR_S) w.done = true;
    return;
  }
  w.time += dt;
  w.clock = Math.max(0, w.clock - dt);
  for (const it of w.items) it.t += dt;
  stepPlatforms(w, dt);
  stepTiles(w, dt);
  for (const h of w.heroes) stepHero(w, h, inputs[h.slot] ?? NO_INPUT, dt);
  bumpHeroes(w);
  const lead = leader(w);
  for (const f of w.foes) {
    const near = nearestHero(w, f.body.x);
    stepFoe(f, w.col, dt, near ? near.body.x : NaN);
    if (f.state === "roll") for (const g of w.foes) if (g !== f && g.state !== "dead" && overlaps(f.body, g.body)) { kill(g); scoreTo(w, f.kicker, 100); emit(w, "stomp", g.body.x, g.body.y + 0.4, f.kicker, 1); }
    if (f.state !== "dead" && f.body.y < -3) kill(f);
  }
  if (w.boss) {
    const near = nearestHero(w, w.boss.body.x);
    curWorld = w;
    stepBoss(w.boss, w.col, dt, near ? near.body.x : NaN, near ? near.body.y : NaN, onBossEvent);
    if (w.boss.awake && !w.boss.dead) { w.cam.lockX0 = w.boss.arena[0]; w.cam.lockX1 = w.boss.arena[1]; }
  }
  stepShots(w, dt);
  for (const h of w.heroes) if (!h.down && !h.finished) touchFoesAndBoss(w, h, inputs[h.slot] ?? NO_INPUT);
  updateCamera(w, dt);
  rules(w, dt, lead);
}

function stepPlatforms(w: World, dt: number) {
  for (let i = 0; i < w.movers.length; i++) {
    const m = w.movers[i]!, p = w.col.platforms[i]!;
    const s = (1 - Math.cos((w.time / m.period) * Math.PI * 2)) / 2 * m.travel;
    const nx = m.axis === "h" ? m.x0 + s : m.x0, ny = m.axis === "v" ? m.y0 + s : m.y0;
    p.dx = nx - p.x;
    p.dy = ny - p.y;
    p.x = nx;
    p.y = ny;
    for (const h of w.heroes) {
      if (h.body.platform !== i || !h.body.grounded) continue;
      w.col.moveX(h.body, p.dx);
      h.body.y = p.y;
    }
  }
  void dt;
}

function stepTiles(w: World, dt: number) {
  const L = w.level;
  for (let g = 0; g < 2; g++) {
    if (w.gateT[g]! > 0 && w.spec.leverSeconds > 0) {
      w.gateT[g] = Math.max(0, w.gateT[g]! - dt);
      if (w.gateT[g] === 0) {
        // never close a gate on someone: wait until it is clear
        const t = g === 0 ? Tile.GateA : Tile.GateB;
        if (anyHeroIn(w, t)) w.gateT[g] = 0.2;
        else w.col.gateOpen[g] = false;
      }
    }
  }
  for (let i = 0; i < w.crumble.length; i++) {
    const v = w.crumble[i]!;
    if (v === 0) continue;
    if (v > 0) {
      w.crumble[i] = v + dt;
      if (v + dt >= 0.5) {
        setTile(L, i % L.w, Math.floor(i / L.w), Tile.Empty);
        w.crumble[i] = -4;
        emit(w, "crumble", (i % L.w) + 0.5, Math.floor(i / L.w) + 0.5);
      }
    } else {
      w.crumble[i] = Math.min(0, v + dt);
      if (w.crumble[i] === 0) {
        const c = i % L.w, r = Math.floor(i / L.w);
        let busy = false;
        for (const h of w.heroes) if (Math.abs(h.body.x - (c + 0.5)) < 0.5 + h.body.hw && h.body.y < r + 1 && h.body.y + h.body.h > r) busy = true;
        if (busy) w.crumble[i] = -0.5;
        else setTile(L, c, r, Tile.Crumble);
      }
    }
  }
}

function bumpHeroes(w: World) {
  const hs = w.heroes;
  for (let i = 0; i < hs.length; i++) {
    const a = hs[i]!;
    if (a.down || a.loop || a.finished) continue;
    for (let j = i + 1; j < hs.length; j++) {
      const b = hs[j]!;
      if (b.down || b.loop || b.finished || !overlaps(a.body, b.body, 0.02)) continue;
      const [top, low] = a.body.y > b.body.y ? [a, b] : [b, a];
      if (top.body.vy <= 0 && top.body.y > low.body.y + low.body.h * 0.6) {
        top.body.vy = 9;
        top.jumpHeld = false;
        top.launched = true;
        low.landT = 0;
        low.landV = 8;
        top.stats.bonks++;
        emit(w, "bonk", low.body.x, low.body.y + low.body.h, top.slot);
        continue;
      }
      if (w.mode === "race") continue;
      const push = (a.body.hw + b.body.hw - Math.abs(a.body.x - b.body.x)) * 0.05; // a nudge: fast heroes squeeze past
      const s = a.body.x < b.body.x ? -1 : 1;
      w.col.moveX(a.body, s * push);
      w.col.moveX(b.body, -s * push);
    }
  }
}

function stepShots(w: World, dt: number) {
  for (const s of w.shots) {
    if (!s.alive) continue;
    s.vy -= 14 * dt;
    s.x += s.vx * dt;
    s.y += s.vy * dt;
    s.life -= dt;
    if (w.col.solidAt(Math.floor(s.x), Math.floor(s.y)) && s.vy < 0 && !w.col.solidAt(Math.floor(s.x), Math.floor(s.y + 0.5))) {
      s.y = Math.floor(s.y) + 1;
      s.vy = 5; // skip along the floor
    } else if (s.life <= 0 || w.col.solidAt(Math.floor(s.x), Math.floor(s.y))) s.alive = false;
    if (!s.alive) continue;
    for (const f of w.foes) {
      if (f.state === "dead" || Math.abs(f.body.x - s.x) > f.body.hw + 0.25 || s.y < f.body.y - 0.2 || s.y > f.body.y + f.body.h + 0.2) continue;
      kill(f);
      s.alive = false;
      scoreTo(w, s.slot, 100);
      emit(w, "stomp", f.body.x, f.body.y + 0.4, s.slot, 1);
      break;
    }
    const b = w.boss;
    if (s.alive && b && !b.dead && Math.abs(b.body.x - s.x) < b.body.hw + 0.2 && s.y > b.body.y && s.y < b.body.y + b.body.h) {
      s.alive = false;
      if (hitBoss(b, "projectile")) bossHit(w, s.slot);
    }
  }
}

export function scoreTo(w: World, slot: number, pts: number) {
  const h = w.heroes[slot];
  if (!h) return;
  h.score += pts;
  h.levelScore += pts;
}

export function bossHit(w: World, slot: number) {
  const b = w.boss!;
  scoreTo(w, slot, b.dead ? 1000 : 300);
  const h = w.heroes[slot];
  if (h) h.stats.bossHits++;
  emit(w, b.dead ? "bossdown" : "bosshit", b.body.x, b.body.y + b.body.h * 0.6, slot, b.hp);
}

function bossEvent(w: World, e: BossEvent) {
  const b = w.boss!;
  if (e === "summon" && w.boss!.def.summon && w.foes.filter((f) => f.state !== "dead").length < 6) {
    const f = newFoe(w.foes.length, w.boss!.def.summon, b.body.x + b.dir * 1.5, b.body.y + 1);
    f.dir = b.dir;
    w.foes.push(f);
  }
  emit(w, e === "wake" ? "bosswake" : e === "summon" ? "throw" : e === "charge" ? "throw" : e, b.body.x, b.body.y, -1, bossVulnerable(b) ? 1 : 0);
}

export function nearestHero(w: World, x: number): Hero | null {
  let best: Hero | null = null, bd = Infinity;
  for (const h of w.heroes) {
    if (h.down || h.finished) continue;
    const d = Math.abs(h.body.x - x);
    if (d < bd) { bd = d; best = h; }
  }
  return best;
}

function leader(w: World): Hero | null {
  let best: Hero | null = null;
  for (const h of w.heroes) if (!h.down && (!best || h.body.x > best.body.x)) best = h;
  return best;
}

function updateCamera(w: World, dt: number) {
  targets.length = w.heroes.length;
  const lead = leader(w);
  let any = false;
  for (const h of w.heroes) {
    const active = !h.down && !(h.finished && w.mode === "race");
    const weight = !active ? 0 : w.mode === "race" && h === lead ? 2.5 : 1;
    // frame the ground they stand on, not every jump; follow falls below it and big launches above it
    let y = h.groundY;
    if (h.body.y < y - 0.5) y = h.body.y + 0.5;
    else if (h.body.y > y + 3.5) y = h.body.y - 3.5;
    const t = (targets[h.slot] ??= { x: 0, y: 0, vx: 0, grounded: false, weight: 0 });
    t.x = h.body.x; t.y = y; t.vx = h.body.vx; t.grounded = h.body.grounded; t.weight = weight;
    if (weight > 0) any = true;
  }
  if (!any) for (const h of w.heroes) if (!h.down) targets[h.slot]!.weight = 1;
  updateCam(w.cam, targets, w.level.w, w.level.h, dt);
}

/** Co-op and race rules: stragglers, team wipes, finishing, the clock. */
function rules(w: World, dt: number, lead: Hero | null) {
  for (const h of w.heroes) {
    if (h.down || h.finished || h.loop) { h.stragT = 0; continue; }
    h.stragT = offScreen(w.cam, h.body.x, h.body.y, 1) ? h.stragT + dt : 0;
    if (h.stragT < 1.2) continue;
    h.stragT = 0;
    if (w.mode === "coop") {
      h.down = "bubble";
      h.downT = 0;
      h.stats.bubbles++;
      emit(w, "bubble", h.body.x, h.body.y + 0.6, h.slot);
    } else if (lead && lead !== h) {
      const s = safeSpot(w, w.cam.x - w.cam.vw / 2 + 2.5);
      if (s) reviveAt(w, h, s.x, s.y, false);
    }
  }
  if (w.mode === "coop") {
    let alive = 0;
    for (const h of w.heroes) if (!h.down) alive++;
    if (alive === 0) {
      w.wipeT += dt;
      if (w.wipeT > 1.6) {
        w.wipeT = 0;
        w.continues++;
        emit(w, "wipe", w.teamCheckpoint.x, w.teamCheckpoint.y);
        w.heroes.forEach((h, i) => reviveAt(w, h, w.teamCheckpoint.x + (i - 1.5) * 0.6, w.teamCheckpoint.y, true));
        w.cam.x = w.teamCheckpoint.x + 3;
        clampCam(w.cam, w.level.w, w.level.h);
      }
    } else w.wipeT = 0;
  }
  let finished = 0;
  for (const h of w.heroes) if (h.finished) finished++;
  const bossDone = w.boss?.dead && w.boss.deadT > 1.6;
  const all = finished === w.heroes.length;
  const grace = w.mode === "race" ? 12 : 6;
  if (bossDone || all || (finished > 0 && w.time - w.firstFinishT > grace)) {
    w.phase = "clear";
    w.phaseT = 0;
    emit(w, "clear", w.cam.x, w.cam.y);
    for (const h of w.heroes) if (h.finished || bossDone) scoreTo(w, h.slot, Math.round(w.clock) * 5);
  } else if (w.clock <= 0) {
    w.phase = "timeup";
    w.phaseT = 0;
    emit(w, "timeup", w.cam.x, w.cam.y);
  }
}

export function inputsFor(w: World): PadInput[] {
  return w.heroes.map(() => NO_INPUT);
}

export { rand as worldRand };
