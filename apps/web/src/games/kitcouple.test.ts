import { describe, expect, it } from "vitest";
import { CHAPTERS, CoupleMatch, ROUNDS, SPICY, chapterOpen, deal, type Card, type Round } from "./kitcouple/engine";
import { TWO_PATHS } from "./two-paths";
import { MIND_MATCH } from "./mind-match";
import { LANTERN_TRUTHS } from "./lantern-truths";

const TITLES = [TWO_PATHS, MIND_MATCH, LANTERN_TRUTHS];
const NAMES: [string, string] = ["Ana", "Ben"];
const seq = (...v: number[]) => { let i = 0; return () => v[i++ % v.length]!; };

describe("couples decks", () => {
  for (const t of TITLES) {
    describe(t.name, () => {
      it("every chapter can deal a full hand of fresh cards", () => {
        CHAPTERS.forEach((c, i) => {
          const pool = t.cards.filter((k) => c.tones.includes(k.tone));
          expect(pool.length, `${t.name} · ${c.name}`).toBeGreaterThanOrEqual(ROUNDS);
          expect(deal(t.cards, i, Math.random, new Set())).toHaveLength(ROUNDS);
        });
      });
      it("spicy cards only ever appear in the 18+ chapter", () => {
        CHAPTERS.forEach((c, i) => {
          if (c.spicy) return;
          for (let n = 0; n < 20; n++) expect(deal(t.cards, i, Math.random, new Set()).some((r) => r.tone === "spicy")).toBe(false);
        });
        expect(deal(t.cards, SPICY, Math.random, new Set()).every((r) => r.tone === "spicy")).toBe(true);
      });
      it("cards fit the phone buttons, are English and unique", () => {
        const seen = new Set<string>();
        for (const c of t.cards) {
          const text = c.kind === "lantern" ? c.truth + c.dare : c.prompt + c.options.join("");
          expect(text, text).not.toMatch(/[\u0900-\u0DFF]/); // no Indic scripts: the platform is English-only
          expect(seen.has(text), `duplicate: ${text}`).toBe(false);
          seen.add(text);
          if (c.kind !== "lantern") {
            expect(c.options.length).toBeGreaterThanOrEqual(2);
            expect(c.options.length).toBeLessThanOrEqual(4);
          }
        }
      });
      it("has a story per chapter, rewards reachable without the 18+ chapter and a theme for each theme reward", () => {
        expect(t.stories).toHaveLength(CHAPTERS.length);
        const maxSafe = 3 * CHAPTERS.filter((c) => !c.spicy).length;
        for (const r of t.rewards) {
          expect(r.stars).toBeLessThanOrEqual(maxSafe);
          if (r.kind === "theme") expect(t.themes[r.id], r.id).toBeTruthy();
        }
      });
    });
  }
});

describe("chapters", () => {
  it("open in order; After Dark is always listed (its age check is separate)", () => {
    expect(chapterOpen([0, 0, 0, 0, 0], 0)).toBe(true);
    expect(chapterOpen([0, 0, 0, 0, 0], 1)).toBe(false);
    expect(chapterOpen([2, 0, 0, 0, 0], 1)).toBe(true);
    expect(chapterOpen([0, 0, 0, 0, 0], SPICY)).toBe(true);
  });
  it("does not repeat cards within a session until the deck runs out", () => {
    const used = new Set<Card>();
    const anniversary = 3; // 36 cards: room for several hands
    const a = deal(TWO_PATHS.cards, anniversary, Math.random, used);
    const b = deal(TWO_PATHS.cards, anniversary, Math.random, used);
    const key = (r: Round) => JSON.stringify({ ...r, actor: 0 });
    expect(a.some((r) => b.some((x) => key(x) === key(r)))).toBe(false);
    // a small deck that runs out shuffles back in instead of dealing a short hand
    const sweet = new Set<Card>();
    deal(TWO_PATHS.cards, 0, Math.random, sweet);
    expect(deal(TWO_PATHS.cards, 0, Math.random, sweet)).toHaveLength(ROUNDS);
  });
  it("takes turns", () => {
    const r = deal(MIND_MATCH.cards, 0, seq(0.1, 0.9), new Set());
    expect(r.map((x) => x.actor).slice(0, 4)).toEqual([r[0]!.actor, 1 - r[0]!.actor, r[0]!.actor, 1 - r[0]!.actor]);
  });
});

const pick = (prompt = "Q"): Round => ({ kind: "pick", tone: "sweet", prompt, options: ["A", "B"], actor: 0 });
const guess: Round = { kind: "guess", tone: "sweet", prompt: "{S}'s colour?", options: ["Red", "Blue", "Green"], actor: 1 };
const lantern = (actor: 0 | 1): Round => ({ kind: "lantern", tone: "sweet", truth: "Truth for {P}", dare: "Dare {P}", actor });

describe("CoupleMatch", () => {
  it("keeps picks secret until both are in, then reveals and fills a heart on a match", () => {
    const m = new CoupleMatch([pick(), pick("Q2")], NAMES);
    m.act(0, "o1");
    expect(m.step).toBe("ask");
    expect(m.labels(0).o0).toBe(""); // locked in: buttons hidden
    expect(m.waitingOn()).toEqual([1]);
    m.act(0, "o0"); // can't change a locked pick
    expect(m.picks[0]).toBe(1);
    m.act(1, "o1");
    expect(m.step).toBe("reveal");
    expect(m.hearts).toBe(1);
    m.act(1, "o0");
    m.act(0, "o0");
    m.act(1, "o1");
    expect(m.hearts).toBe(1);
    m.act(0, "o0");
    expect(m.step).toBe("done");
  });
  it("ignores options a card doesn't have", () => {
    const m = new CoupleMatch([pick()], NAMES);
    m.act(0, "o3");
    m.act(0, "pass");
    expect(m.picks[0]).toBeNull();
    expect(m.labels(0).o2).toBe("");
  });
  it("guess cards: the partner guessing the subject's answer fills a heart, names fill in", () => {
    const m = new CoupleMatch([guess], NAMES);
    expect(m.fill(guess.prompt)).toBe("Ben's colour?");
    expect(m.labels(0).o2).toMatch(/Green/);
    m.act(1, "o2");
    m.act(0, "o2");
    expect(m.matched()).toBe(true);
    expect(m.hearts).toBe(1);
  });
  it("lantern: only the actor chooses truth or dare; either player can finish or pass", () => {
    const m = new CoupleMatch([lantern(0), lantern(1)], NAMES);
    expect(m.labels(1).o0).toBe("");
    m.act(1, "o1"); // not Ben's turn
    expect(m.choice).toBeNull();
    m.act(0, "o1");
    expect(m.choice).toBe("dare");
    const card = m.round;
    expect(card.kind === "lantern" && m.fill(card.dare)).toBe("Dare Ben");
    m.act(1, "pass"); // the partner can pass the dare too
    expect(m.ended).toBe("pass");
    expect(m.hearts).toBe(0);
    m.act(0, "o0");
    m.act(1, "o0");
    m.act(0, "o0"); // done
    expect(m.hearts).toBe(1);
  });
  it("passing never costs stars beyond the hearts it didn't earn", () => {
    const all = (pass: boolean) => {
      const m = new CoupleMatch([lantern(0), lantern(1), lantern(0), lantern(1)], NAMES);
      for (const r of m.rounds) {
        m.act(r.actor, r === m.rounds[0] ? "o0" : "o1");
        m.act(r.actor, pass && r !== m.rounds[0] && r !== m.rounds[1] ? "pass" : "o0");
        m.act(0, "o0");
      }
      return m;
    };
    expect(all(false).stars()).toBe(3);
    const passed = all(true);
    expect(passed.step).toBe("done");
    expect(passed.passes).toBe(2);
    expect(passed.stars()).toBe(3); // one truth (Ana) and one dare (Ben) done: still all stars
  });
  it("stars follow the heart meter", () => {
    const play = (matches: number) => {
      const m = new CoupleMatch(Array.from({ length: 4 }, () => pick()), NAMES);
      for (let i = 0; i < 4; i++) {
        m.act(0, "o0");
        m.act(1, i < matches ? "o0" : "o1");
        m.act(0, "o0");
      }
      return m.stars();
    };
    expect([play(0), play(2), play(3), play(4)]).toEqual([1, 2, 3, 3]);
  });
});
