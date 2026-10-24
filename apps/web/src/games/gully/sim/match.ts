/**
 * Super Over rules for the gully: two teams, each bats a set number of balls (1–2 overs, 3 balls in quick mode),
 * everyone gets a hit (the striker rotates through the batting team every ball, out batters are skipped), the
 * bowlers rotate too, highest score wins, a tie goes to a bowl-out (3 balls each at the bare brick stack, then
 * sudden death). Pure bookkeeping, no timing: game.ts drives it.
 */
import type { PlayKind } from "./fielding";

export interface Member { id: string; name: string; color: string; cpu: boolean; team: 0 | 1 }

export interface Stats {
  runs: number; balls: number; fours: number; sixes: number; windows: number; dots: number; out: boolean;
  wickets: number; conceded: number; bowled: number; catches: number; perfects: number; bowlout: number;
}

export interface TeamState { name: string; color: string; members: string[]; runs: number; wickets: number; balls: number; extras: number }

export type Wicket = "bowled" | "caught" | "one-bounce" | "runout" | "caught-behind";
export interface BallResult { runs: number; extras: number; wicket: Wicket | null; kind: PlayKind | "wide" | "miss"; bonus: number; catcher?: string | null; perfect?: boolean }

export interface MatchConfig { ballsPerInnings: number; bowlOutBalls: number; maxSuddenDeath: number }

export interface Match {
  cfg: MatchConfig;
  members: Map<string, Member>;
  stats: Map<string, Stats>;
  teams: [TeamState, TeamState];
  /** 0 = first innings, 1 = the chase, 2 = bowl-out, 3 = over. */
  stage: 0 | 1 | 2 | 3;
  batting: 0 | 1;
  firstBat: 0 | 1;
  /** Rotation pointers per team. */
  nextBat: [number, number];
  nextBowl: [number, number];
  /** Bowl-out: deliveries and hits per team. */
  bowlOut: { balls: [number, number]; hits: [number, number]; turn: 0 | 1 };
  winner: 0 | 1 | null;
  /** How the match was decided. */
  decided: "runs" | "wickets" | "bowl-out" | "toss" | null;
  log: Array<{ stage: number; team: 0 | 1; batter: string; bowler: string; result: BallResult }>;
}

export const TEAM_LOOKS: Array<{ name: string; color: string }> = [
  { name: "Mango Street Kings", color: "#ff8a1f" },
  { name: "Lassi Lane Lions", color: "#2fa7ff" },
];

const newStats = (): Stats => ({ runs: 0, balls: 0, fours: 0, sixes: 0, windows: 0, dots: 0, out: false, wickets: 0, conceded: 0, bowled: 0, catches: 0, perfects: 0, bowlout: 0 });

/**
 * Splits players into two teams (alternating, so friends spread out), CPU kids fill each team to the same size
 * (at least 2). `cpuNames` supplies names for the fillers.
 */
export function makeTeams(humans: Array<{ id: string; name: string; color: string }>, cpuNames: string[]): Member[] {
  const size = Math.max(2, Math.ceil(humans.length / 2));
  const out: Member[] = humans.map((h, i) => ({ ...h, cpu: false, team: (i % 2) as 0 | 1 }));
  let c = 0;
  for (const team of [0, 1] as const) {
    while (out.filter((m) => m.team === team).length < size) {
      const name = cpuNames[c % cpuNames.length]!;
      out.push({ id: `cpu${c}`, name, color: "#cccccc", cpu: true, team });
      c++;
    }
  }
  return out;
}

export function newMatch(members: Member[], cfg: MatchConfig, firstBat: 0 | 1 = 0): Match {
  const teams = [0, 1].map((t) => ({ ...TEAM_LOOKS[t]!, members: members.filter((m) => m.team === t).map((m) => m.id), runs: 0, wickets: 0, balls: 0, extras: 0 })) as [TeamState, TeamState];
  return {
    cfg, members: new Map(members.map((m) => [m.id, m])), stats: new Map(members.map((m) => [m.id, newStats()])), teams,
    stage: 0, batting: firstBat, firstBat, nextBat: [0, 0], nextBowl: [0, 0],
    bowlOut: { balls: [0, 0], hits: [0, 0], turn: firstBat === 0 ? 1 : 0 }, winner: null, decided: null, log: [],
  };
}

export const fielding = (m: Match): 0 | 1 => (m.batting === 0 ? 1 : 0);
export const target = (m: Match): number | null => (m.stage === 1 ? m.teams[m.firstBat].runs + 1 : null);
export const ballsLeft = (m: Match): number => m.cfg.ballsPerInnings - m.teams[m.batting].balls;

/** The batter on strike for the next ball: the next not-out member of the batting team, in turn. */
export function striker(m: Match): string {
  const t = m.teams[m.batting];
  for (let k = 0; k < t.members.length; k++) {
    const id = t.members[(m.nextBat[m.batting] + k) % t.members.length]!;
    if (!m.stats.get(id)!.out) return id;
  }
  return t.members[0]!;
}

/** The partner at the bowler's end (the next batter in turn after the striker, or nobody when last man stands). */
export function nonStriker(m: Match): string | null {
  const t = m.teams[m.batting];
  const s = striker(m);
  const i = t.members.indexOf(s);
  for (let k = 1; k < t.members.length; k++) {
    const id = t.members[(i + k) % t.members.length]!;
    if (!m.stats.get(id)!.out) return id;
  }
  return null;
}

/** The bowler for the next ball (rotates through the fielding team; in a bowl-out, through the bowling team). */
export function bowler(m: Match): string {
  const team = m.stage === 2 ? m.bowlOut.turn : fielding(m);
  const t = m.teams[team];
  return t.members[m.nextBowl[team] % t.members.length]!;
}

const notOut = (m: Match, team: 0 | 1) => m.teams[team].members.filter((id) => !m.stats.get(id)!.out).length;

export interface RecordOutcome { inningsOver: boolean; matchOver: boolean; bowlOut: boolean }

/** Records one ball of an innings and moves the rotation on. */
export function recordBall(m: Match, r: BallResult): RecordOutcome {
  if (m.stage > 1) throw new Error("recordBall outside an innings");
  const bat = striker(m), bowl = bowler(m);
  const team = m.teams[m.batting];
  const sb = m.stats.get(bat)!, sw = m.stats.get(bowl)!;
  const total = r.runs + r.extras + r.bonus;
  team.runs += total;
  team.extras += r.extras;
  team.balls++;
  sb.balls++;
  sb.runs += r.runs + r.bonus;
  if (r.kind === "four") sb.fours++;
  if (r.kind === "six" || r.kind === "window") sb.sixes++;
  if (r.kind === "window") sb.windows++;
  if (r.perfect) sb.perfects++;
  if (total === 0 && !r.wicket) sb.dots++;
  sw.bowled++;
  sw.conceded += total;
  if (r.wicket) {
    sb.out = true;
    team.wickets++;
    if (r.wicket !== "runout") sw.wickets++;
    if (r.catcher && m.stats.has(r.catcher)) m.stats.get(r.catcher)!.catches++;
  }
  m.log.push({ stage: m.stage, team: m.batting, batter: bat, bowler: bowl, result: r });
  // everyone gets a hit: next ball, the next batter in turn
  const i = team.members.indexOf(bat);
  m.nextBat[m.batting] = (i + 1) % team.members.length;
  m.nextBowl[fielding(m)]++;

  const chaseWon = m.stage === 1 && team.runs >= target(m)!;
  const over = team.balls >= m.cfg.ballsPerInnings || notOut(m, m.batting) === 0 || chaseWon;
  if (!over) return { inningsOver: false, matchOver: false, bowlOut: false };
  if (m.stage === 0) {
    m.stage = 1;
    m.batting = fielding(m);
    return { inningsOver: true, matchOver: false, bowlOut: false };
  }
  const a = m.teams[m.firstBat].runs, b = team.runs;
  if (a === b) {
    m.stage = 2;
    return { inningsOver: true, matchOver: false, bowlOut: true };
  }
  m.winner = a > b ? m.firstBat : m.batting;
  m.decided = a > b ? "runs" : "wickets";
  m.stage = 3;
  return { inningsOver: true, matchOver: true, bowlOut: false };
}

/** Records one bowl-out delivery (hit = the brick stack fell). Returns true when the bowl-out is decided. */
export function recordBowlOut(m: Match, hit: boolean, toss: () => number = Math.random): boolean {
  if (m.stage !== 2) throw new Error("not in a bowl-out");
  const t = m.bowlOut.turn;
  const who = bowler(m);
  m.bowlOut.balls[t]++;
  if (hit) {
    m.bowlOut.hits[t]++;
    m.stats.get(who)!.bowlout++;
  }
  m.nextBowl[t]++;
  m.bowlOut.turn = t === 0 ? 1 : 0;
  const [b0, b1] = m.bowlOut.balls, [h0, h1] = m.bowlOut.hits;
  const n = m.cfg.bowlOutBalls;
  let winner: 0 | 1 | null = null;
  if (b0 <= n && b1 <= n) {
    // regular rounds: stop as soon as one team cannot catch up
    if (h0 > h1 + (n - b1)) winner = 0;
    else if (h1 > h0 + (n - b0)) winner = 1;
  } else if (b0 === b1 && h0 !== h1) winner = h0 > h1 ? 0 : 1; // sudden death: after each pair
  if (winner === null && b0 === b1 && b0 >= n + m.cfg.maxSuddenDeath) {
    m.winner = toss() < 0.5 ? 0 : 1;
    m.decided = "toss";
    m.stage = 3;
    return true;
  }
  if (winner === null) return false;
  m.winner = winner;
  m.decided = "bowl-out";
  m.stage = 3;
  return true;
}

/** Points per player for the platform's results: winners first, then runs + 10 per wicket + 5 per catch. */
export function playerScores(m: Match): Map<string, number> {
  const out = new Map<string, number>();
  for (const [id, s] of m.stats) out.set(id, s.runs + s.wickets * 10 + s.catches * 5 + s.bowlout * 3);
  return out;
}
