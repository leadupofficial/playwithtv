import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { validatePacks, type PackFile } from "./validate";
import { checkSchema } from "./schemaCheck";
import { PACKS, QUESTIONS, offeredLangs, pool, textOf } from "./packs";

const dir = fileURLToPath(new URL("../../../../../content/trivia/", import.meta.url));
const schema = JSON.parse(readFileSync(dir + "schema.json", "utf8"));
const files: PackFile[] = readdirSync(dir).filter((f) => f.endsWith(".json") && f !== "schema.json")
  .map((name) => ({ name, data: JSON.parse(readFileSync(dir + name, "utf8")) }));

const good = () => ({
  id: "t-1", category: "general", difficulty: "easy", type: "mcq", answers: ["a", "b", "c", "d"], correct: 0,
  i18n: { en: { prompt: "Which one?", answers: ["A", "B", "C", "D"] } },
  source: "original", license: "CC0", author: "test", status: "approved", regions: ["global"],
});
const run = (...qs: unknown[]) => validatePacks(schema, [{ name: "t.json", data: { pack: "t", title: "T", questions: qs } }]);

describe("trivia packs in content/trivia", () => {
  it("all pass the content checks", () => {
    const r = validatePacks(schema, files);
    expect(r.errors).toEqual([]);
    expect(r.stats.total).toBeGreaterThanOrEqual(160);
  });

  it("have the seed counts per category and type", () => {
    const q = QUESTIONS;
    expect(q.filter((x) => x.type === "emoji").length).toBeGreaterThanOrEqual(60);
    expect(q.filter((x) => x.category === "movies" && x.type !== "emoji").length).toBeGreaterThanOrEqual(40);
    expect(q.filter((x) => x.category === "general" || (x.category === "music" && x.type !== "emoji")).length).toBeGreaterThanOrEqual(40);
    expect(q.filter((x) => x.category === "sports").length).toBeGreaterThanOrEqual(20);
    expect(q.filter((x) => x.source.startsWith("wikidata:")).every((x) => x.license === "CC0")).toBe(true);
  });

  it("are bundled by the loader and offered in English, Tamil and Hindi", () => {
    expect(PACKS.length).toBe(files.length);
    expect(offeredLangs({ emoji: 12, mcq: 12, order: 2 })).toEqual(["en", "ta", "hi"]);
    expect(pool("ta", { types: ["emoji"] }).length).toBeGreaterThan(40);
  });

  it("fall back to English where a language is a draft or missing", () => {
    const draft = QUESTIONS.find((q) => q.i18n.ta?.status === "mt-draft")!;
    expect(textOf(draft, "ta").lang).toBe("en");
    const hindiFilm = QUESTIONS.find((q) => q.id === "emoji-sholay")!;
    expect(textOf(hindiFilm, "ta").lang).toBe("en");
    expect(textOf(hindiFilm, "hi")).toMatchObject({ lang: "hi", t: { answers: expect.arrayContaining(["शोले"]) } });
  });
});

describe("the content checker", () => {
  it("accepts a good question", () => expect(run(good()).errors).toEqual([]));

  it("rejects media, links and unknown fields", () => {
    expect(run({ ...good(), image: "poster.jpg" }).errors.join()).toMatch(/media\/link field "image"|unexpected field "image"/);
    expect(run({ ...good(), i18n: { en: { prompt: "See https://example.com", answers: ["A", "B", "C", "D"] } } }).errors.join()).toMatch(/link/);
  });

  it("rejects other licences, duplicate ids and duplicate text", () => {
    expect(run({ ...good(), license: "CC-BY-SA-4.0" }).errors.length).toBeGreaterThan(0);
    expect(run(good(), good()).errors.join()).toMatch(/also used/);
    expect(run(good(), { ...good(), id: "t-2", i18n: { en: { prompt: "which  one", answers: ["A", "B", "C", "D"] } } }).errors.join()).toMatch(/duplicates/);
  });

  it("checks emoji clues, order permutations and numbers", () => {
    const emoji = { ...good(), type: "emoji", emoji: ["🦁", "👑", "Lion"] };
    expect(run(emoji).errors.join()).toMatch(/emoji only/);
    expect(run({ ...good(), type: "order", correct: [0, 1, 1, 3] }).errors.join()).toMatch(/permutation/);
    expect(run({ ...good(), type: "order", correct: [1, 0, 2, 3], values: [5, 1, 9, 12] }).errors).toEqual([]);
    expect(run({ ...good(), type: "number" }).errors.join()).toMatch(/must be numbers/);
  });

  it("is a working JSON Schema subset", () => {
    expect(checkSchema(3, { type: "integer", maximum: 2 })).toHaveLength(1);
    expect(checkSchema("x", { oneOf: [{ type: "string" }, { type: "integer" }] })).toEqual([]);
    expect(checkSchema({ a: 1 }, { type: "object", additionalProperties: false, properties: {} })).toHaveLength(1);
  });
});
