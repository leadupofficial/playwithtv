import type { WebSocket } from "ws";
import type { ClientMessage, ServerMessage } from "@scp/protocol";
import { HubError, metrics } from "./errors.js";
import { Bucket } from "./security.js";

export interface Conn {
  roomId?: string;
  role?: "tv" | "controller";
  playerId?: string;
}

interface SignalRoom { tv?: WebSocket; players: Map<string, { socket?: WebSocket }> }

// a connection setup is one offer/answer plus a handful of ICE candidates; reconnects repeat it
const buckets = new WeakMap<Conn, Bucket>();

/**
 * WebRTC signalling relay. The hub only introduces a phone and its TV (both already authenticated in
 * this room); once their data channel opens, motion input flows directly over the home network.
 * A phone can only signal its own room's TV; the TV can only signal its own room's players.
 */
export function relaySignal(room: SignalRoom, conn: Conn, m: Extract<ClientMessage, { type: "rtc.signal" }>, send: (ws: WebSocket | undefined, msg: ServerMessage) => void) {
  let bucket = buckets.get(conn);
  if (!bucket) buckets.set(conn, (bucket = new Bucket(4, 40)));
  if (!bucket.take()) {
    metrics.rateLimited++;
    throw new HubError("rate_limited", "slow down");
  }
  metrics.rtcSignals++;
  if (conn.role === "controller") {
    if (m.to !== "tv") throw new HubError("not_allowed", "phones can only signal the TV");
    return send(room.tv, { type: "rtc.signal", from: conn.playerId!, signal: m.signal });
  }
  const p = room.players.get(m.to);
  if (!p) throw new HubError("not_allowed", "no such player");
  return send(p.socket, { type: "rtc.signal", from: "tv", signal: m.signal });
}
