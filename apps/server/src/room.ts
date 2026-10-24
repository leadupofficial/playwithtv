import type { WebSocket } from "ws";
import type { Avatar, GameResult, RoomStatus, ServerMessage } from "@playwithtv/protocol";
import type { Bucket } from "./security.js";

/** A phone in a room. */
export interface Player {
  id: string;
  token: string;
  name: string;
  avatar: Avatar;
  color: string;
  ready: boolean;
  socket?: WebSocket;
  lastSeq: number;
  inputBucket: Bucket;
  msgBucket: Bucket;
  disconnectedAt?: number;
}

/** A live room on this process (the TV is its host). */
export interface Room {
  id: string;
  hostToken: string;
  joinCode: string;
  invite: { token: string; expiresAt: number };
  status: RoomStatus;
  gameId: string | null;
  gameStartedAt: number;
  players: Map<string, Player>;
  tv?: WebSocket;
  tvBucket: Bucket;
  tvDisconnectedAt?: number;
  /** The game was paused because the TV dropped (not by a player), so it resumes when the TV is back. */
  pausedForTv: boolean;
  lastResults?: GameResult[];
  /** Latest layout the TV sent to everyone, and per-player overrides: replayed to a phone that reconnects. */
  layoutAll?: Extract<ServerMessage, { type: "controller.layout" }>;
  layoutFor: Map<string, Extract<ServerMessage, { type: "controller.layout" }>>;
  lastActivity: number;
  lastImpressionsAt: number;
  /** Games started since the last impression report: bounds "presented by" and in-game sponsor counts. */
  gamesSinceReport: number;
}

/**
 * The captain: the earliest-joined player who is connected (or, with nobody connected, the earliest-joined).
 * Their phone may pick, start and end games like the TV remote. Passes on automatically when they leave.
 */
export function captainOf(room: { players: Map<string, { id: string; socket?: unknown }> }): string | null {
  let first: string | null = null;
  for (const p of room.players.values()) {
    if (p.socket) return p.id;
    first ??= p.id;
  }
  return first;
}

/** A display name nobody else in the room has ("Priya", then "Priya 2"…). */
export function uniqueName(room: { players: Map<string, { id: string; name: string }> }, name: string, selfId?: string): string {
  const taken = new Set([...room.players.values()].filter((p) => p.id !== selfId).map((p) => p.name.toLowerCase()));
  if (!taken.has(name.toLowerCase())) return name;
  for (let i = 2; ; i++) if (!taken.has(`${name} ${i}`.toLowerCase())) return `${name} ${i}`.slice(0, 18);
}
