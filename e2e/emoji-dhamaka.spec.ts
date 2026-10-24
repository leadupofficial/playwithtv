import { expect, test, type Browser, type Page } from "@playwright/test";
import { hold, joinPhone, press, tvCode } from "./helpers";

const SHAPES = ["▲", "◆", "●", "■"];
type St = {
  phase: string; round: number; kind: string; correct: number | number[]; answers: string[]; buzzer: string | null; room: string;
  players: Record<string, { score: number; bet: number; wager: number; locked: boolean; answered: boolean; wagerLocked: boolean; lang: string }>;
  outcome: { winners: string[]; stealer: string | null; buzzerRight: boolean } | null;
};

async function dhamakaTv(browser: Browser, query = "") {
  const tv = await (await browser.newContext({ viewport: { width: 1280, height: 720 }, ignoreHTTPSErrors: true })).newPage();
  await tv.addInitScript(() => {
    const w = window as unknown as { __csp: string[] };
    w.__csp = [];
    document.addEventListener("securitypolicyviolation", (e) => w.__csp.push(`${e.violatedDirective} ${e.blockedURI}`));
  });
  await tv.goto(`/tv?quick=1${query}`);
  return { tv, code: await tvCode(tv) };
}
const stateOf = (tv: Page) => async (): Promise<St> => JSON.parse((await tv.locator("[data-dhamaka]").getAttribute("data-dhamaka")) || "{}");
async function start(tv: Page) {
  await tv.locator(".game-card", { hasText: "Emoji Dhamaka" }).click();
  await tv.getByRole("button", { name: /Start Emoji Dhamaka/ }).click();
  await expect(tv.locator("[data-checkin]")).toBeVisible({ timeout: 15_000 });
}
async function until(st: () => Promise<St>, ok: (s: St) => boolean, timeout = 20_000) {
  await expect.poll(async () => ok(await st()), { timeout, intervals: [100] }).toBe(true);
  return st();
}
const right = (s: St) => s.correct as number;
const wrongOf = (s: St) => ((s.correct as number) + 1) % 4;
const tiles = (phone: Page) => phone.locator(".game-pad .action");

test("Emoji Dhamaka: three phones play a quick show with a wrong buzz and a steal, an order round, the wager, the podium and a rematch", async ({ browser }) => {
  test.setTimeout(180_000);
  const { tv, code } = await dhamakaTv(browser);
  const ana = await joinPhone(browser, code, "Ana");
  const ben = await joinPhone(browser, code, "Ben");
  const cara = await joinPhone(browser, code, "Cara");
  await start(tv);
  const st = stateOf(tv);

  // check-in: every phone picks its language
  await expect(tiles(ana)).toHaveText(["English", "தமிழ்", "हिन्दी"], { timeout: 10_000 });
  await tv.screenshot({ path: "test-results/dhamaka-checkin.png" });
  await ana.screenshot({ path: "test-results/dhamaka-phone-lang.png" });
  for (const p of [ana, ben, cara]) await press(p, "English");

  // round 1, emoji: Ben buzzes and gets it wrong, Ana steals it
  let s = await until(st, (x) => x.phase === "reveal" && x.round === 0, 25_000);
  await expect(tiles(ben)).toHaveCount(1);
  await tv.waitForTimeout(600); // a second emoji lands
  await tv.screenshot({ path: "test-results/dhamaka-reveal.png" });
  await ben.screenshot({ path: "test-results/dhamaka-phone-buzz.png" });
  await press(ben, "BUZZ");
  s = await until(st, (x) => x.phase === "answer" && x.buzzer === "Ben");
  await expect(tiles(ben)).toHaveCount(4);
  await expect(tiles(ana)).toHaveCount(1); // Ana waits: "Ben buzzed!"
  await tv.screenshot({ path: "test-results/dhamaka-buzzed.png" });
  await ben.screenshot({ path: "test-results/dhamaka-phone-answers.png" });
  await press(ben, SHAPES[wrongOf(s)]!);
  s = await until(st, (x) => x.phase === "steal");
  expect(s.players.Ben!.locked).toBe(true);
  await expect(tiles(ana)).toHaveCount(3); // the wrong answer is gone
  await tv.screenshot({ path: "test-results/dhamaka-steal.png" });
  await press(ana, SHAPES[right(s)]!);
  s = await until(st, (x) => x.phase === "result" && x.round === 0);
  expect(s.outcome).toMatchObject({ stealer: "Ana", buzzerRight: false });
  expect(s.players.Ana!.score).toBe(500);
  await tv.waitForTimeout(400);
  await tv.screenshot({ path: "test-results/dhamaka-result.png" });

  // round 2, fact: everyone answers; speed points
  s = await until(st, (x) => x.phase === "all" && x.round === 1);
  await press(ana, SHAPES[right(s)]!);
  await press(cara, SHAPES[right(s)]!);
  await tv.screenshot({ path: "test-results/dhamaka-fact.png" });
  await press(ben, SHAPES[wrongOf(s)]!);
  s = await until(st, (x) => x.phase === "result" && x.round === 1);
  expect(s.outcome!.winners.sort()).toEqual(["Ana", "Cara"]);
  expect(s.players.Ana!.score).toBeGreaterThan(1000); // speed points plus a 2-in-a-row streak bonus

  // round 3, emoji: Cara buzzes right
  s = await until(st, (x) => x.phase === "reveal" && x.round === 2);
  await press(cara, "BUZZ");
  s = await until(st, (x) => x.phase === "answer" && x.buzzer === "Cara");
  await press(cara, SHAPES[right(s)]!);
  s = await until(st, (x) => x.phase === "result" && x.round === 2);
  expect(s.outcome).toMatchObject({ buzzerRight: true, winners: ["Cara"] });

  // round 4, order: Ana sorts the films (the fourth fills itself in), Ben gets it wrong
  s = await until(st, (x) => x.phase === "all" && x.round === 3);
  expect(s.kind).toBe("order");
  const seq = s.correct as number[];
  await press(ana, s.answers[seq[0]!]!);
  await press(ana, s.answers[seq[1]!]!);
  await tv.screenshot({ path: "test-results/dhamaka-order.png" });
  await ana.screenshot({ path: "test-results/dhamaka-phone-order.png" });
  await press(ana, s.answers[seq[2]!]!);
  for (const i of [seq[3]!, seq[2]!, seq[1]!]) await press(ben, s.answers[i]!);
  await press(cara, s.answers[seq[0]!]!);
  s = await until(st, (x) => x.phase === "result" && x.round === 3, 15_000);
  expect(s.outcome!.winners).toContain("Ana");
  await tv.waitForTimeout(900);
  await tv.screenshot({ path: "test-results/dhamaka-order-result.png" });

  // the leaderboard, then the final wager
  await until(st, (x) => x.phase === "board");
  await tv.waitForTimeout(900);
  await tv.screenshot({ path: "test-results/dhamaka-board.png" });
  s = await until(st, (x) => x.phase === "wager");
  const before = Object.fromEntries(Object.entries(s.players).map(([k, v]) => [k, v.score]));
  await expect(tiles(ben)).toHaveCount(2);
  await hold(ben, ".arrow-right", 700);
  await tv.screenshot({ path: "test-results/dhamaka-wager.png" });
  await ben.screenshot({ path: "test-results/dhamaka-phone-wager.png" });
  await press(ben, "LOCK");
  await press(ana, "ALL IN");
  await press(cara, "LOCK");
  s = await until(st, (x) => x.phase === "all" && x.kind === "final");
  const bets = Object.fromEntries(Object.entries(s.players).map(([k, v]) => [k, v.bet]));
  expect(s.players.Ben!.wager).toBeGreaterThan(0.75); // Ben slid his bet up
  expect(s.players.Cara!.wager).toBe(0.5);          // Cara kept the default half
  await press(ana, SHAPES[right(s)]!);
  await press(ben, SHAPES[wrongOf(s)]!);
  await press(cara, SHAPES[right(s)]!);
  s = await until(st, (x) => x.phase === "result" && x.kind === "final");
  expect(s.players.Ana!.score).toBe(before.Ana! * 2); // all in and right: doubled
  expect(s.players.Ben!.score).toBe(Math.max(0, before.Ben! - bets.Ben!));
  expect(s.players.Cara!.score).toBe(before.Cara! + bets.Cara!);

  // the podium, then the platform's results and a rematch
  await until(st, (x) => x.phase === "podium");
  await expect(ana.getByText(/You won Emoji Dhamaka!|You finished #/)).toBeVisible({ timeout: 3_000 });
  await tv.waitForTimeout(2000);
  await tv.screenshot({ path: "test-results/dhamaka-podium.png" });
  await expect(tv.getByRole("button", { name: /Rematch/ })).toBeVisible({ timeout: 15_000 });
  await tv.getByRole("button", { name: /Rematch/ }).click();
  await expect(tv.locator("[data-checkin]")).toBeVisible({ timeout: 15_000 });
  await expect(tiles(cara)).toHaveText(["English", "தமிழ்", "हिन्दी"], { timeout: 10_000 });
});

test("Emoji Dhamaka in Tamil: the TV speaks Tamil, one phone plays in Tamil and another in English", async ({ browser }) => {
  test.setTimeout(150_000);
  const { tv, code } = await dhamakaTv(browser, "&lang=ta");
  const mani = await joinPhone(browser, code, "Mani");
  const priya = await joinPhone(browser, code, "Priya");
  await start(tv);
  await expect(tv.locator(".dk[lang=ta]")).toContainText("போட்டியாளர்களே");
  await press(mani, "தமிழ்");
  await press(priya, "English");
  const st = stateOf(tv);
  let s = await until(st, (x) => x.phase === "reveal" && x.round === 0, 25_000);
  expect(s).toMatchObject({ room: "ta", players: { Mani: { lang: "ta" }, Priya: { lang: "en" } } });
  await expect(tiles(mani)).toHaveText(["🔔 அழுத்து!"]);
  await expect(tiles(priya)).toHaveText(["🔔 BUZZ!"]);
  await press(mani, "அழுத்து");
  s = await until(st, (x) => x.phase === "answer" && x.buzzer === "Mani");
  await expect(tiles(mani)).toHaveCount(4);
  const tamil = /[஀-௿]/;
  expect(s.answers.some((a) => tamil.test(a))).toBe(true);               // the TV shows the Tamil titles
  expect(await tiles(mani).allTextContents()).toEqual(s.answers.map((a, i) => `${SHAPES[i]} ${a}`));
  await tv.screenshot({ path: "test-results/dhamaka-tamil-buzzed.png" });
  await mani.screenshot({ path: "test-results/dhamaka-tamil-phone.png" });
  await press(mani, SHAPES[right(s)]!);
  s = await until(st, (x) => x.phase === "result");
  expect(s.outcome).toMatchObject({ buzzerRight: true });

  // the fact round: Priya's phone shows the same answers in English
  s = await until(st, (x) => x.phase === "all" && x.round === 1);
  const english = await tiles(priya).allTextContents();
  expect(english.some((t) => tamil.test(t))).toBe(false);
  await tv.screenshot({ path: "test-results/dhamaka-tamil-fact.png" });
  await press(mani, SHAPES[right(s)]!);
  await press(priya, SHAPES[right(s)]!);

  // play on to the end: answer what comes, lock the wagers
  for (let guard = 0; guard < 400; guard++) {
    s = await st();
    if (s.phase === "podium" || s.phase === "over" || (s.phase === "result" && s.kind === "final")) break;
    if (s.phase === "all" && !s.players.Mani!.answered) {
      if (s.kind === "order") for (const i of (s.correct as number[]).slice(0, 3)) await press(mani, s.answers[i]!);
      else await press(mani, SHAPES[right(s)]!);
    }
    if (s.phase === "wager" && !s.players.Mani!.wagerLocked) {
      await press(mani, "உறுதி");
      await press(priya, "LOCK");
    }
    await tv.waitForTimeout(150);
  }
  await until(st, (x) => x.phase === "podium");
  expect(await tv.evaluate(() => (window as unknown as { __csp: string[] }).__csp)).toEqual([]); // fonts, sounds: all allowed
  await expect(mani.getByText(/எமோஜி தமாக்காவில் நீங்கள் வென்றீர்கள்!|இடம்/)).toBeVisible({ timeout: 3_000 });
  await tv.waitForTimeout(2000);
  await tv.screenshot({ path: "test-results/dhamaka-tamil-podium.png" });
  await expect(tv.getByRole("button", { name: /Rematch/ })).toBeVisible({ timeout: 15_000 });
});
