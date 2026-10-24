/**
 * Checks every trivia pack in content/trivia against content/trivia/schema.json plus the content rules
 * (unique ids, no duplicates, CC0 / CC BY 4.0 only, no media or links). Prints playable counts per language
 * and the mt-draft list that needs a native speaker. Exits 1 on any error.
 * Run: pnpm content:check
 */
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { validatePacks } from "../apps/web/src/content/trivia/validate.js";

const dir = fileURLToPath(new URL("../content/trivia/", import.meta.url));
const schema = JSON.parse(readFileSync(dir + "schema.json", "utf8"));
const files = readdirSync(dir).filter((f) => f.endsWith(".json") && f !== "schema.json").sort().map((name) => {
  try {
    return { name, data: JSON.parse(readFileSync(dir + name, "utf8")) as unknown };
  } catch (e) {
    return { name, data: { invalidJson: String(e) } };
  }
});

const r = validatePacks(schema, files);
console.log(`${files.length} packs, ${r.stats.total} questions`);
console.log("by category:", JSON.stringify(r.stats.byCategory));
for (const [lang, types] of Object.entries(r.stats.playable)) console.log(`playable in ${lang}:`, JSON.stringify(types));
if (r.stats.drafts.length) console.log(`mt-draft (needs native review): ${r.stats.drafts.join(", ")}`);
if (r.warnings.length) console.log(`${r.warnings.length} warnings (e.g. ${r.warnings.slice(0, 3).join("; ")})`);
if (r.errors.length) {
  console.error(`\n${r.errors.length} errors:\n` + r.errors.map((e) => `  ✗ ${e}`).join("\n"));
  process.exit(1);
}
console.log("✓ content ok");
