import type { WebSocket } from "ws";
import type { Avatar, GameResult, RoomStatus, ServerMessage } from "@scp/protocol";
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
