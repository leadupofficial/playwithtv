import { GOAL_HALF, HALF_W, PUCK_R, STRIKER_R, home, predictY, rand, type Command, type Table } from "./engine";

/**
 * The CPU opponent, pure. It reacts a beat late, moves slower than a finger can, and its shots wander a
 * little, so a player who keeps the puck moving can beat it; but it defends its goal and punishes a puck
 * left sitting in its half.
 */
export interface Brain {
  side: 0 | 1;
  /** Seconds until it looks at the table again (reaction time). */
  think: number;
  plan: Command;
  /** Where in the goal it is aiming this attack. */
  aimY: number;
  speed: number;
  reaction: number;
  /** Reads rail bounces when defending (the CPU does not, so bank shots beat it). */
  readsBanks: boolean;
  /** Chance of playing a bank shot off a rail when attacking. */
  bankChance: number;
  /** Defensive misjudgement, table units. */
  error: number;
  bank: number;
  mode: "defend" | "attack" | "home";
}

export function newBrain(side: 0 | 1 = 1, level = 1): Brain {
  return {
    side, think: 0, plan: { kind: "target", ...home(side) }, aimY: 0,
    speed: 1.45 + 0.35 * level, reaction: 0.16 - 0.04 * level, mode: "home",
    readsBanks: false, bankChance: 0.3, error: 0.07, bank: 0,
  };
}

export function cpuCommand(t: Table, b: Brain, dt: number): Command {
  b.think -= dt;
  if (b.think > 0 || t.phase !== "play") return t.phase === "goal" ? { kind: "target", ...home(b.side), speed: b.speed } : b.plan;
  b.think = b.reaction;
  const me = t.strikers[b.side];
  const p = t.puck;
  const dir = b.side === 0 ? 1 : -1;          // towards the opponent's goal
  const ownGoalX = b.side === 0 ? -1 : 1;
  const inMyHalf = b.side === 0 ? p.x < 0 : p.x > 0;
  const comingAtMe = p.vx * dir < -0.1;
  const behind = (p.x - me.x) * dir < -0.02;  // the puck has got past the striker, towards our goal
  let x: number, y: number;
  if (inMyHalf && behind) {
    // get back between the puck and the goal, going round it
    b.mode = "defend";
    x = ownGoalX + dir * 0.14;
    y = Math.max(-GOAL_HALF, Math.min(GOAL_HALF, p.y + (p.y > me.y ? -0.12 : 0.12)));
  } else if (inMyHalf && !(comingAtMe && Math.abs(p.vx) > 0.6)) {
    // attack: come from behind the puck, along the line to the opponent's goal, and drive through it
    if (b.mode !== "attack") {
      b.aimY = (rand(t) - 0.5) * GOAL_HALF * 1.6;
      b.bank = rand(t) < b.bankChance ? (p.y >= 0 ? -1 : 1) : 0;
    }
    b.mode = "attack";
    const lead = 0.12;                           // where the puck will be when we get there
    const qx = p.x + p.vx * lead, qy = Math.max(-HALF_W + PUCK_R, Math.min(HALF_W - PUCK_R, p.y + p.vy * lead));
    const gx = -ownGoalX;
    // a bank shot aims at the goal's mirror image beyond a rail
    const gy = b.bank === 0 ? b.aimY : b.bank * 2 * (HALF_W - PUCK_R) - b.aimY;
    const ax = gx - qx, ay = gy - qy, ad = Math.hypot(ax, ay) || 1;
    const ux = ax / ad, uy = ay / ad;
    const reach = STRIKER_R + PUCK_R;
    const lx = qx - ux * (reach + 0.04), ly = qy - uy * (reach + 0.04);
    const ahead = (me.x - qx) * ux + (me.y - qy) * uy;               // > 0: we are on the wrong side of the puck
    if (Math.hypot(me.x - lx, me.y - ly) < 0.07) { x = qx + ux * 0.25; y = qy + uy * 0.25; }   // strike through it
    else if (ahead > -reach * 0.5) {
      // go round the puck instead of knocking it backwards
      const side = (me.x - qx) * -uy + (me.y - qy) * ux >= 0 ? 1 : -1;
      x = qx - ux * reach * 0.6 - uy * side * (reach + 0.07);
      y = qy - uy * reach * 0.6 + ux * side * (reach + 0.07);
    } else { x = lx; y = ly; }                                        // line up behind it
  } else if (comingAtMe) {
    // defend: meet the puck on its predicted line in front of the goal
    b.mode = "defend";
    const lineX = ownGoalX + dir * 0.22;
    const naive = p.y + (p.vy * (lineX - p.x)) / (p.vx || 1e-6);
    const py = b.readsBanks ? (predictY(p, lineX) ?? p.y) : naive;
    const miss = (rand(t) - 0.5) * 2 * b.error * (1 + Math.hypot(p.vx, p.vy) / 1.5);
    x = lineX;
    y = Math.max(-HALF_W + STRIKER_R, Math.min(HALF_W - STRIKER_R, py + miss));
  } else {
    b.mode = "home";
    x = home(b.side).x;
    y = p.y * 0.45;
  }
  b.plan = { kind: "target", x, y, speed: b.speed };
  return b.plan;
}
