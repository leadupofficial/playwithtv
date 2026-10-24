import type { ControlAction, ControlSpec } from "@playwithtv/protocol";
import type { QLang } from "../../content/trivia/types";
import { LANG_NAME, say } from "./strings";

/**
 * Phone screens for Emoji Dhamaka. Trivia is a buttons game: one huge BUZZ button (the whole pad), then four
 * big answer tiles in the TV's colours and shapes, and a ◀ ▶ slider with ALL IN / LOCK for the final wager.
 * The TV sends each phone the screen for its player and the moment, in that player's language.
 */
export const TITLE = "Emoji Dhamaka";
export const SHAPES = ["▲", "◆", "●", "■"];
export const COLORS = ["#e2384d", "#1f7ae0", "#d99a0b", "#1f9d55"];

const base = (lang: QLang, actions: ControlAction[], stick: ControlSpec["stick"] = "none"): ControlSpec => ({
  title: TITLE,
  modes: ["buttons"],
  stick,
  tilt: "none",
  actions,
  hints: { buttons: say(lang, "buzzNow") },
  calibrate: false,
});

export function langSpec(offered: QLang[], lang: QLang): ControlSpec {
  const tint: Record<QLang, string> = { en: "#7c3aed", ta: "#e2384d", hi: "#d97706" };
  return base(lang, offered.map((l) => ({ id: `lang-${l}`, label: LANG_NAME[l], color: tint[l] })));
}

export function buzzSpec(lang: QLang): ControlSpec {
  return base(lang, [{ id: "buzz", label: say(lang, "pBuzz"), color: "#ff2e63" }]);
}

/** Nothing to press: one calm tile with what is happening. */
export function waitSpec(lang: QLang, text?: string): ControlSpec {
  return base(lang, [{ id: "noop", label: text ?? say(lang, "pWatch"), color: "#2a2463" }]);
}

/** The four answers (some may be hidden: ruled out, or already placed in an order round). */
export function answerSpec(lang: QLang, labels: string[], hide: number[] = [], prefix?: (pos: number) => string): ControlSpec {
  const actions = labels.flatMap((text, pos) => (hide.includes(pos) ? [] : [{
    id: `a${pos}`, label: `${prefix ? prefix(pos) : SHAPES[pos]} ${text}`, color: COLORS[pos],
  }]));
  return base(lang, actions);
}

export function wagerSpec(lang: QLang): ControlSpec {
  return base(lang, [
    { id: "allin", label: say(lang, "pAllIn"), color: "#ff2e63" },
    { id: "lock", label: say(lang, "pLock"), color: "#1f9d55" },
  ], "arrows-h");
}

/** Which language an action picks, if it is a language button. */
export function langOf(action: string): QLang | null {
  const m = /^lang-(en|ta|hi)$/.exec(action);
  return m ? (m[1] as QLang) : null;
}

/** Which answer position an action picks, if it is an answer tile. */
export function posOf(action: string): number | null {
  const m = /^a([0-3])$/.exec(action);
  return m ? Number(m[1]) : null;
}
