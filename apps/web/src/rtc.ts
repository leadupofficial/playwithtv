/**
 * Direct phone → TV links over the home network (WebRTC data channels).
 *
 * The hub only introduces the two (it relays a few signalling messages); after that, motion input goes
 * straight from the phone to the TV across the Wi-Fi: no round trip to the server, no server bandwidth.
 * No STUN/TURN servers are configured, so a link only forms when both are on the same network, and no
 * public IP address is ever shared with a third party. If a direct link cannot open, input simply keeps
 * flowing through the server as before.
 */
import { InputState, type RtcSignal } from "@playwithtv/protocol";
import type { HubSocket } from "./net";

const ICE: RTCConfiguration = { iceServers: [] };
const OPEN_TIMEOUT_MS = 8000;
const MAX_DIRECT_BYTES = 4096;

type Direct = { t: "in"; seq: number; state: InputState } | { t: "ping"; at: number } | { t: "pong"; at: number };

/** Direct links are on by default; `?p2p=0` turns them off on this device (remembered), `?p2p=1` back on. */
export function p2pEnabled(): boolean {
  if (typeof RTCPeerConnection === "undefined") return false;
  try {
    const q = new URLSearchParams(location.search).get("p2p");
    if (q === "0") localStorage.setItem("pwtv.p2p", "off");
    if (q === "1") localStorage.removeItem("pwtv.p2p");
    return localStorage.getItem("pwtv.p2p") !== "off";
  } catch {
    return true;
  }
}

/** Just the fields the protocol carries (and validates) for an ICE candidate. */
function candidateOf(c: RTCIceCandidate) {
  return { candidate: c.candidate, sdpMid: c.sdpMid, sdpMLineIndex: c.sdpMLineIndex };
}

/** Candidates can arrive before the description they belong to; hold them until it is set. */
class CandidateQueue {
  private q: RTCIceCandidateInit[] = [];
  ready = false;
  constructor(private pc: RTCPeerConnection) {}
  add(c: RTCIceCandidateInit) {
    if (this.ready) void this.pc.addIceCandidate(c).catch(() => undefined);
    else this.q.push(c);
  }
  flush() {
    this.ready = true;
    for (const c of this.q.splice(0)) void this.pc.addIceCandidate(c).catch(() => undefined);
  }
}

/** Phone side: offers a link to the TV whenever the hub connection (re)opens, retries after failures. */
export class PhoneLink {
  mode: "server" | "direct" = "server";
  rttMs = 0;
  private pc: RTCPeerConnection | null = null;
  private dc: RTCDataChannel | null = null;
  private cands: CandidateQueue | null = null;
  private timers: Array<ReturnType<typeof setTimeout>> = [];
  private ping: ReturnType<typeof setInterval> | undefined;
  private off: () => void;

  constructor(private socket: HubSocket) {
    this.off = socket.on((m) => {
      if (m.type === "welcome") this.connect();
      if (m.type === "rtc.signal" && m.from === "tv") void this.onSignal(m.signal);
    });
  }

  /** Sends the latest controller state directly; false means "use the server instead". */
  send(seq: number, state: InputState): boolean {
    if (this.dc?.readyState !== "open") return false;
    try {
      this.dc.send(JSON.stringify({ t: "in", seq, state } satisfies Direct));
      return true;
    } catch {
      return false;
    }
  }

  connect() {
    if (!p2pEnabled()) return;
    this.teardown();
    const pc = new RTCPeerConnection(ICE);
    this.pc = pc;
    this.cands = new CandidateQueue(pc);
    // unordered, no retransmits: a late input frame is worthless, the next one carries the full state
    const dc = pc.createDataChannel("motion", { ordered: false, maxRetransmits: 0 });
    this.dc = dc;
    dc.onopen = () => {
      this.mode = "direct";
      this.clearTimers();
      this.ping = setInterval(() => dc.readyState === "open" && dc.send(JSON.stringify({ t: "ping", at: performance.now() })), 2000);
    };
    dc.onclose = () => this.fallBack(3000);
    dc.onmessage = (e) => {
      const m = JSON.parse(String(e.data)) as Direct;
      if (m.t === "pong") this.rttMs = Math.round(performance.now() - m.at);
    };
    pc.onicecandidate = (e) => e.candidate && this.signal({ candidate: candidateOf(e.candidate) });
    pc.onconnectionstatechange = () => pc.connectionState === "failed" && this.fallBack(15_000);
    void (async () => {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      this.signal({ sdp: { type: "offer", sdp: offer.sdp ?? "" } });
    })().catch(() => this.fallBack(15_000));
    // no link in time (different networks, blocked by the router): stay on the server, try again later
    this.timers.push(setTimeout(() => this.mode !== "direct" && this.fallBack(30_000), OPEN_TIMEOUT_MS));
  }

  close() {
    this.off();
    this.teardown();
  }

  private async onSignal(s: RtcSignal) {
    if (!this.pc) return;
    if ("sdp" in s && s.sdp.type === "answer") {
      await this.pc.setRemoteDescription(s.sdp).catch(() => undefined);
      this.cands?.flush();
    } else if ("candidate" in s) this.cands?.add(s.candidate);
    else if ("bye" in s) this.fallBack(3000);
  }

  private signal(signal: RtcSignal) {
    this.socket.send({ type: "rtc.signal", to: "tv", signal });
  }

  private fallBack(retryMs: number) {
    this.teardown();
    this.timers.push(setTimeout(() => this.connect(), retryMs));
  }

  private clearTimers() {
    this.timers.forEach(clearTimeout);
    this.timers = [];
  }

  private teardown() {
    this.clearTimers();
    clearInterval(this.ping);
    this.mode = "server";
    this.dc?.close();
    this.pc?.close();
    this.dc = this.pc = null;
    this.cands = null;
  }
}

/** TV side: answers each phone's offer and delivers validated input frames from the direct links. */
export class TvLinks {
  private peers = new Map<string, { pc: RTCPeerConnection; cands: CandidateQueue; open: boolean }>();
  private cbs = new Set<(playerId: string, seq: number, state: InputState) => void>();
  private off: () => void;

  constructor(private socket: HubSocket) {
    this.off = socket.on((m) => m.type === "rtc.signal" && m.from !== "tv" && void this.onSignal(m.from, m.signal));
  }

  onInput(cb: (playerId: string, seq: number, state: InputState) => void) {
    this.cbs.add(cb);
    return () => void this.cbs.delete(cb);
  }

  /** Players currently on a direct link. */
  direct(): string[] {
    return [...this.peers].filter(([, p]) => p.open).map(([id]) => id);
  }

  close() {
    this.off();
    for (const id of [...this.peers.keys()]) this.drop(id);
  }

  private async onSignal(from: string, s: RtcSignal) {
    if ("sdp" in s && s.sdp.type === "offer") {
      if (!p2pEnabled()) return this.socket.send({ type: "rtc.signal", to: from, signal: { bye: true } });
      this.drop(from);
      const pc = new RTCPeerConnection(ICE);
      const peer = { pc, cands: new CandidateQueue(pc), open: false };
      this.peers.set(from, peer);
      pc.onicecandidate = (e) => e.candidate && this.socket.send({ type: "rtc.signal", to: from, signal: { candidate: candidateOf(e.candidate) } });
      pc.onconnectionstatechange = () => (pc.connectionState === "failed" || pc.connectionState === "closed") && this.peers.get(from)?.pc === pc && this.drop(from);
      pc.ondatachannel = (e) => {
        const dc = e.channel;
        dc.onopen = () => { peer.open = true; };
        dc.onclose = () => { peer.open = false; };
        dc.onmessage = (ev) => this.receive(from, dc, ev.data);
      };
      try {
        await pc.setRemoteDescription(s.sdp);
        peer.cands.flush();
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        this.socket.send({ type: "rtc.signal", to: from, signal: { sdp: { type: "answer", sdp: answer.sdp ?? "" } } });
      } catch {
        this.drop(from);
      }
    } else if ("candidate" in s) this.peers.get(from)?.cands.add(s.candidate);
    else if ("bye" in s) this.drop(from);
  }

  /** Everything from a phone is untrusted: size-capped, parsed, and validated like hub input. */
  private receive(from: string, dc: RTCDataChannel, raw: unknown) {
    if (typeof raw !== "string" || raw.length > MAX_DIRECT_BYTES) return;
    let m: Direct;
    try {
      m = JSON.parse(raw);
    } catch {
      return;
    }
    if (m.t === "ping" && typeof m.at === "number") return dc.send(JSON.stringify({ t: "pong", at: m.at }));
    if (m.t !== "in" || !Number.isInteger(m.seq) || m.seq < 0) return;
    const state = InputState.safeParse(m.state);
    if (state.success) this.cbs.forEach((cb) => cb(from, m.seq, state.data));
  }

  private drop(id: string) {
    const p = this.peers.get(id);
    this.peers.delete(id);
    p?.pc.close();
  }
}

/**
 * Merges the two input paths (direct link and hub relay) per player: only frames newer than the last one
 * seen get through, so a frame that arrives both ways is used once and a late one never overrides a newer one.
 */
export class InputMerger {
  private last = new Map<string, number>();
  accept(playerId: string, seq: number): boolean {
    if (seq <= (this.last.get(playerId) ?? -1)) return false;
    this.last.set(playerId, seq);
    return true;
  }
  /** The player's phone disconnected (it may come back reloaded, counting from 0 again). */
  reset(playerId: string) {
    this.last.delete(playerId);
  }
}

/**
 * The TV's single source of controller input: hub relay + direct links, merged and de-duplicated once,
 * then fanned out to every game subscriber.
 */
export class TvInputs {
  readonly links: TvLinks;
  private merger = new InputMerger();
  private inputCbs = new Set<(playerId: string, state: InputState) => void>();
  private clearCbs = new Set<(playerId: string) => void>();
  private offs: Array<() => void>;

  constructor(socket: HubSocket) {
    this.links = new TvLinks(socket);
    this.offs = [
      socket.on((m) => {
        if (m.type === "controller.input") this.deliver(m.playerId, m.seq, m.state);
        if (m.type === "controller.clear") {
          this.merger.reset(m.playerId);
          this.clearCbs.forEach((cb) => cb(m.playerId));
        }
      }),
      this.links.onInput((id, seq, state) => this.deliver(id, seq, state)),
    ];
  }

  onInput(cb: (playerId: string, state: InputState) => void) {
    this.inputCbs.add(cb);
    return () => void this.inputCbs.delete(cb);
  }

  onClear(cb: (playerId: string) => void) {
    this.clearCbs.add(cb);
    return () => void this.clearCbs.delete(cb);
  }

  close() {
    this.offs.forEach((off) => off());
    this.links.close();
  }

  private deliver(id: string, seq: number, state: InputState) {
    if (this.merger.accept(id, seq)) this.inputCbs.forEach((cb) => cb(id, state));
  }
}

// Read ?p2p= as soon as the app loads: the join page clears the query string (to drop invite tokens).
if (typeof window !== "undefined") p2pEnabled();
