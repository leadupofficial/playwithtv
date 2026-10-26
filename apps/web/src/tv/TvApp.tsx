import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { ShelfBar, onShelf, type Shelf } from "./Shelves";
import QRCode from "qrcode";
import {
  type AdServed, CreateRoomResponse, type GameManifest, type GameResult, type InputState, type RoomView, type ServerMessage,
} from "@playwithtv/protocol";
import { HubSocket, api, type SocketStatus } from "../net";
import { AVATARS } from "../avatars";
import { GAMES } from "../games/registry";
import type { GameBridge } from "../games/types";
import { installSpatialNav } from "./spatialNav";
import { AdSlot, PresentedBy, adsEnabled } from "./AdSlot";
import { countImpression, pickSponsor, setImpressionSink, useSponsors } from "./sponsors";
import { TvInputs } from "../rtc";
import { TvInstallChip } from "../InstallBanner";
import { MODE_ICON } from "../games/controlKit";
import { GraphicsChip } from "../quality/GraphicsChip";
import { GameBoundary } from "../GameBoundary";

const ROOM_KEY = "pwtv.tv.room";

interface Invite { joinCode: string; joinUrl: string; expiresAt: number }

/** Creates (or resumes after a reload) the TV's room and keeps one socket to the hub. */
function useRoom() {
  const [creds, setCreds] = useState<CreateRoomResponse | null>(null);
  const [room, setRoom] = useState<RoomView | null>(null);
  const [invite, setInvite] = useState<Invite | null>(null);
  const [status, setStatus] = useState<SocketStatus>("connecting");
  const [error, setError] = useState<string | null>(null);
  const [socket, setSocket] = useState<HubSocket | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let alive = true;
    let s: HubSocket | undefined;
    (async () => {
      let c: CreateRoomResponse | null = null;
      try {
        const saved = sessionStorage.getItem(ROOM_KEY);
        c = saved ? CreateRoomResponse.parse(JSON.parse(saved)) : null;
      } catch { c = null; }
      if (!c) {
        try {
          c = await api<CreateRoomResponse>("/api/rooms", {});
          sessionStorage.setItem(ROOM_KEY, JSON.stringify(c));
        } catch (e) {
          if (!alive) return;
          setError((e as Error).message);
          // the server may be restarting (a deploy takes a few seconds): try again by itself rather than stay stuck
          setTimeout(() => alive && (setError(null), setNonce((n) => n + 1)), 5000);
          return;
        }
      }
      if (!alive) return;
      setCreds(c);
      setInvite({ joinCode: c.joinCode, joinUrl: c.joinUrl, expiresAt: c.expiresAt });
      s = new HubSocket({ type: "hello", v: 1, role: "tv", roomId: c.roomId, hostToken: c.hostToken });
      s.onStatus(setStatus);
      s.on((m) => {
        if (m.type === "welcome" || m.type === "room.state") setRoom(m.room);
        else if (m.type === "room.invite") setInvite({ joinCode: m.joinCode, joinUrl: m.joinUrl, expiresAt: m.expiresAt });
        else if (m.type === "room.expired" || (m.type === "error" && (m.code === "room_not_found" || m.code === "unauthorized"))) {
          sessionStorage.removeItem(ROOM_KEY);   // start a fresh room
          s?.close();
          setTimeout(() => alive && setNonce((n) => n + 1), 300);
        }
      });
      setSocket(s);
    })();
    return () => {
      alive = false;
      s?.close();
    };
  }, [nonce]);

  return { creds, room, invite, status, error, socket };
}

export function TvApp() {
  const { room, invite, status, error, socket } = useRoom();
  const [games, setGames] = useState<GameManifest[]>([]);
  const [shelf, setShelf] = useState<Shelf>("all");
  const [qr, setQr] = useState<string>("");
  const [notice, setNotice] = useState<string | null>(null);
  const [removing, setRemoving] = useState<{ id: string; name: string } | null>(null);
  const [results, setResults] = useState<GameResult[] | null>(null);
  const [paused, setPaused] = useState(false);
  const startedAt = useRef(0);
  const sponsors = useSponsors();
  const sponsorsRef = useRef(sponsors);
  sponsorsRef.current = sponsors;
  // Chosen once per match: who presents it (a card over the intro) and whose name is painted into the scene.
  const [presenter, setPresenter] = useState<AdServed | null>(null);
  const [inGame, setInGame] = useState<AdServed | null>(null);

  useEffect(() => installSpatialNav(), []);
  useEffect(() => {
    api<GameManifest[]>("/api/games").then(setGames).catch(() => setNotice("Could not load the game list."));
  }, []);
  useEffect(() => {
    if (invite) QRCode.toDataURL(invite.joinUrl, { margin: 1, width: 480, errorCorrectionLevel: "M" }).then(setQr);
  }, [invite?.joinUrl]);

  // Lifecycle messages that the TV reacts to.
  useEffect(() => {
    if (!socket) return;
    return socket.on((m: ServerMessage) => {
      if (m.type === "error") setNotice(m.message);
      if (m.type === "game.started") {
        startedAt.current = Date.now();
        setResults(null);
        setPaused(false);
        setNotice(null);
        const on = adsEnabled();
        const p = on ? pickSponsor(sponsorsRef.current, "presented-by") : null;
        const g = on ? pickSponsor(sponsorsRef.current, "in-game") : null;
        setPresenter(p);
        setInGame(g);
        if (p) countImpression(p, "presented-by");
        if (g) countImpression(g, "in-game");
      }
      if (m.type === "game.finished") setResults(m.results);
      if (m.type === "game.paused") setPaused(m.paused);
      if (m.type === "game.exit") setResults(null);
    });
  }, [socket]);

  // Controller input arrives over direct phone links (same Wi-Fi) and through the hub; merged once here.
  const [inputs, setInputs] = useState<TvInputs | null>(null);
  const [direct, setDirect] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (!socket) return;
    const i = new TvInputs(socket);
    setInputs(i);
    setImpressionSink((items) => socket.send({ type: "ads.impressions", items }));
    const id = setInterval(() => setDirect(new Set(i.links.direct())), 1000);
    return () => {
      clearInterval(id);
      i.close();
      setImpressionSink(null);
    };
  }, [socket]);

  // only the room's current players may send input (a removed phone's direct link is closed at once)
  useEffect(() => {
    if (inputs && room) inputs.setMembers(room.players.map((p) => p.id));
  }, [inputs, room]);

  // A stable bridge from the running game to its players.
  const bridge = useMemo<GameBridge | null>(() => {
    if (!socket || !inputs) return null;
    return {
      onInput: (cb: (id: string, st: InputState) => void) => inputs.onInput(cb),
      onClear: (cb: (id: string) => void) => inputs.onClear(cb),
      layout: (to, layout, data) => socket.send({ type: "controller.layout", to, layout, data }),
      event: (to, event, data) => socket.send({ type: "tv.event", to, event, data }),
    };
  }, [socket, inputs]);

  const selected = games.find((g) => g.id === room?.gameId);
  const connected = room?.players.filter((p) => p.connected) ?? [];
  const Game = room?.gameId ? GAMES[room.gameId] : undefined;
  const playing = (room?.status === "playing" || room?.status === "paused") && Game && bridge;

  const pick = (g: GameManifest) => {
    socket?.send({ type: "game.select", gameId: g.id });
    setNotice(null);
  };
  const start = () => socket?.send({ type: "game.start" });

  if (error) {
    return (
      <div className="tv"><div className="center-screen"><div>
        <h1 className="big-title">Can't reach the game server</h1>
        <p className="hint">{error}</p>
        <p className="hint">Trying again by itself…</p>
        <button className="btn" data-nav autoFocus onClick={() => location.reload()}>Try again</button>
      </div></div></div>
    );
  }

  if (playing) {
    return (
      <div className="tv" style={{ padding: 0 }}>
        <GameBoundary key={room!.gameId} onExit={() => socket?.send({ type: "game.exit" })}>
        <Suspense fallback={<div className="center-screen"><p className="hint">Loading game…</p></div>}>
          <Game
            players={room!.players /* everyone in the room; games show who is disconnected */}
            bridge={bridge!}
            paused={paused}
            onFinish={(res, ms) => socket?.send({ type: "game.finished", results: res, durationMs: ms })}
            sponsor={inGame ? { name: inGame.advertiser } : null}
          />
        </Suspense>
        </GameBoundary>
        {presenter && <PresentedBy key={startedAt.current} ad={presenter} />}
        {status !== "open" && <div className="chip" style={{ position: "absolute", top: 32, right: 58 }}><span className="dot" />Reconnecting…</div>}
        {notice && <div className="notice" role="alert" style={{ position: "absolute", bottom: 43, left: 96, right: 96 }}>{notice}</div>}
      </div>
    );
  }

  return (
    <div className="tv">
      <div className="tv-header">
        <div className="brand"><img src="/icons/icon-192.png" alt="" className="brand-icon" /><b>Play With TV</b></div>
        <div className="row">
          <span className="chip"><span className={`dot ${status === "open" ? "on" : ""}`} />{status === "open" ? "Online" : "Connecting…"}</span>
          <span className="chip">{connected.length} / 8 players</span>
          <TvInstallChip />
          <GraphicsChip />
        </div>
      </div>

      {removing && (
        <div className="tv-install-help" role="dialog" aria-label={`Remove ${removing.name}?`}>
          <div>
            <h2>Remove {removing.name}?</h2>
            <p className="hint">They leave this game. To keep someone out, they would need the TV's new code.</p>
            <div className="row" style={{ justifyContent: "center" }}>
              <button className="btn secondary" data-nav autoFocus onClick={() => setRemoving(null)}>Cancel</button>
              <button className="btn" data-nav onClick={() => {
                socket?.send({ type: "player.remove", playerId: removing.id });
                socket?.send({ type: "room.rotateInvite" }); // a fresh code, so the removed player can't simply rejoin
                setRemoving(null);
              }}>Remove</button>
            </div>
          </div>
        </div>
      )}
      {room?.status === "results" && results ? (
        <>
          <Results results={results} room={room} game={selected} onRematch={start} onExit={() => socket?.send({ type: "game.exit" })} />
          <AdSlot placement="results-rail" games={games} sponsors={sponsors} />
        </>
      ) : (
        <>
        <div className="lobby">
          <div className="panel pair">
            <div className="section-title" style={{ margin: 0 }}>Scan to join</div>
            <div className="qr-wrap">{qr ? <img src={qr} alt="QR code to join this TV" /> : <div style={{ width: 330, height: 330 }} />}</div>
            <div className="hint">or open <strong>{location.origin}/join</strong> and type</div>
            <div className="code" aria-label="Join code">{invite?.joinCode ?? "····"}</div>
            <div className="hint">No app needed · works on Android and iPhone</div>
            <div className="wifi-tip">📶 Join from the <b>same Wi-Fi</b> as this TV for lag-free play</div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 24, minHeight: 0 }}>
            <div className="panel">
              <div className="section-title">Players</div>
              <div className="players">
                {room?.players.map((p) => (
                  <div key={p.id} className={`player ${p.connected ? "" : "off"}`} style={{ borderColor: p.color }} data-link={direct.has(p.id) ? "direct" : "server"}>
                    <div className="avatar" style={{ boxShadow: `0 0 0 0.18em ${p.color}` }}>{AVATARS[p.avatar].emoji}</div>
                    <div className="name">{p.name}</div>
                    <div className="hint">{!p.connected ? "reconnecting…" : `${p.ready ? "✅ ready" : "joined"}${direct.has(p.id) ? " · ⚡ direct" : " · ☁ slow: same Wi-Fi?"}`}</div>
                    <button className="player-remove" data-nav aria-label={`Remove ${p.name}`} onClick={() => setRemoving({ id: p.id, name: p.name })}>✕</button>
                  </div>
                ))}
                {Array.from({ length: Math.max(0, 4 - (room?.players.length ?? 0)) }).map((_, i) => (
                  <div key={i} className="empty-slot">waiting…</div>
                ))}
              </div>
            </div>

            <div className="panel" style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
              <div className="section-title">Choose a game</div>
              <ShelfBar games={games} shelf={shelf} onPick={setShelf} />
              <div className="games">
                {onShelf(games, shelf).map((g, i) => (
                  <button
                    key={g.id}
                    data-nav
                    autoFocus={i === 0}
                    className={`game-card ${g.id === room?.gameId ? "selected" : ""}`}
                    style={{ background: `linear-gradient(135deg, ${g.colors[0]}, ${g.colors[1]})` }}
                    onClick={() => pick(g)}
                  >
                    <span className="emoji">{g.emoji}</span>
                    <span className="title">{g.title}</span>
                    <span className="meta">{g.minPlayers === g.maxPlayers ? `${g.minPlayers}` : `${g.minPlayers}–${g.maxPlayers}`} players · ~{g.sessionMinutes} min{g.controlModes ? ` · ${g.controlModes.map((m) => MODE_ICON[m]).join(" ")}` : ""}</span>
                  </button>
                ))}
              </div>
              {selected && (
                <div className="row" style={{ marginTop: "1em", flexWrap: "nowrap" }}>
                  <button className="btn" data-nav onClick={start} disabled={connected.length < selected.minPlayers}>
                    ▶ Start {selected.title}
                  </button>
                  <span className="hint" style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{selected.description}</span>
                </div>
              )}
              {selected && connected.length < selected.minPlayers && <p className="hint">Waiting for {selected.minPlayers - connected.length} more player(s) to join.</p>}
              {notice && <div className="notice" role="alert" style={{ marginTop: "1em" }}>{notice}</div>}
            </div>
          </div>
        </div>
        <AdSlot placement="lobby-rail" games={games} sponsors={sponsors} />
        </>
      )}
    </div>
  );
}

function Results({ results, room, game, onRematch, onExit }: {
  results: GameResult[]; room: RoomView; game?: GameManifest; onRematch: () => void; onExit: () => void;
}) {
  const byId = new Map(room.players.map((p) => [p.id, p]));
  const sorted = [...results].sort((a, b) => a.place - b.place);
  const medal = ["🥇", "🥈", "🥉"];
  return (
    <div className="center-screen">
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "1.2em" }}>
        <h1 className="big-title">{sorted[0]?.place === 1 ? `🏆 ${byId.get(sorted[0].playerId)?.name ?? "Nobody"} wins!` : "👏 Good fight!"}</h1>
        <div className="hint">{game?.title}</div>
        <div className="podium">
          {sorted.map((r, i) => {
            const p = byId.get(r.playerId);
            return (
              <div key={r.playerId} className={`podium-row ${r.place === 1 ? "first" : ""}`} style={{ animationDelay: `${i * 0.12}s` }}>
                <span className="place">{medal[r.place - 1] ?? r.place}</span>
                <span className="avatar" style={{ boxShadow: `0 0 0 0.15em ${p?.color}` }}>{p ? AVATARS[p.avatar].emoji : "❔"}</span>
                <span className="name" style={{ fontWeight: 700 }}>{p?.name ?? "Left the game"}</span>
                <span style={{ fontWeight: 800 }}>{Math.round(r.score)}</span>
              </div>
            );
          })}
        </div>
        <div className="row">
          <button className="btn" data-nav autoFocus onClick={onRematch}>🔁 Rematch</button>
          <button className="btn secondary" data-nav onClick={onExit}>🎮 Choose another game</button>
        </div>
      </div>
    </div>
  );
}
