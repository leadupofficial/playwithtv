/**
 * Fighter movement, swings, knockback, dodges and falling off the bed. Pure functions over the match state;
 * every change worth showing on the TV is returned as an event.
 */
import {
  ACCEL, AIR_FRICTION, ARC, CHARGE_SLOW, CHARGE_TIME, CREDIT_WINDOW, DMG_BASE, DMG_POWER, DODGE_COOLDOWN,
  DODGE_SPEED, DODGE_TIME, EDGE, FEATHER_SLOW, FRICTION, GHOST_COOLDOWN, GHOST_SPEED, GRAVITY, HX, HZ, KB_BASE,
  KB_POWER, MAX_HAZARDS, WOBBLE, MIN_POWER, RADIUS, REACH, ROOM_X, ROOM_Z, SPEED, angleDiff,
  type BrawlEvent, type BrawlInput, type Fighter, type Match,
} from "./rules";

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Windup before the pillow connects, by swing power (a full smash telegraphs itself). */
export const windupTime = (power: number) => 0.07 + 0.16 * power;
const activeTime = 0.1;
const recoverTime = (power: number) => 0.18 + 0.2 * power;

/** Knockback speed a hit of `power` gives `victim` (grows with the victim's wobble %). */
export function knockback(power: number, attacker: Fighter, victim: Fighter): number {
  const wobble = 1 + victim.damage / WOBBLE;
  const bonus = (attacker.underdog ? 1.25 : 1) * (victim.underdog ? 0.85 : 1);
  return (KB_BASE + KB_POWER * power) * wobble * bonus;
}

function setState(f: Fighter, s: Fighter["state"]) {
  f.state = s;
  f.t = 0;
}

export function startSwing(f: Fighter, power: number, ev: BrawlEvent[]) {
  f.power = clamp(power, MIN_POWER, 1);
  f.charge = 0;
  f.queued = 0;
  f.hitDone = false;
  setState(f, "windup");
  ev.push({ kind: "swing", id: f.id, power: f.power });
}

/** The moment a swing connects: everyone in front within reach gets knocked back. */
function resolveSwing(m: Match, f: Fighter, ev: BrawlEvent[]) {
  f.hitDone = true;
  const reach = REACH + 0.4 * f.power;
  let landed = false;
  for (const o of m.fighters) {
    if (o === f || !o.alive || o.state === "dodge" || o.state === "fall") continue;
    const dx = o.x - f.x, dz = o.z - f.z;
    const d = Math.hypot(dx, dz);
    if (d > reach) continue;
    const dir = Math.atan2(dx, dz);
    if (d > 0.9 && Math.abs(angleDiff(dir, f.face)) > ARC) continue;
    landed = true;
    const kb = knockback(f.power, f, o);
    const nx = d > 1e-3 ? dx / d : Math.sin(f.face), nz = d > 1e-3 ? dz / d : Math.cos(f.face);
    o.vx = nx * kb;
    o.vz = nz * kb;
    o.vy = 2.5 + 5 * f.power;
    o.damage += DMG_BASE + DMG_POWER * f.power;
    o.stun = 0.18 + 0.28 * f.power + o.damage / 500;
    o.charge = 0;
    o.lastHitBy = f.id;
    o.lastHitAt = m.time;
    o.face = Math.atan2(-nx, -nz); // turns to face the hitter (a better reaction)
    setState(o, "hit");
    f.combo = f.comboT > 0 ? f.combo + 1 : 1;
    f.comboT = 1.6;
    const smash = f.power >= 0.8;
    f.stats.hits++;
    if (smash) f.stats.smashes++;
    f.stats.feathers += 3 + Math.round(9 * f.power);
    f.stats.bestHit = Math.max(f.stats.bestHit, Math.round(kb * 10) / 10);
    ev.push({ kind: "hit", by: f.id, on: o.id, power: f.power, kb, x: o.x, z: o.z, combo: f.combo, smash });
  }
  if (!landed) ev.push({ kind: "whiff", id: f.id });
}

/** One fixed step for a fighter still on the bed. */
export function updateFighter(m: Match, f: Fighter, inp: BrawlInput, dt: number, ev: BrawlEvent[]) {
  f.t += dt;
  f.cooldown = Math.max(0, f.cooldown - dt);
  f.dodgeCd = Math.max(0, f.dodgeCd - dt);
  f.comboT = Math.max(0, f.comboT - dt);
  if (f.comboT === 0) f.combo = 0;
  const mag = Math.hypot(inp.x, inp.z);
  const mx = mag > 1 ? inp.x / mag : inp.x, mz = mag > 1 ? inp.z / mag : inp.z;
  const canAct = f.state === "ok" || f.state === "charge";

  // dodge: a quick dash (cancels a charge), invulnerable while dashing
  if (inp.dodge && canAct && f.dodgeCd === 0) {
    const a = mag > 0.25 ? Math.atan2(mx, mz) : f.face;
    f.dodgeX = Math.sin(a);
    f.dodgeZ = Math.cos(a);
    f.face = a;
    f.charge = 0;
    f.dodgeCd = DODGE_COOLDOWN;
    f.stats.dodges++;
    setState(f, "dodge");
    ev.push({ kind: "dodge", id: f.id });
  }

  // swings: hold to charge, let go to swing; or an instant swing (tap / push gesture), buffered while busy
  if (inp.swing > 0 && f.state !== "charge") { f.queued = inp.swing; f.queuedT = 0.3; }
  f.queuedT = Math.max(0, f.queuedT - dt);
  if (f.queuedT === 0) f.queued = 0;
  if (f.state === "ok" && f.queued > 0 && f.cooldown === 0) {
    startSwing(f, f.queued, ev);
    f.queued = 0;
  }
  else if (f.state === "ok" && inp.charge && f.cooldown === 0) { setState(f, "charge"); f.charge = 0; }
  else if (f.state === "charge") {
    const before = f.charge;
    f.charge = Math.min(1, f.charge + dt / CHARGE_TIME);
    if (before < 1 && f.charge >= 1) ev.push({ kind: "charge-full", id: f.id });
    if (inp.swing > 0) startSwing(f, Math.max(inp.swing, f.charge), ev);
    else if (!inp.charge) startSwing(f, f.charge, ev);
  }
  if (f.state === "windup" && f.t >= windupTime(f.power)) setState(f, "swing");
  if (f.state === "swing") {
    if (!f.hitDone) resolveSwing(m, f, ev);
    if (f.t >= activeTime + recoverTime(f.power)) {
      setState(f, "ok");
      f.cooldown = 0.12;
    }
  }
  if (f.state === "hit") {
    f.stun -= dt;
    if (f.stun <= 0 && f.y <= 0) setState(f, "ok");
  }

  // movement
  const grounded = f.y <= 0;
  if (f.state === "dodge") {
    f.vx = f.dodgeX * DODGE_SPEED;
    f.vz = f.dodgeZ * DODGE_SPEED;
    if (f.t >= DODGE_TIME) {
      f.vx *= 0.3;
      f.vz *= 0.3;
      setState(f, "ok");
    }
  } else if (f.state === "hit" || !grounded) {
    const k = Math.exp(-(grounded ? FRICTION : AIR_FRICTION) * dt);
    f.vx *= k;
    f.vz *= k;
  } else {
    let speed = SPEED * (f.state === "charge" ? CHARGE_SLOW : f.state === "windup" || f.state === "swing" ? 0.25 : 1);
    if (f.slowed > 0) speed *= FEATHER_SLOW;
    const tx = mx * speed, tz = mz * speed;
    // knockback already sliding faster than you run fades with friction rather than stopping dead
    const fast = Math.hypot(f.vx, f.vz) > SPEED * 1.15;
    const k = fast ? 1 - Math.exp(-FRICTION * dt) : Math.min(1, ACCEL * dt);
    f.vx += (tx - f.vx) * k;
    f.vz += (tz - f.vz) * k;
  }
  if (mag > 0.2 && (f.state === "ok" || f.state === "charge")) {
    const want = Math.atan2(mx, mz);
    f.face += angleDiff(want, f.face) * Math.min(1, 18 * dt);
  }
  f.slowed = Math.max(0, f.slowed - dt);
  f.x += f.vx * dt;
  f.z += f.vz * dt;
  if (f.z < -HZ) { // the headboard pillows: bounce back softly
    f.z = -HZ;
    if (f.vz < 0) f.vz = -f.vz * 0.45;
  }
  if (!grounded || f.vy > 0) {
    f.vy -= GRAVITY * dt;
    f.y += f.vy * dt;
    if (f.y <= 0) {
      if (f.vy < -7) ev.push({ kind: "land", id: f.id, hard: f.vy < -12 });
      f.y = 0;
      f.vy = 0;
    }
  }
}

/** Has this fighter gone over the edge of the mattress? */
export function offBed(f: Fighter): boolean {
  return Math.abs(f.x) > HX + EDGE || f.z > HZ + EDGE;
}

/** Off the bed: falls towards the floor; credit goes to the last hitter (if recent). */
export function knockOff(m: Match, f: Fighter, ev: BrawlEvent[]) {
  f.alive = false;
  setState(f, "fall");
  f.vy = Math.max(f.vy, 3);
  f.charge = 0;
  f.stats.falls++;
  const by = f.lastHitBy && m.time - f.lastHitAt < CREDIT_WINDOW ? f.lastHitBy : null;
  if (by) {
    const k = m.fighters.find((o) => o.id === by);
    if (k) k.stats.kos++;
  }
  const first = !m.firstOutDone;
  if (first) {
    m.firstOutDone = true;
    f.stats.firstOuts++;
  }
  const last = m.fighters.filter((o) => o.alive).length <= 1;
  if (last) m.lastKoAt = m.time;
  ev.push({ kind: "fall", id: f.id, by, first, last });
}

/** A fallen fighter tumbles down, then floats back up as a little ghost. */
export function updateFalling(f: Fighter, dt: number, ev: BrawlEvent[]) {
  f.t += dt;
  f.vy -= GRAVITY * dt;
  f.y += f.vy * dt;
  f.x += f.vx * dt * 0.6;
  f.z += f.vz * dt * 0.6;
  if (f.t > 1.3) {
    setState(f, "ghost");
    f.y = 0;
    f.vx = f.vz = f.vy = 0;
    f.x = clamp(f.x, -ROOM_X, ROOM_X);
    f.z = clamp(f.z, -ROOM_Z, ROOM_Z);
    f.ghostCd = 1;
    ev.push({ kind: "ghost", id: f.id });
  }
}

/** Ghosts float anywhere and drop feathers (slow) or socks (slippy) on the bed with SWING. */
export function updateGhost(m: Match, f: Fighter, inp: BrawlInput, dt: number, ev: BrawlEvent[]) {
  f.t += dt;
  f.ghostCd = Math.max(0, f.ghostCd - dt);
  const k = Math.min(1, 8 * dt);
  f.vx += (inp.x * GHOST_SPEED - f.vx) * k;
  f.vz += (inp.z * GHOST_SPEED - f.vz) * k;
  f.x = clamp(f.x + f.vx * dt, -ROOM_X, ROOM_X);
  f.z = clamp(f.z + f.vz * dt, -ROOM_Z, ROOM_Z);
  if (Math.hypot(inp.x, inp.z) > 0.2) f.face = Math.atan2(inp.x, inp.z);
  if (m.phase !== "fight" || f.ghostCd > 0 || !(inp.swing > 0 || inp.charge)) return;
  if (Math.abs(f.x) > HX - 0.3 || Math.abs(f.z) > HZ - 0.3) return; // only over the bed
  const kind = f.ghostDrops % 2 === 0 ? "sock" : "feathers";
  f.ghostDrops++;
  f.ghostCd = GHOST_COOLDOWN;
  f.stats.hazards++;
  m.hazards.push({ id: m.nextId++, kind, x: f.x, z: f.z, age: 0, life: kind === "sock" ? 10 : 7, by: f.id });
  while (m.hazards.length > MAX_HAZARDS) m.hazards.shift();
  ev.push({ kind: "hazard", by: f.id, hazard: kind, x: f.x, z: f.z });
}

/** Fighters on the bed push each other apart instead of overlapping. */
export function separate(m: Match) {
  const fs = m.fighters;
  for (let i = 0; i < fs.length; i++) {
    const a = fs[i]!;
    if (!a.alive) continue;
    for (let j = i + 1; j < fs.length; j++) {
      const b = fs[j]!;
      if (!b.alive) continue;
      const dx = b.x - a.x, dz = b.z - a.z;
      const d = Math.hypot(dx, dz);
      if (d >= RADIUS * 2 || d < 1e-6) continue;
      const push = (RADIUS * 2 - d) / 2;
      a.x -= (dx / d) * push;
      a.z -= (dz / d) * push;
      b.x += (dx / d) * push;
      b.z += (dz / d) * push;
    }
  }
}
