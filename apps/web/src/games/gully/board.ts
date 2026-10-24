/**
 * What the TV graphics show, derived from the game state (pure): the scoreboard, this innings' balls, the chase
 * equation, the bowl-out tally, and the big words for each moment.
 */
import type { Game } from "./sim/game";
import type { Moment } from "./sim/commentary";
import type { Timing } from "./sim/shot";
import { ballsLeft, target } from "./sim/match";

export interface BoardState {
  phase: Game["phase"];
  batting: 0 | 1;
  teams: Array<{ name: string; color: string; runs: number; wickets: number; balls: number; size: number }>;
  perInnings: number;
  target: number | null;
  need: string | null;
  batter: { name: string; runs: number; balls: number; color: string } | null;
  bowler: { name: string; figures: string; color: string } | null;
  /** This innings, ball by ball: "•", "1", "4", "6", "W", "wd", "8" (window). */
  dots: string[];
  bowlOut: { balls: [number, number]; hits: [number, number]; turn: 0 | 1 } | null;
  stage: number;
  /** Ball type and aim (only when the batter is a CPU: humans must read it off the bowler's hand). */
  aim: { line: number; length: number; kind: string } | null;
  aimingName: string | null;
  replay: boolean;
}

const dot = (kind: string, runs: number, extras: number, bonus: number, wicket: string | null) =>
  wicket ? "W" : kind === "wide" ? "wd" : bonus ? String(runs + bonus) : runs ? String(runs) : "•";

export function boardState(g: Game): BoardState {
  const m = g.match;
  const b = g.ball;
  const name = (id: string | null | undefined) => (id ? m.members.get(id)?.name ?? "?" : "");
  const color = (id: string | null | undefined) => (id ? m.members.get(id)?.color ?? "#ccc" : "#ccc");
  const stage = m.stage;
  const inInnings = stage <= 1;
  const tg = target(m);
  const bt = m.teams[m.batting];
  const left = ballsLeft(m);
  const dots = m.log.filter((l) => l.stage === Math.min(1, stage) && l.team === m.batting).map((l) => dot(l.result.kind, l.result.runs, l.result.extras, l.result.bonus, l.result.wicket));
  const sb = b?.batter ? m.stats.get(b.batter) : null;
  const sw = b ? m.stats.get(b.bowler) : null;
  return {
    phase: g.phase, batting: m.batting, perInnings: m.cfg.ballsPerInnings, target: tg, stage,
    teams: m.teams.map((t) => ({ name: t.name, color: t.color, runs: t.runs, wickets: t.wickets, balls: t.balls, size: t.members.length })),
    need: inInnings && tg !== null ? `Need ${Math.max(0, tg - bt.runs)} off ${left} ball${left === 1 ? "" : "s"}` : null,
    batter: b?.batter && sb ? { name: name(b.batter), runs: sb.runs, balls: sb.balls, color: color(b.batter) } : null,
    bowler: b && sw ? { name: name(b.bowler), figures: `${sw.wickets}-${sw.conceded}`, color: color(b.bowler) } : null,
    dots, bowlOut: stage >= 2 ? { balls: [...m.bowlOut.balls] as [number, number], hits: [...m.bowlOut.hits] as [number, number], turn: m.bowlOut.turn } : null,
    aim: g.phase === "aim" && b && (!b.batter || m.members.get(b.batter)?.cpu) && !m.members.get(b.bowler)?.cpu ? { ...b.aim } : null,
    aimingName: g.phase === "aim" && b ? name(b.bowler) : null,
    replay: g.phase === "replay",
  };
}

export const TIMING_WORDS: Record<Timing, { text: string; color: string }> = {
  perfect: { text: "PERFECT TIMING!", color: "#ffd23f" },
  good: { text: "Good timing", color: "#7be05a" },
  early: { text: "Too early!", color: "#ff9f1c" },
  late: { text: "Late — edged!", color: "#ff9f1c" },
  miss: { text: "Missed it!", color: "#ff6b6b" },
};

export const MOMENT_WORDS: Partial<Record<Moment, { text: string; color: string; big?: boolean }>> = {
  six: { text: "SIX!", color: "#ffd23f", big: true },
  roof: { text: "SIX! OVER THE ROOF", color: "#ffd23f", big: true },
  window: { text: "WINDOW SMASHED! +2", color: "#6fd3ff", big: true },
  four: { text: "FOUR!", color: "#7be05a", big: true },
  bowled: { text: "BOWLED!", color: "#ff4d6d", big: true },
  caught: { text: "CAUGHT!", color: "#ff4d6d", big: true },
  "caught-behind": { text: "CAUGHT BEHIND!", color: "#ff4d6d", big: true },
  "one-bounce": { text: "ONE TIP ONE HAND — OUT!", color: "#ff4d6d", big: true },
  runout: { text: "RUN OUT!", color: "#ff4d6d", big: true },
  drop: { text: "DROPPED!", color: "#ff9f1c" },
  wide: { text: "WIDE +1", color: "#9ad1ff" },
  one: { text: "1 RUN", color: "#ffffff" },
  two: { text: "2 RUNS", color: "#ffffff" },
  three: { text: "3 RUNS", color: "#ffffff" },
  "bowlout-hit": { text: "BRICKS DOWN!", color: "#7be05a", big: true },
  "bowlout-miss": { text: "MISSED!", color: "#ff6b6b" },
};

/** Overs as cricket writes them: 4 balls of 6 = "0.4". */
export const overs = (balls: number) => `${Math.floor(balls / 6)}.${balls % 6}`;
