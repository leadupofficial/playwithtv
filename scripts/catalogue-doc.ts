/**
 * Writes docs/catalogue.md from the catalogue data (packages/protocol/src/catalog.ts + concepts.ts),
 * so the published list and prioritisation matrix can never drift from what the code ships.
 * Run: pnpm docs:catalogue
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { CATALOG } from "../packages/protocol/src/index.js";

const STATUS: Record<string, string> = { concept: "concept", prototype: "prototype", playable: "**playable**", released: "**released**" };
const CAT: Record<string, string> = {
  "solo-arcade": "A · Solo & arcade", duo: "B · Couples & duo", competitive: "C · Competitive", "coop-adventure": "D · Co-op & adventure", "family-social": "E · Family & social",
};

const rows = [...CATALOG].sort((a, b) => (a.catalogueNo ?? 99) - (b.catalogueNo ?? 99));
const built = rows.filter((g) => g.completionStatus !== "concept");
const lines = [
  "# Game catalogue",
  "",
  "_Generated from the catalogue data by `pnpm docs:catalogue`; do not edit by hand._",
  "",
  "Statuses: **concept** = idea only, hidden from TVs · **prototype** = partly playable · **playable** = complete loop",
  "(objective, motion input, rules, scoring, end state, rematch) with automated tests · **released** = also passed the",
  "real-device controller test ([real-device-test.md](real-device-test.md)).",
  "",
  `Built: ${built.length} · concepts: ${rows.length - built.length}.`,
  "",
  "## Prioritisation matrix",
  "",
  "Phase follows the roadmap: 1 sensor platform validation · 2 launch catalogue · 3 couples & multiplayer · 4 sports, adventure & expansion.",
  "Within a phase, order by validated demand, controller reliability, cost and replay value.",
  "",
  "| No | Game | Category | Players | Phase | Status | Modes | Tests |",
  "|---:|---|---|---|---:|---|---|---|",
  ...rows.map((g) => `| ${g.catalogueNo ?? "–"} | ${g.emoji} ${g.title} | ${CAT[g.category]} | ${g.minPlayers}–${g.maxPlayers} | ${g.phase} | ${STATUS[g.completionStatus]} | ${g.modes.join(", ")} | ${g.automatedTestStatus} |`),
  "",
  "## Built games: motion mappings",
  "",
  ...built.flatMap((g) => [
    `### ${g.emoji} ${g.title}`,
    "",
    g.description,
    "",
    `Hold: **${g.calibrationProfile ?? "any"}** · gyroscope: ${g.sensorRequirements?.gyroscope ?? "unused"} · assets: ${(g.licenceInventory ?? []).map((l) => `${l.asset} (${l.licence})`).join("; ")}`,
    "",
    ...(g.motionMappings ?? []).map((m) => `- **${m.motion}**: ${m.action}`),
    "",
  ]),
];
writeFileSync(fileURLToPath(new URL("../docs/catalogue.md", import.meta.url)), lines.join("\n"));
console.log(`docs/catalogue.md: ${rows.length} games`);
