import { describe, expect, it } from "vitest";
import { newGame, step, type Game } from "../sim/game";
import { makeTeams } from "../sim/match";
import { LANE } from "../sim/lane";
import { choreograph, crowdCheers, podium, RUNUP_Z } from "./choreo";
import { freeCamera, liteCamera, replayView, type LaneMeta } from "./director";

const DT = 1 / 60;
const CPU = ["Chintu", "Pinky", "Golu", "Munni"];
const LANE_META: LaneMeta = {
  cameras: {
    broadcast: { position: [0.7, 3.4, -25.5], target: [0, 1, -1.2], fovDeg: 21 },
    shot: { position: [0, 5.6, 5.6], target: [0, 1.3, -17], fovDeg: 44 },
    side: { position: [-3.7, 2.5, -3.6], target: [0.2, 0.95, -0.9], fovDeg: 40 },
  },
  spectators: [], sun: [0.22, -0.55, 0.8],
};

function cpuGame(seed = 5): Game {
  return newGame(makeTeams([], CPU), { ballsPerInnings: 3, bowlOutBalls: 3, maxSuddenDeath: 3 }, { quick: true, seed });
}
function until(g: Game, test: (g: Game) => boolean, maxS = 120) {
  for (let t = 0; t < maxS && !test(g); t += DT) step(g, DT);
}

describe("choreography", () => {
  it("puts the batter at the crease with a bat, the partner at the other end and the bowler at the top of the run-up", () => {
    const g = cpuGame();
    until(g, (s) => s.phase === "aim");
    const a = choreograph(g);
    const batter = a.find((x) => x.role === "batter")!, partner = a.find((x) => x.role === "partner")!, bowler = a.find((x) => x.role === "bowler")!;
    expect(batter.bat).toBe(true);
    expect(batter.z).toBeCloseTo(LANE.batter.z);
    expect(partner.z).toBeCloseTo(LANE.nonStriker.z);
    expect(bowler.z).toBe(RUNUP_Z);
    expect(bowler.bat).toBe(false);
    expect(a.filter((x) => x.role === "fielder" || x.role === "keeper").length).toBe(4);
    expect(new Set(a.map((x) => x.key)).size).toBe(a.length);
  });

  it("the bowler runs in during the run-up and bowls; fielders run to a hit ball", () => {
    const g = cpuGame();
    until(g, (s) => s.phase === "runup" && s.pt > 0.3);
    const b1 = choreograph(g).find((x) => x.role === "bowler")!;
    expect(b1.clip).toBe("run");
    expect(b1.z).toBeGreaterThan(RUNUP_Z);
    until(g, (s) => s.phase === "delivery");
    expect(choreograph(g).find((x) => x.role === "bowler")!.clip).toBe("bowl");
    // find a ball that was fielded on the ground and check someone ran
    for (let k = 0; k < 40; k++) {
      until(g, (s) => s.phase === "play" || s.phase === "podium");
      if (g.phase === "podium") break;
      const p = g.ball!.play!;
      if (p.fielder !== null && p.kind !== "six" && p.kind !== "four") {
        until(g, (s) => s.phase !== "play" || s.ball!.t > 0.8);
        const runners = choreograph(g).filter((x) => x.clip === "run" || x.clip === "pickup" || x.clip === "catch" || x.clip === "cheer");
        expect(runners.length).toBeGreaterThan(0);
        return;
      }
      until(g, (s) => s.phase !== "play");
    }
  });

  it("the podium lines the winners up cheering and sits the rest down", () => {
    const g = cpuGame(9);
    until(g, (s) => s.phase === "podium", 600);
    const a = podium(g);
    const win = g.match.winner!;
    expect(a.filter((x) => x.team === win).every((x) => x.clip === "cheer")).toBe(true);
    expect(a.filter((x) => x.team !== win).every((x) => x.clip === "sit")).toBe(true);
    expect(choreograph(g)).toEqual(a);
    expect(crowdCheers(g)).toBe(true);
  });
});

describe("the director", () => {
  it("cuts: bowler's end for the delivery, the shot camera after the hit, the side angle for replays", () => {
    const g = cpuGame(21);
    until(g, (s) => s.phase === "delivery");
    expect(liteCamera(g)).toBe("broadcast");
    expect(freeCamera(g, LANE_META, null).cut).toBe("broadcast");
    let sawShot = false, sawReplay = false;
    for (let t = 0; t < 300 && g.phase !== "podium"; t += DT) {
      step(g, DT);
      if (g.phase === "play") {
        expect(liteCamera(g)).toBe("shot");
        sawShot = true;
      }
      if (g.phase === "replay") {
        expect(liteCamera(g)).toBe("side");
        const rv = replayView(g);
        expect(rv.ball).not.toBeNull();
        expect(["play", "delivery"]).toContain(rv.phase);
        expect(freeCamera(g, LANE_META, { x: 0, y: 1, z: -1 }).cut).toMatch(/replay/);
        sawReplay = true;
      }
    }
    expect(sawShot).toBe(true);
    expect(sawReplay).toBe(true);
  });

  it("replays run in slow motion from just before the moment", () => {
    const g = cpuGame(21);
    until(g, (s) => s.phase === "replay", 600);
    if (g.phase !== "replay") return;
    const b = g.replayOf!;
    g.pt = 1;
    const early = replayView(g);
    g.pt = 3;
    const later = replayView(g);
    expect(later.ball!.t).toBeGreaterThan(early.ball!.t);
    expect(later.ball!.t - early.ball!.t).toBeLessThan(2); // slower than real time
    expect(b).toBe(g.replayOf);
  });
});
