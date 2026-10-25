/**
 * kitplat/heroes: everything one hero does in a step beyond moving: hazards, pick-ups, springs, boost pads,
 * loops, checkpoints, levers, the goal, power-up timers and throws, foe and boss contact, getting hurt, going
 * down (a co-op bubble or a race respawn) and coming back. Pure; called by world.ts.
 */
import { bossVulnerable, hitBoss } from "./boss";
import { curl, kick, kill, overlaps } from "./foes";
import { launchSpeed } from "./feel";
import { Tile } from "./level";
import { type MoveMods, NO_MODS, type PadInput, stepMover } from "./player";
import { powerMods } from "./powerups";
import type { Hero, World } from "./types";
import { bossHit, emit, nearestHero, scoreTo, spikesOut } from "./world";

const mods: MoveMods = { ...NO_MODS };
const LOOP_R = 2.0;

export function stepHero(w: World, h: Hero, inp: PadInput, dt: number) {
  const b = h.body;
  h.inv = Math.max(0, h.inv - dt);
  h.hurtT = Math.max(0, h.hurtT - dt);
  h.boostT = Math.max(0, h.boostT - dt);
  h.flipT = Math.max(0, h.flipT - dt);
  h.shotCd = Math.max(0, h.shotCd - dt);
  h.landT += dt;
  if (h.down) return stepDown(w, h, inp, dt);
  if (h.finished && w.phase === "play") { b.vx = 0; return; }
  if (h.power && h.power.seconds > 0) {
    h.powerT -= dt;
    if (h.powerT <= 0) { h.power = null; emit(w, "powerlost", b.x, b.y + 1, h.slot); }
  }
  if (h.loop) return rideLoop(w, h, dt);
  const ev = stepMover(h, inp, w.spec.feel, w.col, dt, powerMods(h.power, mods));
  if (ev.jumped) { h.stats.jumps++; emit(w, ev.airJump ? "airjump" : "jump", b.x, b.y, h.slot); }
  if (ev.landed > 0) {
    h.landT = 0;
    h.landV = ev.landed;
    h.combo = 0;
    if (ev.landed > 6) emit(w, "land", b.x, b.y, h.slot, ev.landed);
  }
  if (ev.bumped >= 0) bump(w, h, ev.bumped);
  if (b.grounded || h.state === "climb" || h.state === "hang") h.groundY = b.y;
  if (!b.grounded) h.stats.airTime += dt;
  h.stats.topSpeed = Math.max(h.stats.topSpeed, Math.abs(b.vx));
  // crumbling floor starts to go once stood on
  if (b.grounded && b.ground === Tile.Crumble) {
    for (let c = Math.floor(b.x - b.hw + 0.05); c <= Math.floor(b.x + b.hw - 0.05); c++) {
      const r = Math.round(b.y) - 1;
      const i = r * w.level.w + c;
      if (w.col.tile(c, r) === Tile.Crumble && w.crumble[i] === 0) w.crumble[i] = 0.001;
    }
  }
  // hazards
  if (b.y < -2.5) return goDown(w, h, "fall");
  if (w.col.touches(b, Tile.Water, 0.35)) { emit(w, "splash", b.x, b.y + 0.5, h.slot); return goDown(w, h, "fall"); }
  if (w.col.touches(b, Tile.Spikes, 0.12) || (touchesTimedSpikes(w, h))) hurt(w, h, b.x - h.facing, true);
  // throwing (power-ups with a projectile)
  const pj = h.power?.projectile;
  if (inp.action && pj && h.shotCd <= 0) {
    const s = w.shots.find((x) => !x.alive);
    if (s) {
      Object.assign(s, { x: b.x + h.facing * 0.4, y: b.y + 0.7, vx: h.facing * pj.speed + b.vx * 0.3, vy: 3, life: pj.life, slot: h.slot, alive: true });
      h.shotCd = pj.cooldown;
      emit(w, "throw", b.x, b.y + 0.7, h.slot);
    }
  }
  items(w, h, inp);
}

function touchesTimedSpikes(w: World, h: Hero): boolean {
  const b = h.body;
  for (let c = Math.floor(b.x - b.hw + 0.12); c <= Math.floor(b.x + b.hw - 0.12); c++) {
    const r = Math.floor(b.y + 0.1);
    if (w.col.tile(c, r) === Tile.TimedSpikes && spikesOut(w, c)) return true;
  }
  return false;
}

/** Head bump from below: crates break into gems. */
function bump(w: World, h: Hero, col: number) {
  const r = Math.floor(h.body.y + h.body.h + 0.05);
  if (w.col.tile(col, r) === Tile.Crate) {
    w.level.tiles[r * w.level.w + col] = Tile.Empty;
    h.stats.crates++;
    h.stats.gems += 3;
    scoreTo(w, h.slot, 50 + 30);
    emit(w, "crate", col + 0.5, r + 0.5, h.slot);
  } else emit(w, "bump", h.body.x, h.body.y + h.body.h, h.slot, 0);
}

function items(w: World, h: Hero, inp: PadInput) {
  const b = h.body;
  const magnet = h.power?.magnet ?? 0;
  for (const it of w.items) {
    if (it.taken && it.kind !== "spring" && it.kind !== "checkpoint" && it.kind !== "leverA" && it.kind !== "leverB") continue;
    const dx = it.x - b.x, dy = it.y - (b.y + b.h * 0.5);
    switch (it.kind) {
      case "gem": case "biggem": {
        if (magnet && it.pull < 0 && dx * dx + dy * dy < magnet * magnet) it.pull = h.slot;
        if (it.pull === h.slot) { it.x -= dx * 0.18; it.y -= dy * 0.18; }
        if (Math.abs(dx) < b.hw + 0.32 && Math.abs(dy) < b.h * 0.5 + 0.32) {
          it.taken = true;
          const big = it.kind === "biggem";
          h.stats.gems += big ? 5 : 1;
          scoreTo(w, h.slot, big ? 50 : 10);
          emit(w, big ? "biggem" : "gem", it.x, it.y, h.slot);
        }
        break;
      }
      case "powerup": {
        if (Math.abs(dx) < b.hw + 0.4 && Math.abs(dy) < b.h * 0.5 + 0.4) {
          it.taken = true;
          const def = w.spec.powers.find((p) => p.id === it.power) ?? null;
          h.power = def;
          h.powerT = def?.seconds ?? 0;
          h.shield = def?.shield ?? 0;
          h.stats.powers++;
          scoreTo(w, h.slot, 200);
          emit(w, "power", it.x, it.y, h.slot);
        }
        break;
      }
      case "spring":
        if (b.vy <= 0 && Math.abs(dx) < b.hw + 0.35 && b.y >= it.y - 0.1 && b.y <= it.y + 0.7) {
          b.vy = launchSpeed(w.spec.feel.spring, w.spec.feel.gravity);
          b.grounded = false;
          b.y = it.y + 0.7;
          h.jumpHeld = false;
          h.launched = true;
          h.flipT = 0.7;
          it.t = 0;
          emit(w, "spring", it.x, it.y + 0.5, h.slot);
        }
        break;
      case "boost":
        if (b.grounded && Math.abs(dx) < 0.8 && Math.abs(b.y - it.y) < 0.3 && h.boostT <= 0) {
          b.vx = Math.max(b.vx, w.spec.feel.maxSpeed * 0.95);
          h.facing = 1;
          h.boostT = 0.8;
          h.stats.boosts++;
          emit(w, "boost", it.x, it.y, h.slot);
        }
        break;
      case "loop":
        if (b.grounded && b.vx >= w.spec.loopSpeed && Math.abs(dx) < 0.25 + b.vx / 60 && Math.abs(b.y - it.y) < 0.3) {
          h.loop = { cx: it.x, cy: it.y + LOOP_R + b.h / 2, a: -Math.PI / 2, speed: Math.max(b.vx, w.spec.loopSpeed) };
          h.stats.loops++;
          emit(w, "loop", it.x, it.y, h.slot);
        }
        break;
      case "checkpoint":
        if (Math.abs(dx) < 0.8 && Math.abs(b.y - it.y) < 1.6) {
          if (w.mode === "race") h.checkpoint = { x: it.x, y: it.y };
          else if (w.teamCheckpoint.x < it.x) w.teamCheckpoint = { x: it.x, y: it.y };
          if (!it.on || (w.mode === "race" && h.checkpoint.x === it.x && h.stats.checkpoints < 99 && it.power !== h.id)) {
            if (!it.on) { scoreTo(w, h.slot, 50); h.stats.checkpoints++; emit(w, "checkpoint", it.x, it.y + 1.5, h.slot); }
            it.on = true;
          }
        }
        break;
      case "goal":
        // the goal is a tall gate: crossing its line at any height counts (fast heroes are often mid-jump)
        if (!h.finished && b.x >= it.x - 0.5 && b.x < it.x + 6 && b.y > it.y - 1.5 && b.y < it.y + 9) finish(w, h);
        break;
      case "leverA": case "leverB":
        if (inp.action && Math.abs(dx) < 0.9 && Math.abs(b.y - it.y) < 1.2) pull(w, h, it);
        break;
    }
  }
}

function pull(w: World, h: Hero, it: World["items"][number]) {
  const g = it.kind === "leverA" ? 0 : 1;
  it.on = !it.on || w.spec.leverSeconds > 0;
  it.t = 0;
  w.col.gateOpen[g] = w.spec.leverSeconds > 0 ? true : !w.col.gateOpen[g];
  w.gateT[g] = w.spec.leverSeconds;
  h.stats.levers++;
  emit(w, "lever", it.x, it.y + 0.6, h.slot, g);
  // in a boss arena a lever drops the hanging weight above it
  const boss = w.boss;
  if (boss && Math.abs(boss.body.x - it.x) < 2.6 && hitBoss(boss, "hazard")) bossHit(w, h.slot);
}

function finish(w: World, h: Hero) {
  h.finished = true;
  h.finishT = w.time;
  if (!w.finishOrder.length) w.firstFinishT = w.time;
  w.finishOrder.push(h.slot);
  h.place = w.finishOrder.length;
  const bonus = w.mode === "race" ? [1000, 600, 400, 200][h.place - 1] ?? 100 : 500;
  scoreTo(w, h.slot, bonus);
  h.body.vx = 0;
  emit(w, "finish", h.body.x, h.body.y + 1, h.slot, h.place);
}

function rideLoop(w: World, h: Hero, dt: number) {
  const L = h.loop!, b = h.body;
  L.a += (L.speed / LOOP_R) * dt;
  if (L.a >= Math.PI * 1.5) {
    h.loop = null;
    b.x = L.cx + 0.05;
    b.y = L.cy - LOOP_R - b.h / 2;
    b.vx = L.speed;
    b.vy = 0;
    b.grounded = true;
    return;
  }
  b.x = L.cx + Math.cos(L.a) * LOOP_R * 0.85;
  b.y = L.cy + Math.sin(L.a) * LOOP_R - b.h / 2;
  b.vx = -Math.sin(L.a) * L.speed;
  b.vy = Math.cos(L.a) * L.speed;
  items(w, h, { x: 0, y: 0, jump: false, jumpPressed: false, run: false, action: false });
}

/** Contact with foes, balls and the boss: stomp from above, otherwise get hurt. */
export function touchFoesAndBoss(w: World, h: Hero, inp: PadInput) {
  const b = h.body;
  const f0 = w.spec.feel;
  const bounce = (extra = 0) => {
    b.vy = launchSpeed(f0.stomp + (inp.jump ? f0.stompBoost : 0) + extra, f0.gravity);
    b.grounded = false;
    h.jumpHeld = false;
    h.launched = true;
    h.combo++;
  };
  for (const f of w.foes) {
    if (f.state === "dead" || !overlaps(b, f.body)) continue;
    const above = b.vy < 0.5 && b.y > f.body.y + f.body.h * 0.45;
    if (f.state === "ball") {
      if (f.grace > 0) continue;
      kick(f, b.x, h.slot);
      h.stats.kicks++;
      if (above) bounce();
      emit(w, "kick", f.body.x, f.body.y + 0.3, h.slot);
      continue;
    }
    if (h.power?.invincible || h.loop) { kill(f); scoreTo(w, h.slot, 100); emit(w, "stomp", f.body.x, f.body.y + 0.4, h.slot, 1); continue; }
    if (f.state === "roll" && f.kicker === h.slot && f.grace > 0) continue;
    if (above) {
      if (f.kind === "curler") curl(f);
      else kill(f);
      bounce();
      h.stats.stomps++;
      scoreTo(w, h.slot, 100 * Math.min(8, h.combo));
      emit(w, "stomp", f.body.x, f.body.y + f.body.h, h.slot, h.combo);
    } else hurt(w, h, f.body.x, false);
  }
  const boss = w.boss;
  if (boss && !boss.dead && boss.awake) {
    if (overlaps(b, boss.body, 0.15)) {
      const above = b.vy < 0.5 && b.y > boss.body.y + boss.body.h * 0.55;
      if (above && bossVulnerable(boss) && hitBoss(boss, "stomp")) { bounce(2); bossHit(w, h.slot); }
      else if (above) { bounce(0.5); emit(w, "bump", b.x, b.y, h.slot, 1); }
      else if (boss.hurtT <= 0) hurt(w, h, boss.body.x, false);
    }
    for (const s of boss.shots) {
      if (s.alive && Math.abs(s.x - b.x) < b.hw + 0.25 && s.y > b.y && s.y < b.y + b.h) { s.alive = false; hurt(w, h, s.x, false); }
    }
  }
}

/** A hit: a shield or a heart goes, with knock-back and a moment of invulnerability. */
export function hurt(w: World, h: Hero, fromX: number, hazard: boolean) {
  if (h.inv > 0 || h.down || h.finished || h.loop || h.power?.invincible) return;
  const b = h.body;
  if (h.shield > 0) {
    h.shield--;
    if (h.shield === 0) h.power = null;
    h.inv = 1.0;
    emit(w, "shield", b.x, b.y + 0.7, h.slot);
  } else {
    h.hearts--;
    h.stats.hits++;
    h.inv = w.spec.feel.invulnerable;
    h.hurtT = 0.45;
    emit(w, "hurt", b.x, b.y + 0.7, h.slot, h.hearts);
    if (h.hearts <= 0) return goDown(w, h, "hit");
  }
  const dir = b.x >= fromX ? 1 : -1;
  b.vx = dir * w.spec.feel.knockback;
  b.vy = hazard ? 11 : 8;
  b.grounded = false;
  h.state = "air";
}

function goDown(w: World, h: Hero, why: "fall" | "hit") {
  h.down = w.mode === "coop" ? "bubble" : "wait";
  h.downT = 0;
  h.loop = null;
  h.power = null;
  h.shield = 0;
  h.state = "air";
  h.stats.falls++;
  h.body.vx = h.body.vy = 0;
  if (why === "fall") {
    // float back up from where they fell, inside the view
    h.body.y = Math.max(h.body.y, w.cam.y - w.cam.vh / 2 + 1.5);
  }
  emit(w, "down", h.body.x, h.body.y + 0.6, h.slot);
}

function stepDown(w: World, h: Hero, inp: PadInput, dt: number) {
  h.downT += dt;
  const b = h.body;
  if (h.down === "wait") {
    if (h.downT > 1.2) reviveAt(w, h, h.checkpoint.x, h.checkpoint.y, true);
    return;
  }
  // co-op bubble: float towards the nearest active hero (or the view's centre); touch or JUMP to pop
  const near = nearestHero(w, b.x);
  const tx = near ? near.body.x - near.facing * 0.7 : w.cam.x, ty = near ? near.body.y + 1.2 : w.cam.y;
  const k = Math.min(1, dt * 1.6);
  b.x += (tx - b.x) * k;
  b.y += (ty - b.y) * k + Math.sin(w.time * 3 + h.slot) * 0.01;
  if (!near) return;
  const touch = h.downT > 1.5 && Math.abs(near.body.x - b.x) < 1.2 && Math.abs(near.body.y - b.y) < 1.6;
  if ((h.downT > 1.2 && inp.jumpPressed) || touch) {
    const spot = !w.col.solidAt(Math.floor(b.x), Math.floor(b.y + 0.5)) && !w.col.solidAt(Math.floor(b.x), Math.floor(b.y + 1));
    if (spot) {
      if (touch) near.stats.revives++;
      reviveAt(w, h, b.x, b.y, false);
      h.body.vy = 7;
    }
  }
}

/** Back in play at (x, y), with full hearts (on a respawn) and a moment of invulnerability. */
export function reviveAt(w: World, h: Hero, x: number, y: number, respawn: boolean) {
  h.down = "";
  h.downT = 0;
  h.body.x = x;
  h.body.y = y;
  h.groundY = y;
  h.body.vx = h.body.vy = 0;
  h.body.grounded = false;
  h.hearts = w.spec.hearts;
  h.inv = 1.6;
  h.state = "air";
  h.loop = null;
  emit(w, "revive", x, y + 0.6, h.slot, respawn ? 1 : 0);
}

/** A standable spot near x inside the view (ground with two free tiles above), or null. */
export function safeSpot(w: World, x: number): { x: number; y: number } | null {
  const top = Math.min(w.level.h - 1, Math.floor(w.cam.y + w.cam.vh / 2));
  const bottom = Math.max(1, Math.floor(w.cam.y - w.cam.vh / 2));
  for (let dx = 0; dx < 12; dx++) {
    const c = Math.floor(x) + dx;
    for (let r = top; r >= bottom; r--) {
      const t = w.col.tile(c, r - 1);
      const stand = w.col.wall(t) || t === Tile.OneWay;
      if (stand && !w.col.solidAt(c, r) && !w.col.solidAt(c, r + 1) && w.col.tile(c, r) === Tile.Empty) return { x: c + 0.5, y: r };
    }
  }
  return null;
}
