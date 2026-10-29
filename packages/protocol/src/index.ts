/**
 * Play With TV wire protocol, version 1.
 *
 * Transport: JSON text frames over one WebSocket per device (TV or phone) to the room hub.
 * Lifecycle messages are reliable (TCP) and acknowledged through room.state broadcasts.
 * Gameplay input is sent as *full controller state* (not individual key events) on every change plus a
 * 4 Hz heartbeat, with a per-player sequence number: a lost or reordered frame is simply superseded,
 * and a button can never stay "stuck" after a disconnect (the hub tells the TV to clear that player).
 */
import { PERF_CLASSES } from "./perfBudget.js";
import "./zod-config.js";
import { z } from "zod";
import { ImpressionItems } from "./ads.js";

export const PROTOCOL_VERSION = 1;
export const MAX_FRAME_BYTES = 4096;
export const MAX_PLAYERS_PER_ROOM = 8;
/**
 * Typed join codes: 5 characters from 30 look-alike-free letters/digits = 24.3 million codes, and each
 * expires after 10 minutes. QR invites use a long random token instead.
 */
export const JOIN_CODE_LENGTH = 5;
export const JOIN_CODE_PATTERN = new RegExp(`^[A-Z2-9]{${JOIN_CODE_LENGTH}}$`);

// ---- shared shapes ----------------------------------------------------------------

/** "game" is the one in-game controller, drawn from the game's ControlSpec (see controls.ts). "lobby" is setup. */
export const ControllerType = z.enum(["lobby", "game"]);
export type ControllerType = z.infer<typeof ControllerType>;

export const Avatar = z.enum(["tiger", "peacock", "elephant", "cobra", "parrot", "lotus", "mango", "rocket"]);
export type Avatar = z.infer<typeof Avatar>;

export const PlayerName = z
  .string()
  .trim()
  .min(1)
  .max(16)
  .regex(/^[\p{L}\p{N} _.-]+$/u, "letters, numbers, spaces and . _ - only");

export const PlayerView = z.object({
  id: z.string(),
  name: z.string(),
  avatar: Avatar,
  color: z.string(),
  connected: z.boolean(),
  ready: z.boolean(),
});
export type PlayerView = z.infer<typeof PlayerView>;

export const RoomStatus = z.enum(["lobby", "loading", "playing", "paused", "results"]);
export type RoomStatus = z.infer<typeof RoomStatus>;

export const RoomView = z.object({
  roomId: z.string(),
  joinCode: z.string(),
  status: RoomStatus,
  gameId: z.string().nullable(),
  players: z.array(PlayerView),
  tvConnected: z.boolean(),
  /** The player whose phone can pick and start games (the earliest-joined connected player), if any. */
  captainId: z.string().nullable(),
});
export type RoomView = z.infer<typeof RoomView>;

/**
 * Controller input state. Every controller type uses the same small envelope so the hub can validate
 * and size-limit it without knowing the game: analog axes in [-1, 1], held buttons, and tap counters
 * (monotonic counts for one-shot actions such as "answer 2" or "jump", so a dropped frame cannot lose a tap).
 */
export const InputState = z.object({
  axes: z.record(z.string().max(16), z.number().min(-1).max(1)).optional(),
  buttons: z.record(z.string().max(16), z.boolean()).optional(),
  taps: z.record(z.string().max(16), z.number().int().min(0)).optional(),
});
export type InputState = z.infer<typeof InputState>;

export const GameResult = z.object({
  playerId: z.string(),
  score: z.number().finite(),
  place: z.number().int().min(1),
});
export type GameResult = z.infer<typeof GameResult>;

/**
 * WebRTC signalling, relayed by the hub so a phone and its TV can open a direct data channel on the
 * home network (motion then skips the server). A data-channel-only offer is ~1 KB; candidates are trickled.
 */
export const RtcSignal = z.union([
  z.object({ sdp: z.object({ type: z.enum(["offer", "answer"]), sdp: z.string().max(3000) }) }),
  z.object({
    candidate: z.object({
      candidate: z.string().max(400),
      sdpMid: z.string().max(16).nullable().optional(),
      sdpMLineIndex: z.number().int().min(0).max(8).nullable().optional(),
    }),
  }),
  z.object({ bye: z.literal(true) }),
]);
export type RtcSignal = z.infer<typeof RtcSignal>;

// ---- client -> hub -------------------------------------------------------------------

const v = z.literal(PROTOCOL_VERSION);

export const ClientMessage = z.discriminatedUnion("type", [
  // the TV says hello with its hostToken, a phone with its playerToken
  z.object({
    type: z.literal("hello"), v, role: z.enum(["tv", "controller"]), roomId: z.string().max(64),
    hostToken: z.string().max(128).optional(), playerToken: z.string().max(128).optional(),
  }),
  z.object({ type: z.literal("ping"), t: z.number() }),
  // phone
  z.object({ type: z.literal("controller.input"), seq: z.number().int().min(0), state: InputState }),
  z.object({ type: z.literal("player.ready"), ready: z.boolean() }),
  z.object({ type: z.literal("player.leave") }),
  // TV (host) only
  z.object({ type: z.literal("game.select"), gameId: z.string().max(64) }),
  z.object({ type: z.literal("game.start") }),
  z.object({ type: z.literal("game.pause"), paused: z.boolean() }),
  z.object({ type: z.literal("game.finished"), results: z.array(GameResult).max(MAX_PLAYERS_PER_ROOM), durationMs: z.number().min(0) }),
  z.object({ type: z.literal("game.exit") }),
  z.object({
    type: z.literal("controller.layout"),
    to: z.string().max(64), // player id or "all"
    layout: ControllerType,
    data: z.record(z.string(), z.unknown()).optional(),
  }),
  z.object({ type: z.literal("tv.event"), to: z.string().max(64), event: z.string().max(32), data: z.record(z.string(), z.unknown()).optional() }),
  z.object({ type: z.literal("room.rotateInvite") }),
  // TV only: the host removes a player (an uninvited guest); their token stops working
  z.object({ type: z.literal("player.remove"), playerId: z.string().max(64) }),
  // TV only: how often sponsors were shown (see ads.ts)
  z.object({ type: z.literal("ads.impressions"), items: ImpressionItems }),
  // both: a phone signals "tv"; the TV signals one player id
  z.object({ type: z.literal("rtc.signal"), to: z.string().max(64), signal: RtcSignal }),
]);
export type ClientMessage = z.infer<typeof ClientMessage>;

// ---- hub -> client -------------------------------------------------------------------

export type ServerMessage =
  | { type: "welcome"; v: typeof PROTOCOL_VERSION; role: "tv" | "controller"; playerId?: string; room: RoomView }
  | { type: "room.state"; room: RoomView }
  | { type: "room.invite"; joinCode: string; inviteToken: string; joinUrl: string; expiresAt: number }
  | { type: "room.expired" }
  | { type: "controller.input"; playerId: string; seq: number; state: InputState }
  | { type: "controller.clear"; playerId: string }
  | { type: "controller.layout"; layout: ControllerType; data?: Record<string, unknown> }
  | { type: "tv.event"; event: string; data?: Record<string, unknown> }
  | { type: "game.selected"; gameId: string }
  | { type: "game.started"; gameId: string; players: PlayerView[] }
  | { type: "game.paused"; paused: boolean }
  | { type: "game.finished"; gameId: string; results: GameResult[] }
  | { type: "game.exit" }
  | { type: "pong"; t: number; serverTime: number }
  | { type: "rtc.signal"; from: string; signal: RtcSignal }
  | { type: "error"; code: ErrorCode; message: string };

export type ErrorCode =
  | "bad_message"
  | "unsupported_version"
  | "unauthorized"
  | "room_not_found"
  | "room_full"
  | "invite_expired"
  | "rate_limited"
  | "not_allowed"
  | "unknown_game"
  | "player_count"
  | "removed"
  | "server_busy";

// ---- HTTP API ---------------------------------------------------------------------------

export const CreateRoomResponse = z.object({
  roomId: z.string(),
  hostToken: z.string(),
  joinCode: z.string(),
  inviteToken: z.string(),
  joinUrl: z.string(),
  expiresAt: z.number(),
});
export type CreateRoomResponse = z.infer<typeof CreateRoomResponse>;

/**
 * Anonymous install id: random, made by the browser and kept in its localStorage. It only lets the operator
 * count unique and returning phones/TVs; it carries no personal data. A malformed one is dropped, never an error.
 */
export const DeviceId = z.string().regex(/^[A-Za-z0-9_-]{16,64}$/);
const optionalDevice = DeviceId.optional().catch(undefined);

/** What kind of screen opened the TV page (coarse, no fingerprint): tells real TVs from phones that tapped "This is the TV". */
export const ScreenForm = z.enum(["tv-app", "tv", "desktop", "tablet", "phone"]);
export type ScreenForm = z.infer<typeof ScreenForm>;
export const CreateRoomRequest = z.object({ device: optionalDevice, form: ScreenForm.optional().catch(undefined) }).catch({ device: undefined, form: undefined });
export type CreateRoomRequest = z.infer<typeof CreateRoomRequest>;

export const JoinRequest = z
  .object({
    inviteToken: z.string().max(128).optional(),
    joinCode: z.string().trim().toUpperCase().regex(JOIN_CODE_PATTERN).optional(),
    name: PlayerName,
    avatar: Avatar,
    playerToken: z.string().max(128).optional(), // rejoin with the same identity
    device: optionalDevice,
  })
  .refine((r) => r.inviteToken || r.joinCode, "inviteToken or joinCode is required");
export type JoinRequest = z.infer<typeof JoinRequest>;

export type JoinResponse = { roomId: string; playerId: string; playerToken: string };

// ---- game catalogue --------------------------------------------------------------------

export const GameCategory = z.enum(["solo-arcade", "duo", "competitive", "coop-adventure", "family-social"]);
export type GameCategory = z.infer<typeof GameCategory>;
export const GameMode = z.enum([
  "solo", "solo-challenge", "duo-coop", "duo-versus", "couch-party", "team-coop", "team-versus", "tournament", "async-challenge", "practice",
]);
export type GameMode = z.infer<typeof GameMode>;

/**
 * The shelves players browse by on the TV (the lobby's filter). A game sits on every shelf it fits, first one
 * = its main shelf. Keep this list short and player-facing: it is shown as-is in the lobby.
 */
export const GENRES = [
  "single-player", "two-player", "couples", "party", "local-multiplayer", "online", "racing", "survival",
  "strategy", "rhythm", "sports", "sandbox", "motion", "brain",
] as const;
export const Genre = z.enum(GENRES);
export type Genre = z.infer<typeof Genre>;
export const GENRE_LABEL: Record<Genre, string> = {
  "single-player": "Single-player", "two-player": "Two-player", couples: "Couples", party: "Party",
  "local-multiplayer": "Local multiplayer", online: "Online", racing: "Racing", survival: "Survival",
  strategy: "Strategy", rhythm: "Rhythm", sports: "Sports", sandbox: "Sandbox", motion: "Motion & camera",
  brain: "Brain training",
};

export const GameManifest = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  title: z.string(),
  description: z.string(),
  categories: z.array(z.string()),
  /** Lobby shelves (GENRES), main shelf first. */
  genres: z.array(Genre).min(1),
  tags: z.array(z.string()),
  minPlayers: z.number().int().min(1),
  maxPlayers: z.number().int().max(MAX_PLAYERS_PER_ROOM),
  version: z.string(),
  executionMode: z.enum(["browser", "cloud-stream"]),
  controller: ControllerType,
  orientation: z.enum(["portrait", "landscape", "any"]),
  estimatedAssetKb: z.number().int().min(0),
  difficulty: z.enum(["easy", "medium", "hard"]),
  sessionMinutes: z.number().min(1),
  accessibility: z.array(z.string()),
  colors: z.tuple([z.string(), z.string()]),
  emoji: z.string(),
  playable: z.boolean(),
  /**
   * Built and tested, but held back from public game selection until it is reworked (the reason is shown in
   * docs/catalogue.md). Only a hub started with PREVIEW_GAMES=1 (development, QA, e2e) lists and starts it.
   */
  heldBack: z.string().optional(),
  // ---- catalogue and motion metadata ----
  /** Number in the 50-game catalogue (docs/catalogue.md); absent for extra originals. */
  catalogueNo: z.number().int().min(1).optional(),
  category: GameCategory,
  modes: z.array(GameMode).min(1),
  /** concept: idea only · prototype: partly playable · playable: complete loop, tested · released: real-device verified */
  completionStatus: z.enum(["concept", "prototype", "playable", "released"]),
  /** Delivery phase from the roadmap (1 = first). */
  phase: z.number().int().min(1).max(5),
  sensorRequirements: z.object({ accelerometer: z.boolean(), gyroscope: z.enum(["required", "optional", "unused"]) }).optional(),
  motionMappings: z.array(z.object({ motion: z.string(), action: z.string() })).optional(),
  /** How the phone is held when calibrating. */
  calibrationProfile: z.enum(["upright", "flat", "any"]).optional(),
  difficultyLevels: z.array(z.string()).optional(),
  assetManifest: z.array(z.object({ path: z.string(), kb: z.number() })).optional(),
  licenceInventory: z.array(z.object({ asset: z.string(), licence: z.string(), source: z.string() })).optional(),
  automatedTestStatus: z.enum(["none", "unit", "unit+e2e"]),
  /** Control modes the game offers on phones, best first (see controls.ts). */
  controlModes: z.array(z.enum(["buttons", "motion", "hybrid", "touchpad", "camera"])).optional(),
  /** Performance class CI holds the game to (perfBudget.ts, docs/performance.md). Absent = "light". */
  perfClass: z.enum(PERF_CLASSES).optional(),
  /** Has an adults-only (18+) deck that stays hidden until every player confirms their age in the game. */
  matureOptIn: z.boolean().optional(),
});
export type GameManifest = z.infer<typeof GameManifest>;

export { CATALOG, findGame } from "./catalog.js";
export * from "./ads.js";
export * from "./controls.js";
export * from "./perfBudget.js";
