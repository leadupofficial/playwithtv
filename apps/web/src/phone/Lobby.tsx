import { useEffect, useState } from "react";
import type { ClientMessage, GameManifest, GameResult, PlayerView, RoomView } from "@playwithtv/protocol";
import type { PhoneMotion } from "./motion";
import { savedSensitivity } from "./motion";
import { InstallBanner } from "../InstallBanner";
import { api } from "../net";
import { t } from "../i18n";

const MODE_ICON: Record<string, string> = { buttons: "🎮", motion: "🎯", hybrid: "⚡", touchpad: "👆" };

/**
 * The phone between games. The captain (earliest-joined connected player, 👑) gets the game menu: pick a game,
 * ▶ Play, and after a game Rematch or Choose another, so nobody needs the TV remote. Everyone else sees
 * what's happening and who is choosing.
 */
export function Lobby({ room, me, data, motion, notice, send }: {
  room: RoomView | null;
  me?: PlayerView;
  data?: Record<string, unknown>;
  motion: PhoneMotion;
  notice: { text: string; at: number } | null;
  send(m: ClientMessage): void;
}) {
  const results = data?.results as GameResult[] | undefined;
  const mine = results?.find((r) => r.playerId === me?.id);
  const captain = !!me && room?.captainId === me.id;
  const captainName = room?.players.find((p) => p.id === room.captainId)?.name;
  const [games, setGames] = useState<GameManifest[]>([]);
  const [sens, setSens] = useState(savedSensitivity);
  useEffect(() => {
    if (captain && !games.length) api<GameManifest[]>("/api/games").then(setGames).catch(() => undefined);
  }, [captain]); // eslint-disable-line react-hooks/exhaustive-deps
  const connected = room?.players.filter((p) => p.connected).length ?? 0;
  const selected = games.find((g) => g.id === room?.gameId);
  const tooFew = selected ? connected < selected.minPlayers : false;
  const tooMany = selected ? connected > selected.maxPlayers : false;
  const freshNotice = notice && Date.now() - notice.at < 6000 ? notice.text : null;

  const result = mine && (
    <div className="lobby-result">
      <span style={{ fontSize: 44 }}>{mine.place === 1 ? "🏆" : mine.place <= 3 ? "🎉" : "👏"}</span>
      <div><b>{mine.place === 1 ? "You won!" : `You came #${mine.place}`}</b><br /><span className="hint">Score {Math.round(mine.score)}</span></div>
    </div>
  );

  const extras = (
    <div className="lobby-extras">
      <button className={`btn ${me?.ready ? "secondary" : ""}`} onClick={() => send({ type: "player.ready", ready: !me?.ready })}>
        {me?.ready ? "✅ Ready" : "I'm ready"}
      </button>
      <label className="sens">{t("ctl.sensitivity")}
        <input type="range" min={0.5} max={2} step={0.1} value={sens} onChange={(e) => {
          const v = Number(e.target.value);
          setSens(v);
          motion.setSensitivity(v);
        }} />
      </label>
    </div>
  );

  if (!captain) {
    return (
      <>
        <InstallBanner />
        <div className="lobby-pad">
          <div className="ctl-message"><div>
            {result ?? <h1>You're in!</h1>}
            <p>{room?.gameId ? "Next game chosen. Watch the TV." : `👑 ${captainName ?? "The captain"} picks the game (or use the TV remote).`}</p>
            <p className="hint">{connected} player(s) connected</p>
          </div></div>
          {extras}
        </div>
      </>
    );
  }

  return (
    <div className="captain" data-captain>
      <div className="captain-head">
        <b>👑 You're the captain</b>
        <span className="hint">pick a game for everyone · {connected} player(s)</span>
        {result}
      </div>
      {room?.status === "results" ? (
        <div className="captain-actions">
          <button className="btn" onClick={() => send({ type: "game.start" })}>🔁 Rematch</button>
          <button className="btn secondary" onClick={() => send({ type: "game.exit" })}>🎮 Choose another game</button>
        </div>
      ) : (
        <>
          <div className="game-menu">
            {games.map((g) => (
              <button key={g.id} className={`menu-game ${g.id === room?.gameId ? "on" : ""}`}
                style={{ background: `linear-gradient(135deg, ${g.colors[0]}, ${g.colors[1]})` }}
                onClick={() => send({ type: "game.select", gameId: g.id })}>
                <span className="menu-emoji">{g.emoji}</span>
                <span className="menu-title">{g.title}</span>
                <span className="menu-meta">{g.minPlayers}–{g.maxPlayers} · {(g.controlModes ?? []).map((m) => MODE_ICON[m]).join("")}</span>
              </button>
            ))}
          </div>
          <div className="captain-actions">
            <button className="btn play-btn" disabled={!selected || tooFew || tooMany} onClick={() => send({ type: "game.start" })}>
              {selected ? `▶ Play ${selected.title}` : "Pick a game"}
            </button>
            {selected && (tooFew || tooMany) && (
              <span className="hint">{selected.title} needs {selected.minPlayers}–{selected.maxPlayers} players ({connected} here)</span>
            )}
          </div>
        </>
      )}
      {freshNotice && <div className="notice" role="alert">{freshNotice}</div>}
      {extras}
    </div>
  );
}
