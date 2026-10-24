/**
 * Choreography: where every person on the lane stands, which way they face and what they are doing, derived
 * from the game state alone. Pure, shared by the real-time scene (KayKit characters) and the lite tier (sprites).
 */
import { LANE } from "../sim/lane";
import { fielderAt } from "../sim/fielding";
import type { Game } from "../sim/game";

export type Clip =
  | "idle" | "stance" | "run" | "walk" | "swing" | "defend" | "bowl" | "cheer" | "hit" | "dive" | "catch" | "pickup" | "sit";

/** The KayKit clip for each move (kit3d Character plays these). */
export const CLIP_NAMES: Record<Clip, string> = {
  idle: "Idle", stance: "2H_Melee_Idle", run: "Running_A", walk: "Walking_B", swing: "1H_Melee_Attack_Slice_Horizontal",
  defend: "Block", bowl: "Throw", cheer: "Cheer", hit: "Hit_A", dive: "Dodge_Forward", catch: "Jump_Full_Short", pickup: "PickUp",
  sit: "Sit_Floor_Idle",
};
export const ONCE: ReadonlySet<Clip> = new Set(["swing", "defend", "bowl", "hit", "dive", "catch", "pickup"]);

export type Role = "batter" | "partner" | "bowler" | "fielder" | "keeper";

export interface Actor {
  key: string;
  /** Player id (null for a gully kid filling a fielding spot). */
  id: string | null;
  role: Role;
  team: 0 | 1;
  x: number;
  z: number;
  /** World yaw: forward = (sin h, 0, cos h). */
  heading: number;
  clip: Clip;
  /** Holds the bat (striker and partner). */
  bat: boolean;
}

export const RUNUP_Z = -20.5;
const face = (fx: number, fz: number, tx: number, tz: number) => Math.atan2(tx - fx, tz - fz);
const BIG = new Set(["six", "roof", "window", "four"]);

/** Batters' positions while running `runs` runs (each RUN_T seconds), starting `t0` after the hit. */
function running(t: number, runs: number, out: boolean): { k: number; done: boolean } {
  const RUN_T = 1.7;
  const legs = runs + (out ? 0.5 : 0);
  const k = Math.max(0, Math.min(legs, (t - 0.35) / RUN_T));
  return { k, done: k >= legs };
}

export function choreograph(g: Game): Actor[] {
  const b = g.ball;
  const m = g.match;
  const out: Actor[] = [];
  if (g.phase === "podium" && m.winner !== null) return podium(g);
  if (!b) return out;
  const phase = g.phase;
  const play = b.play;
  const result = b.result;
  const after = phase === "result" || phase === "replay";
  const tPlay = play ? (phase === "play" ? b.t : play.duration) : 0;
  const battingTeam = (b.bowlOut ? (m.bowlOut.turn === 0 ? 1 : 0) : m.batting) as 0 | 1;
  const fieldTeam = (battingTeam === 0 ? 1 : 0) as 0 | 1;

  // --- the batters
  if (b.batter) {
    const sx = LANE.batter.x, sz = LANE.batter.z, px = LANE.nonStriker.x, pz = LANE.nonStriker.z;
    let clip: Clip = "stance", x: number = sx, z: number = sz, heading = Math.PI / 2;
    let px2: number = px, pz2: number = pz, pclip: Clip = "idle", pheading = 0;
    const runs = play && (play.kind === "runs" || play.kind === "runout") ? play.runs : 0;
    const runout = play?.kind === "runout";
    if (b.swing && (phase === "delivery" || (phase === "result" && !play))) clip = b.swing.defend ? "defend" : "swing";
    if (play && (phase === "play" || after)) {
      clip = play.path.length && b.shot?.defended ? "defend" : "swing";
      if (runs || runout) {
        const r = running(tPlay, runs, runout);
        if (r.k > 0) {
          // leg i goes from one end to the other; the striker starts at the batting end
          const leg = Math.floor(r.k), f = r.k - leg;
          const toBowler = leg % 2 === 0;
          const z0 = toBowler ? sz : pz - 0.2, z1 = toBowler ? pz - 0.2 : sz;
          z = z0 + (z1 - z0) * Math.min(1, f);
          x = sx + 0.5;
          heading = toBowler ? Math.PI : 0;
          pz2 = toBowler ? pz + (sz + 0.2 - pz) * Math.min(1, f) : sz + 0.2 + (pz - sz - 0.2) * Math.min(1, f);
          px2 = px - 0.4;
          pheading = toBowler ? 0 : Math.PI;
          clip = r.done ? "idle" : "run";
          pclip = r.done ? "idle" : "run";
          if (r.done && runout) clip = "hit";
        }
      }
      if (play.kind === "six" || play.kind === "window" || play.kind === "four") {
        if (tPlay > Math.min(1.2, play.duration - 0.8)) {
          clip = "cheer";
          pclip = "cheer";
        }
      }
    }
    if (result?.wicket === "bowled" && after) clip = "hit";
    if (result?.wicket && after && (result.wicket === "caught" || result.wicket === "one-bounce" || result.wicket === "caught-behind")) clip = "hit";
    out.push({ key: "batter", id: b.batter, role: "batter", team: battingTeam, x, z, heading, clip, bat: true });
    if (b.partner) out.push({ key: "partner", id: b.partner, role: "partner", team: battingTeam, x: px2, z: pz2, heading: pheading, clip: pclip, bat: true });
  }

  // --- the bowler
  {
    const home = b.fielders[b.fielders.length - 1]!.home;
    let x: number = LANE.release.x, z = RUNUP_Z, clip: Clip = "idle", heading = 0;
    if (phase === "runup") {
      const k = Math.min(1, g.pt / g.timings.runup);
      z = RUNUP_Z + (LANE.bowlerCreaseZ - 0.4 - RUNUP_Z) * k;
      clip = k > 0.7 ? "bowl" : "run";
    } else if (phase === "delivery" || after || phase === "play") {
      z = LANE.bowlerCreaseZ - 0.4;
      clip = "bowl";
      const tSince = phase === "delivery" ? b.t : 9;
      if (tSince > 0.9 || play) {
        // follow through, then field like everyone else
        const idx = b.fielders.length - 1;
        if (play) {
          const f = fielderAt(play, idx, home, tPlay);
          x = f.pos.x;
          z = f.pos.z;
          clip = f.running ? "run" : play.fielder === idx ? (play.kind === "caught" || play.kind === "one-bounce" ? "cheer" : "pickup") : "idle";
          heading = f.running ? face(home.x, home.z, play.fieldAt!.x, play.fieldAt!.z) : face(x, z, 0, 0);
        } else {
          x = home.x * 0.5 + x * 0.5;
          z = LANE.bowlerCreaseZ + 1.2;
          clip = "idle";
        }
      }
    }
    if (b.bowlOut && after) clip = b.moment === "bowlout-hit" ? "cheer" : "idle";
    out.push({ key: "bowler", id: b.bowler, role: "bowler", team: fieldTeam, x, z, heading, clip, bat: false });
  }

  // --- fielders (not in a bowl-out: the lane is cleared)
  if (!b.bowlOut) {
    b.fielders.forEach((f, i) => {
      if (i === b.fielders.length - 1) return; // that's the bowler
      let x = f.home.x, z = f.home.z, clip: Clip = "idle";
      let heading = face(x, z, 0, -1);
      if (play && (phase === "play" || after)) {
        const at = fielderAt(play, i, f.home, tPlay);
        x = at.pos.x;
        z = at.pos.z;
        if (at.running) {
          clip = "run";
          heading = face(f.home.x, f.home.z, play.fieldAt!.x, play.fieldAt!.z);
        } else if (play.fielder === i) {
          const caught = play.kind === "caught" || play.kind === "one-bounce";
          clip = caught ? (tPlay - play.fieldT < 0.8 ? "catch" : "cheer") : "pickup";
        }
      }
      if (after && result?.wicket && play?.fielder !== i) clip = "cheer";
      if (after && result && BIG.has(b.moment ?? "")) clip = "idle";
      out.push({ key: `f${i}`, id: f.id, role: i === 0 ? "keeper" : "fielder", team: fieldTeam, x, z, heading, clip, bat: false });
    });
  }
  return out;
}

/** The end: the winning team in a row in front of the bricks, cheering; the others sit on the kerb. */
export function podium(g: Game): Actor[] {
  const m = g.match;
  const win = m.winner ?? 0;
  const out: Actor[] = [];
  for (const team of [0, 1] as const) {
    const ids = m.teams[team].members;
    ids.forEach((id, i) => {
      if (team === win) {
        const x = (i - (ids.length - 1) / 2) * 1.05;
        out.push({ key: `podium-${id}`, id, role: "fielder", team, x, z: -9.2 - Math.abs(x) * 0.25, heading: Math.PI, clip: "cheer", bat: i === 0 });
      } else {
        const side = i % 2 ? 1 : -1;
        out.push({ key: `podium-${id}`, id, role: "fielder", team, x: side * (3.4 - Math.floor(i / 2) * 0.2), z: -8.4 + Math.floor(i / 2) * 1.0, heading: side > 0 ? -Math.PI / 2 - 0.5 : Math.PI / 2 + 0.5, clip: "sit", bat: false });
      }
    });
  }
  return out;
}

/** Spectator mood: cheering kids on the balconies for the big moments. */
export function crowdCheers(g: Game): boolean {
  const b = g.ball;
  if (!b || !(g.phase === "result" || g.phase === "replay")) return g.phase === "podium" || g.phase === "intro";
  return ["six", "roof", "window", "four", "bowled", "caught", "one-bounce", "caught-behind", "runout", "bowlout-hit"].includes(b.moment ?? "");
}
