/**
 * Performance budget for EVERY playable game in the catalogue, on the "lite" tier (what a cheap TV gets).
 * A new game is checked the moment it is added: nothing in the game has to cooperate.
 *
 *   pnpm perf            → measure + enforce budgets (CI)
 *   PERF_GAME=kalari-clash pnpm perf   → one game
 *
 * Results land in test-results/perf/<game>.json and are printed as a table at the end.
 * Budgets: docs/performance.md. The game's manifest says which class it is in (perfClass).
 */
import { expect, test, type Browser, type Page } from "@playwright/test";
import { appendFileSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { CATALOG } from "../packages/protocol/src/catalog";
import { overBudget, perfClassOf, type PerfClass } from "../packages/protocol/src/perfBudget";
import { joinPhone, tvCode, type Mode } from "./helpers";
import { perfDownloadKB, perfMarkDownloads, perfProbe, perfSample, type PerfSample } from "./perf";

const OUT = "test-results/perf";
const ONLY = process.env.PERF_GAME;
const REPORT_ONLY = process.env.PERF_REPORT === "1";
const games = CATALOG.filter((g) => g.playable && (!ONLY || g.id === ONLY));

test.describe.configure({ mode: "serial" });
test.afterEach(async ({ browser }) => {
  for (const c of browser.contexts()) await c.close().catch(() => undefined);
});

async function openTv(browser: Browser) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, serviceWorkers: "block" });
  await ctx.addInitScript(perfProbe);
  const tv = await ctx.newPage();
  tv.on("pageerror", (e) => console.log(`[tv page error] ${e.message}`));
  await tv.goto("/tv?quick=1&quality=lite");
  return { tv, code: await tvCode(tv) };
}

/** The game itself is on screen: not the lobby, not the get-ready screen, not still loading. */
const inGame = async (tv: Page) =>
  (await tv.locator(".lobby, [data-tutorial]").count()) === 0 && (await tv.getByText("Loading game…").count()) === 0;

for (const g of games) {
  const cls = perfClassOf(g);
  test(`perf budget: ${g.title} (${cls})`, async ({ browser }) => {
    test.setTimeout(150_000);
    const { tv, code } = await openTv(browser);
    // a buttons phone is "ready" at once, so the get-ready screen ends by itself in quick mode
    const mode: Mode | undefined = g.controlModes?.includes("buttons") ? "buttons" : undefined;
    const phone = await joinPhone(browser, code, "Perf", mode ? { [g.title]: mode } : {});
    // games that need more players (couples: 2) get them, or Start stays disabled
    for (let i = 1; i < (g.minPlayers ?? 1); i++) await joinPhone(browser, code, `Perf${i + 1}`, mode ? { [g.title]: mode } : {});
    await tv.locator(".game-card", { hasText: g.title }).first().click();
    await perfMarkDownloads(tv);
    const started = Date.now();
    await tv.getByRole("button", { name: new RegExp(`Start ${g.title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`) }).click();
    // loaded = the lobby has gone and the game is no longer showing "Loading game…" (the get-ready screen may follow)
    await expect.poll(async () => (await tv.locator(".lobby").count()) === 0 && (await tv.getByText("Loading game…").count()) === 0,
      { timeout: 60_000, intervals: [100] }).toBe(true);
    const loadMs = Date.now() - started;
    await expect.poll(() => inGame(tv), { timeout: 60_000, intervals: [250] }).toBe(true);
    await tv.waitForTimeout(2500); // let the opening camera move / first textures settle
    // the phone holds ▶ so the scene is not just idle (pads without arrows ignore it)
    await phone.locator(".game-pad .arrow-right").first().dispatchEvent("pointerdown", { pointerId: 3 }, { timeout: 1000 }).catch(() => undefined);
    const s: PerfSample & { game: string; perfClass: PerfClass; loadMs: number } = {
      game: g.id, perfClass: cls, loadMs, ...(await perfSample(tv, 6000, await perfDownloadKB(tv))),
    };
    mkdirSync(OUT, { recursive: true });
    writeFileSync(`${OUT}/${g.id}.json`, JSON.stringify(s, null, 2));
    console.log(`perf ${g.id}: ${JSON.stringify(s)}`);
    if (REPORT_ONLY) return;
    expect(s.frames, "the game must draw frames continuously while playing").toBeGreaterThan(30);
    expect(overBudget(s, cls), `${g.title} is over its "${cls}" budget (docs/performance.md)`).toEqual([]);
  });
}

test.afterAll(() => {
  let rows: Array<Record<string, number | string>> = [];
  try {
    rows = readdirSync(OUT).filter((f: string) => f.endsWith(".json")).map((f: string) => JSON.parse(readFileSync(`${OUT}/${f}`, "utf8")));
  } catch { return; }
  const cols = ["game", "perfClass", "loadMs", "downloadKB", "fps", "calls", "callsP95", "tris", "trisP95", "texPeakMB", "scriptMs", "scriptMsP95", "heapMB"];
  const line = (v: Array<string | number>) => v.map((x, i) => String(x).padEnd(i === 0 ? 22 : 10)).join("");
  console.log("\n" + line(cols) + "\n" + rows.map((r) => line(cols.map((c) => r[c] ?? ""))).join("\n"));
  // on GitHub, the same table on the run's summary page
  if (process.env.GITHUB_STEP_SUMMARY) {
    const md = [`| ${cols.join(" | ")} |`, `|${cols.map(() => "---").join("|")}|`, ...rows.map((r) => `| ${cols.map((c) => r[c] ?? "").join(" | ")} |`)];
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Game performance (lite tier)\n\n${md.join("\n")}\n`);
  }
});
