/**
 * Tiffin Tornado: what each phone shows and feels, and the sounds and banners for each game event.
 * The ACTION button's label is the context verb (✋ PICK, 🔪 CHOP, 🍳 FLIP, 🛎️ SERVE…), updated live.
 */
import type { ControlPlayers } from "../controlKit";
import type { GameBridge } from "../types";
import type { Ev, Match } from "./engine";
import { verbFor } from "./engine";
import { VERB_ICON, type Verb } from "./interact";
import { ITEM_NAME, RECIPES } from "./recipes";
import type { TiffinAudio } from "./audio";

const VERB_WORD: Record<Verb, string> = {
  pick: "PICK UP", place: "PUT DOWN", plate: "PLATE IT", scoop: "SCOOP", chop: "CHOP!", grind: "GRIND!", wash: "WASH!", flip: "FLIP!",
  serve: "SERVE", douse: "PUT OUT", trash: "BIN IT", drop: "DROP", none: "ACTION",
};

export function phoneStatus(kit: ControlPlayers, m: Match, id: string) {
  const c = m.chefs.find((x) => x.id === id);
  if (!c) return;
  const verb = verbFor(m, id);
  const holding = c.holding ? (c.holding.kind === "plate" && c.holding.parts?.length ? `Plate: ${c.holding.parts.join(" + ")}` : ITEM_NAME[c.holding.kind]) : "empty hands";
  const text = m.phase === "service" ? `${VERB_ICON[verb]} ${VERB_WORD[verb]} · holding ${holding}` : m.phase === "levelEnd" ? "Service over!" : m.phase === "results" ? "Trip complete!" : `Service ${m.levelIndex + 1}: ${m.level.name}`;
  kit.status(id, {
    text,
    labels: { act: `${VERB_ICON[verb]} ${VERB_WORD[verb]}` },
    bars: m.phase === "service" ? [{ label: "Time", value: Math.max(0, 1 - m.t / m.seconds), color: "#ffb43a" }] : [],
  });
}

/** Sounds, phone buzzes and TV banners for one event. */
export function feedback(e: Ev, m: Match, audio: TiffinAudio, bridge: GameBridge, kit: ControlPlayers, banner: { text: string; tone: "warn" | "dark" | "info"; until: number }, now: number) {
  const buzz = (id: string, ms: number) => bridge.event(id, "vibrate", { ms });
  const all = (ms: number) => m.chefs.forEach((c) => buzz(c.id, ms));
  const say = (text: string, tone: "warn" | "dark" | "info", ms: number) => Object.assign(banner, { text, tone, until: now + ms });
  switch (e.kind) {
    case "phase":
      if (e.phase === "intro") audio.horn(e.level === 0 ? 1.4 : 0.8);
      if (e.phase === "countdown") audio.play(m.quick ? "go" : "n3");
      if (e.phase === "service") { audio.play("go"); all(80); }
      if (e.phase === "levelEnd") { audio.play("timeover"); all(200); }
      break;
    case "act": {
      const s: Partial<Record<Verb, string>> = { pick: "pick", place: "place", plate: "place", scoop: "pick", chop: "chop", grind: "grind", wash: "soft", trash: "place", drop: "place", douse: "soft" };
      if (e.verb === "flip") { audio.play("dash", 0.8, 1.4); if (e.perfect) { audio.play("glass", 0.6, 1.3); buzz(e.id, 40); kit.toast(e.id, "🌟 Perfect flip!", "good"); } }
      else if (s[e.verb]) audio.play(s[e.verb]!, 0.7, e.verb === "chop" ? 0.9 + Math.random() * 0.3 : 1);
      if (e.what === "chutney") kit.toast(e.id, "🥥 Chutney ready!", "good");
      break;
    }
    case "dash":
      audio.play("dash", 0.5);
      break;
    case "serve":
      audio.bell();
      buzz(e.id, 90);
      kit.toast(e.id, `🛎️ ${RECIPES[e.recipe].name} +${e.points + e.tip + e.bonus}`, "good");
      break;
    case "reject":
      audio.play("wrong", 0.6);
      buzz(e.id, 160);
      kit.toast(e.id, "No ticket wants that!", "bad");
      break;
    case "order":
      audio.play("ticket", 0.4, 1.2);
      break;
    case "expire":
      audio.play("wrong", 0.7, 0.8);
      all(180);
      say(`⌛ ${RECIPES[e.order.recipe].name} missed!`, "warn", 2200);
      break;
    case "station":
      if (e.what === "done") audio.play("tick", 0.6, 1.3);
      if (e.what === "burnt") audio.play("soft", 0.8, 0.7);
      if (e.what === "fire" || e.what === "spread") { audio.play("crash", 0.7, 0.7); all(250); say("🔥 FIRE! Grab water from the matka 💧", "warn", 3500); }
      break;
    case "fall":
      audio.play("crash", 0.8, e.item === "plate" ? 1.3 : 1);
      break;
    case "curve":
      audio.horn(0.6);
      say("⚠️ CURVE AHEAD! Hold on to your plates!", "warn", 3200);
      all(120);
      break;
    case "tunnel":
      if (e.dark) say("🌑 TUNNEL! Lights out…", "dark", 2600);
      break;
    case "doors":
      audio.play("crash", 0.5, 0.6);
      if (!e.shut) say("🚂 Doors open, all aboard!", "info", 2200);
      break;
  }
}
