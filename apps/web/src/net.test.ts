import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { API_TIMEOUT_MS, HubSocket, SILENCE_MS, api } from "./net";

/** A stand-in browser WebSocket: the test decides when it opens, what the hub says, and whether it ever closes. */
class FakeSocket {
  static OPEN = 1;
  static all: FakeSocket[] = [];
  readyState = 0;
  sent: { type: string }[] = [];
  closed = false;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: ((e: { code: number }) => void) | null = null;
  constructor(public url: string) {
    FakeSocket.all.push(this);
  }
  send(s: string) {
    this.sent.push(JSON.parse(s));
  }
  close() {
    this.closed = true; // a half-open connection: the browser never fires onclose
  }
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
  hub(m: object) {
    this.onmessage?.({ data: JSON.stringify(m) });
  }
}

describe("hub socket: a connection that goes silent is replaced", () => {
  beforeEach(() => {
    FakeSocket.all = [];
    vi.useFakeTimers();
    vi.stubGlobal("WebSocket", FakeSocket);
    vi.stubGlobal("location", { protocol: "http:", host: "tv.test" });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("reconnects and re-sends hello when the hub never answers the hello (the TV would sit on '····' forever)", () => {
    const s = new HubSocket({ type: "hello", v: 1, role: "tv", roomId: "r", hostToken: "t" } as never);
    const seen: string[] = [];
    s.onStatus((x) => seen.push(x));
    FakeSocket.all[0]!.open();
    expect(FakeSocket.all[0]!.sent[0]!.type).toBe("hello");
    vi.advanceTimersByTime(SILENCE_MS + 2500);
    expect(FakeSocket.all[0]!.closed).toBe(true);
    expect(seen).toContain("reconnecting");
    vi.advanceTimersByTime(400);
    expect(FakeSocket.all).toHaveLength(2);
    FakeSocket.all[1]!.open();
    expect(FakeSocket.all[1]!.sent[0]!.type).toBe("hello");
    expect(s.status).toBe("open");
    s.close();
  });

  it("keeps a live connection: pongs every 2 s hold it open indefinitely", () => {
    const s = new HubSocket({ type: "hello", v: 1, role: "tv", roomId: "r", hostToken: "t" } as never);
    const ws = FakeSocket.all[0]!;
    ws.open();
    ws.hub({ type: "welcome" });
    for (let i = 0; i < 30; i++) {
      vi.advanceTimersByTime(2000);
      ws.hub({ type: "pong", t: Date.now() });
    }
    expect(ws.closed).toBe(false);
    expect(FakeSocket.all).toHaveLength(1);
    expect(s.status).toBe("open");
    s.close();
  });

  it("a mid-game connection whose pongs stop is dropped, so the TV pauses and reconnects instead of hanging", () => {
    const s = new HubSocket({ type: "hello", v: 1, role: "tv", roomId: "r", hostToken: "t" } as never);
    const ws = FakeSocket.all[0]!;
    ws.open();
    ws.hub({ type: "welcome" });
    vi.advanceTimersByTime(SILENCE_MS + 2500); // the network died without a FIN: no close event, no pongs
    expect(s.status).toBe("reconnecting");
    vi.advanceTimersByTime(400);
    expect(FakeSocket.all).toHaveLength(2);
    s.close();
  });

  it("a hidden tab whose timers are throttled to once a minute is not mistaken for a dead connection", () => {
    const s = new HubSocket({ type: "hello", v: 1, role: "tv", roomId: "r", hostToken: "t" } as never);
    const ws = FakeSocket.all[0]!;
    ws.open();
    ws.hub({ type: "welcome" });
    // the browser runs the 2 s timer only once a minute: the clock jumps, then a single tick; its ping is answered
    for (let i = 0; i < 3; i++) {
      vi.setSystemTime(Date.now() + 60_000);
      vi.advanceTimersByTime(2000);
      ws.hub({ type: "pong", t: Date.now() });
    }
    expect(ws.closed).toBe(false);
    s.close();
  });
});

describe("api: a request that never answers", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("fails after API_TIMEOUT_MS instead of hanging, so the TV retries room creation rather than showing '····' forever", async () => {
    vi.useFakeTimers();
    // a stalled connection: the request is never answered, only aborted
    vi.stubGlobal("fetch", (_: string, init: RequestInit) => new Promise((_ok, fail) => {
      init.signal!.addEventListener("abort", () => fail(new DOMException("aborted", "AbortError")));
    }));
    const p = api("/api/rooms", {});
    const seen = p.then(() => "answered", (e: { code?: string }) => e.code ?? "error");
    await vi.advanceTimersByTimeAsync(API_TIMEOUT_MS + 10);
    await expect(Promise.race([seen, Promise.resolve("still waiting")])).resolves.toBe("timeout");
  });

  it("an ordinary answer comes back unchanged", async () => {
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ roomId: "r" }), { status: 200 }));
    await expect(api("/api/rooms", {})).resolves.toEqual({ roomId: "r" });
  });
});
