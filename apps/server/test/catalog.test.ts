import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { BUDGETS, CATALOG, GameManifest, perfClassOf } from "@playwithtv/protocol";

/**
 * Fast catalogue checks that run with the unit tests, before the browser-based budget run (pnpm perf):
 * every manifest is valid, ids are unique, and what a game declares fits its performance class.
 */
const PUBLIC = fileURLToPath(new URL("../../web/public", import.meta.url));
const kbOf = (p: string): number => {
  try {
    const st = statSync(p);
    if (!st.isDirectory()) return st.size / 1024;
    return readdirSync(p).reduce((s, f) => s + kbOf(join(p, f)), 0);
  } catch {
    return 0;
  }
};

describe("game catalogue", () => {
  it("every manifest passes the schema and ids are unique", () => {
    for (const g of CATALOG) expect(GameManifest.safeParse(g).success, g.id).toBe(true);
    expect(new Set(CATALOG.map((g) => g.id)).size).toBe(CATALOG.length);
  });

  it.each(CATALOG.filter((g) => g.playable).map((g) => [g.id, g] as const))("%s declares a download size its class allows", (_, g) => {
    const cls = perfClassOf(g);
    expect(g.estimatedAssetKb, `${g.id} declares ${g.estimatedAssetKb} KB; "${cls}" allows ${BUDGETS[cls].downloadKB} KB`).toBeLessThanOrEqual(BUDGETS[cls].downloadKB);
  });

  it.each(CATALOG.filter((g) => g.playable && g.assetManifest?.length).map((g) => [g.id, g] as const))(
    "%s: files listed in assetManifest exist and fit its class",
    (_, g) => {
      const cls = perfClassOf(g);
      let total = 0;
      for (const a of g.assetManifest ?? []) {
        const kb = kbOf(join(PUBLIC, a.path.replace(/^\//, "")));
        if (a.path.startsWith("/assets/") || a.path.startsWith("/vendor/")) expect(kb, `${g.id}: ${a.path} is missing`).toBeGreaterThan(0);
        total += kb;
      }
      expect(Math.round(total), `${g.id}: its files add up to ${Math.round(total)} KB`).toBeLessThanOrEqual(BUDGETS[cls].downloadKB);
    },
  );
});
