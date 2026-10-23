import { type ClientMessage, type ServerMessage } from "@playwithtv/protocol";

export type SocketStatus = "connecting" | "open" | "reconnecting" | "closed";
type Handler = (m: ServerMessage) => void;

/** Codes after which reconnecting is pointless: the room is gone or this device was replaced. */
const FINAL_CLOSE = new Set([4400, 4401, 4409, 4410]);

/**
 * One WebSocket to the hub with automatic reconnection (exponential backoff), re-sent hello,
 * and a 2 s ping that measures round-trip latency.
 */
export class HubSocket {
  private ws?: WebSocket;
  private handlers = new Set<Handler>();
  private statusHandlers = new Set<(s: SocketStatus) => void>();
  private retry = 0;
  private stopped = false;
  private pinger?: ReturnType<typeof setInterval>;
  /** Lifecycle messages sent while reconnecting; delivered right after the next hello. */
  private outbox: ClientMessage[] = [];
  latencyMs = 0;
  status: SocketStatus = "connecting";

  constructor(private hello: ClientMessage) {
    this.connect();
  }

  private setStatus(s: SocketStatus) {
    this.status = s;
    this.statusHandlers.forEach((h) => h(s));
  }

  private connect() {
    const url = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`;
    const ws = new WebSocket(url);
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 0;
      ws.send(JSON.stringify(this.hello));
      for (const m of this.outbox.splice(0)) ws.send(JSON.stringify(m));
      this.setStatus("open");
      clearInterval(this.pinger);
      this.pinger = setInterval(() => this.send({ type: "ping", t: Date.now() }), 2000);
    };
    ws.onmessage = (e) => {
      const m = JSON.parse(String(e.data)) as ServerMessage;
      if (m.type === "pong") this.latencyMs = Date.now() - m.t;
      this.handlers.forEach((h) => h(m));
    };
    ws.onclose = (e) => {
      clearInterval(this.pinger);
      if (this.stopped || FINAL_CLOSE.has(e.code)) return this.setStatus("closed");
      this.setStatus("reconnecting");
      setTimeout(() => this.connect(), Math.min(5000, 300 * 2 ** this.retry++));
    };
  }

  send(m: ClientMessage) {
    if (this.ws?.readyState === WebSocket.OPEN) return this.ws.send(JSON.stringify(m));
    // Input and pings are only useful live (the next state supersedes them); everything else must arrive.
    if (m.type !== "controller.input" && m.type !== "ping" && this.outbox.length < 50) this.outbox.push(m);
  }

  on(h: Handler) {
    this.handlers.add(h);
    return () => void this.handlers.delete(h);
  }

  onStatus(h: (s: SocketStatus) => void) {
    this.statusHandlers.add(h);
    return () => void this.statusHandlers.delete(h);
  }

  close() {
    this.stopped = true;
    clearInterval(this.pinger);
    this.ws?.close(1000);
  }
}

export async function api<T>(path: string, body?: unknown, headers: Record<string, string> = {}): Promise<T> {
  const r = await fetch(path, {
    method: body === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(data.message ?? `HTTP ${r.status}`), { code: data.error, status: r.status });
  return data as T;
}
