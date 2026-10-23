import { useEffect, useState } from "react";
import type { AdServed, GameManifest } from "@scp/protocol";
import { countImpression, forPlacement } from "./sponsors";

/**
 * Banner space on the TV, only on screens where nobody is playing:
 *   lobby-rail   bottom of the lobby (people are scanning / waiting, the longest dwell time)
 *   results-rail bottom of the results screen (between matches)
 * Never during gameplay and never on phones. The box is a 970×90 banner shown at 4/3 scale (1293×120 on the
 * 1920×1080 stage), so standard creatives fit without cropping. Booked sponsors rotate on their own; with none
 * booked the slot shows house promos for our own games. `?ads=0` turns every slot off.
 */
export type RailPlacement = "lobby-rail" | "results-rail";

const ROTATE_MS = 15_000;
export const adsEnabled = () => new URLSearchParams(location.search).get("ads") !== "0";

type Item = { kind: "sponsor"; ad: AdServed } | { kind: "house"; emoji: string; title: string; line: string; colors: [string, string] };

function houseItems(games: GameManifest[]): Item[] {
  return [
    ...games.map((g): Item => ({ kind: "house", emoji: g.emoji, title: g.title, line: g.description, colors: g.colors as [string, string] })),
    { kind: "house", emoji: "📣", title: "Your brand on the big screen", line: "Advertise to families playing together · playwithtv.leadup.in", colors: ["#3b1f7a", "#7a1f4f"] },
  ];
}

export function AdSlot({ placement, games, sponsors }: { placement: RailPlacement; games: GameManifest[]; sponsors: AdServed[] }) {
  const [i, setI] = useState(0);
  const booked = forPlacement(sponsors, placement);
  const items: Item[] = booked.length ? booked.map((ad) => ({ kind: "sponsor", ad })) : houseItems(games);
  const item = items[i % items.length];

  useEffect(() => {
    const id = setInterval(() => setI((n) => n + 1), ROTATE_MS);
    return () => clearInterval(id);
  }, []);
  useEffect(() => {
    if (item?.kind === "sponsor" && adsEnabled()) countImpression(item.ad, placement);
  }, [i, item?.kind === "sponsor" ? item.ad.id : null]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!adsEnabled() || !item) return null;
  return (
    <aside className="ad-slot" data-placement={placement} aria-label="Advertisement">
      {item.kind === "sponsor" ? (
        item.ad.imageUrl ? (
          <img className="ad-creative ad-image" key={i} src={item.ad.imageUrl} alt={item.ad.title} />
        ) : (
          <div className="ad-creative sponsor" key={i}>
            <span className="ad-text"><b>{item.ad.title}</b><span>{item.ad.line}</span></span>
          </div>
        )
      ) : (
        <div className="ad-creative" key={i} style={{ background: `linear-gradient(90deg, ${item.colors[0]}, ${item.colors[1]})` }}>
          <span className="ad-emoji">{item.emoji}</span>
          <span className="ad-text"><b>{item.title}</b><span>{item.line}</span></span>
        </div>
      )}
      <span className="ad-label">Ad</span>
    </aside>
  );
}

/** "Presented by" card over the first seconds of a game, while it shows its own get-ready intro. */
export function PresentedBy({ ad }: { ad: AdServed }) {
  return (
    <div className="presented-by" role="note" aria-label={`Presented by ${ad.advertiser}`}>
      <span className="pb-label">Presented by</span>
      {ad.imageUrl ? <img src={ad.imageUrl} alt={ad.advertiser} /> : <b>{ad.advertiser}</b>}
    </div>
  );
}
