import { mkdirSync, writeFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { joinPhone, tvCode } from "./helpers";

/**
 * Opens every playable game in the catalogue one after another on one TV with two phones, and checks each one
 * actually shows something: no page errors, no console errors, no stuck "Loading game…", no empty page. Then
 * the captain ends the game from the phone and the TV must be back in the lobby. Screenshots and a JSON line
 * per game land in test-results/smoke/ (scripts look at the pixels to catch an all-black / all-white TV).
 */
const OUT = "test-results/smoke";

test("every game opens without errors or a blank screen", async ({ browser, request }) => {
  const games = ((await (await request.get("/api/games")).json()) as { games?: Array<{ id: string; title: string; playable: boolean }> } | Array<{ id: string; title: string; playable: boolean }>);
  const list = (Array.isArray(games) ? games : games.games ?? []).filter((g) => g.playable);
  const only = process.env.SMOKE_ONLY?.split(",");
  const todo = only ? list.filter((g) => only.includes(g.id)) : list;
  test.setTimeout(60_000 + todo.length * 40_000);
  mkdirSync(OUT, { recursive: true });

  const tv = await (await browser.newContext({ viewport: { width: 1280, height: 720 }, ignoreHTTPSErrors: true })).newPage();
  let errors: string[] = [];
  tv.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  // Cloudflare's analytics beacon is injected by the CDN and blocked by our CSP: noise, not a game error
  tv.on("console", (m) => { if (m.type() === "error" && !/cloudflareinsights|sha256-7Wl0pyEKpJdlZWzFHkiU26sl9v/.test(m.text())) errors.push(`console: ${m.text()}`); });
  tv.on("response", (r) => { if (r.status() >= 400 && !r.url().includes("/api/ads")) errors.push(`http ${r.status()}: ${r.url()}`); });
  await tv.goto("/tv?quick=1");
  const code = await tvCode(tv);
  const ana = await joinPhone(browser, code, "Ana");
  await joinPhone(browser, code, "Ben");
  await expect(tv.locator(".player", { hasText: "Ben" })).toBeVisible({ timeout: 15_000 });

  const results: Array<Record<string, unknown>> = [];
  for (const g of todo) {
    errors = [];
    const r: Record<string, unknown> = { id: g.id, title: g.title };
    try {
      const card = tv.locator(".game-card", { hasText: g.title }).first();
      await card.click({ timeout: 10_000 });
      await tv.getByRole("button", { name: new RegExp(`Start ${g.title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i") }).click({ timeout: 10_000 });
      const t0 = Date.now();
      // the game's own screen replaces the lobby
      await expect(tv.locator(".tv-header")).toHaveCount(0, { timeout: 10_000 });
      await expect(tv.getByText("Loading game…")).toHaveCount(0, { timeout: 15_000 });
      r.openMs = Date.now() - t0;
      await tv.waitForTimeout(1500);
      await tv.screenshot({ path: `${OUT}/${g.id}-ready.png` });
      // skip the practice screen the way a TV remote does (OK), so the game itself has to draw
      await tv.keyboard.press("Enter");
      await tv.waitForTimeout(4000);
      r.dom = await tv.evaluate(() => {
        const root = document.getElementById("root")!;
        const vis = [...root.querySelectorAll("*")].filter((e) => { const b = e.getBoundingClientRect(); return b.width > 4 && b.height > 4; });
        const canvases = [...root.querySelectorAll("canvas")].map((c) => `${c.width}x${c.height}`);
        return { visible: vis.length, text: root.innerText.trim().slice(0, 120).replace(/\s+/g, " "), canvases };
      });
      await tv.screenshot({ path: `${OUT}/${g.id}.png` });
      // end it from the captain's phone
      await ana.getByRole("button", { name: "End the game", exact: true }).click({ timeout: 10_000 });
      await ana.getByRole("button", { name: "End game", exact: true }).click({ timeout: 5_000 });
      await expect(tv.locator(".tv-header")).toBeVisible({ timeout: 10_000 });
      r.backToLobby = true;
    } catch (e) {
      r.fail = String(e).split("\n")[0];
      await ana.screenshot({ path: `${OUT}/${g.id}-phone.png` }).catch(() => undefined);
      await tv.screenshot({ path: `${OUT}/${g.id}.png` }).catch(() => undefined);
      // get back to the lobby for the next game
      await ana.getByRole("button", { name: "End the game", exact: true }).click({ timeout: 3_000 }).catch(() => undefined);
      await ana.getByRole("button", { name: "End game", exact: true }).click({ timeout: 3_000 }).catch(() => undefined);
      await tv.locator(".tv-header").waitFor({ timeout: 10_000 }).catch(() => undefined);
    }
    r.errors = [...new Set(errors)].slice(0, 8);
    results.push(r);
    writeFileSync(`${OUT}/results.json`, JSON.stringify(results, null, 1));
  }
  const bad = results.filter((r) => r.fail || (r.errors as string[]).length);
  expect(bad.map((r) => `${r.id}: ${r.fail ?? ""} ${(r.errors as string[]).join(" | ")}`)).toEqual([]);
});
