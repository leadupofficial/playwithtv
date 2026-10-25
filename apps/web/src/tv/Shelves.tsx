import { GENRE_LABEL, GENRES, type GameManifest, type Genre } from "@playwithtv/protocol";

/** "all" plus every shelf that has at least one game on it, in the protocol's order. */
export type Shelf = Genre | "all";

export function shelvesFor(games: GameManifest[]): Shelf[] {
  const used = new Set(games.flatMap((g) => g.genres ?? []));
  return ["all", ...GENRES.filter((g) => used.has(g))];
}

export function onShelf(games: GameManifest[], shelf: Shelf): GameManifest[] {
  return shelf === "all" ? games : games.filter((g) => g.genres?.includes(shelf));
}

/** The lobby's shelf chips: one row of remote-friendly buttons above the game grid. */
export function ShelfBar({ games, shelf, onPick }: { games: GameManifest[]; shelf: Shelf; onPick: (s: Shelf) => void }) {
  const shelves = shelvesFor(games);
  if (shelves.length <= 2) return null;
  return (
    <div className="shelves" role="tablist" aria-label="Game categories">
      {shelves.map((s) => (
        <button
          key={s}
          role="tab"
          aria-selected={s === shelf}
          data-nav
          data-shelf={s}
          className={`shelf ${s === shelf ? "on" : ""}`}
          onClick={() => onPick(s)}
        >
          {s === "all" ? "All games" : GENRE_LABEL[s]} <span className="count">{onShelf(games, s).length}</span>
        </button>
      ))}
    </div>
  );
}
