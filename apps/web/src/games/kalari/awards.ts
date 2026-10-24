/** End-of-match awards: the champion plus whoever stood out (pure, from the match stats). */
import { standings } from "./engine";
import type { Match } from "./rules";

export interface Award { emoji: string; title: string; detail: string; playerId: string }

export function awards(m: Match): Award[] {
  const top = standings(m);
  const out: Award[] = [];
  if (m.mode === "guardians" && top[0]) {
    const cleared = top[0].stats.roundWins;
    out.push({ emoji: "🛡", title: "Top Guardian", detail: `${top[0].stats.style} style · ${cleared} wave${cleared === 1 ? "" : "s"} cleared`, playerId: top[0].id });
  } else if (top[0] && top[0].stats.roundWins > 0) out.push({ emoji: "👑", title: "Kalari Champion", detail: `${top[0].stats.roundWins} round${top[0].stats.roundWins === 1 ? "" : "s"} won`, playerId: top[0].id });
  const best = (pick: (s: Match["fighters"][number]["stats"]) => number, min: number) => {
    let who = null as Match["fighters"][number] | null;
    for (const f of m.fighters) if (pick(f.stats) >= min && (!who || pick(f.stats) > pick(who.stats))) who = f;
    return who;
  };
  const ring = best((s) => s.ringouts, 1);
  if (ring) out.push({ emoji: "🌊", title: "Ring-Out Royalty", detail: `${ring.stats.ringouts} sent flying off the edge`, playerId: ring.id });
  const guard = best((s) => s.parries * 3 + s.blocks, 3);
  if (guard) out.push({ emoji: "🛡", title: "Iron Guard", detail: `${guard.stats.parries} parries, ${guard.stats.blocks} blocks`, playerId: guard.id });
  const combo = best((s) => s.maxCombo, 3);
  if (combo) out.push({ emoji: "🔥", title: "Combo Artist", detail: `a ${combo.stats.maxCombo}-hit combo`, playerId: combo.id });
  const special = best((s) => s.specials, 1);
  if (special) out.push({ emoji: "✨", title: "Showstopper", detail: `${special.stats.specials} special move${special.stats.specials === 1 ? "" : "s"}`, playerId: special.id });
  const comeback = best((s) => s.comebacks, 1);
  if (comeback) out.push({ emoji: "💪", title: "Comeback Spirit", detail: "won a round from behind", playerId: comeback.id });
  return out.slice(0, 5);
}
