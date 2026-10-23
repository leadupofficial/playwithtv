import { Redis } from "ioredis";
import type { RoomView } from "@scp/protocol";

/**
 * Ephemeral presence mirror. The hub that owns a room keeps the live sockets; this mirror publishes
 * room summaries with a TTL so operators (and, later, a router in front of several hubs) can see them.
 */
export interface Presence {
  readonly kind: "redis" | "memory";
  publish(room: RoomView): Promise<void>;
  remove(roomId: string, joinCode: string): Promise<void>;
  close(): Promise<void>;
}

export class MemoryPresence implements Presence {
  readonly kind = "memory" as const;
  async publish() {}
  async remove() {}
  async close() {}
}

export class RedisPresence implements Presence {
  readonly kind = "redis" as const;
  private r: Redis;
  constructor(url: string) {
    this.r = new Redis(url, { lazyConnect: false, maxRetriesPerRequest: 2 });
  }
  async publish(room: RoomView) {
    const summary = JSON.stringify({ status: room.status, gameId: room.gameId, players: room.players.length, tv: room.tvConnected });
    await this.r.multi()
      .set(`scp:room:${room.roomId}`, summary, "EX", 3600)
      .set(`scp:code:${room.joinCode}`, room.roomId, "EX", 900)
      .exec();
  }
  async remove(roomId: string, joinCode: string) {
    await this.r.del(`scp:room:${roomId}`, `scp:code:${joinCode}`);
  }
  async close() {
    this.r.disconnect();
  }
}
