import type { ControlSpec } from "@playwithtv/protocol";
import type { QLang } from "../../content/trivia/types";
import { textOf } from "../../content/trivia/packs";
import type { ControlPlayers } from "../controlKit";
import type { GameBridge } from "../types";
import {
  answer, buzz, lockWager, player, round, setAway, setWager, standings, tick, wagerOf,
  type Game, type GameEvent, type Outcome,
} from "./engine";
import { correctPos } from "./plan";
import { STEAL_FIRST, emojiPoints } from "./scoring";
import { answerSpec, buzzSpec, posOf, waitSpec, wagerSpec } from "./controls";
import { say } from "./strings";
import type { Moment } from "./host";
import type { DhamakaSfx } from "./sfx";

/** A short-lived effect for the TV to animate (confetti burst, screen flash). */
export interface Fx { kind: "confetti" | "flash-good" | "flash-bad" | "shake"; at: number; id: number }

/**
 * Runs a match on the TV: drives the engine clock, turns phone actions into moves, plays the sounds, keeps
 * every phone on the right screen in its own language, and tells the host what to say.
 */
export class Director {
  host: { moment: Moment; n: number; at: number } = { moment: "intro", n: 0, at: 0 };
  fx: Fx[] = [];
  now = 0;
  private sent = new Map<string, string>();
  private status = new Map<string, string>();
  private fxId = 0;
  private beatAt = 0;
  private hurried = false;
  private finished = false;

  constructor(
    readonly g: Game,
    private kit: ControlPlayers,
    private bridge: GameBridge,
    readonly room: QLang,
    readonly langs: Map<string, QLang>,
    private sfx: DhamakaSfx,
    private onOver: () => void,
  ) {
    this.say("intro");
    this.sfx.play("jingleIntro", 0.55);
    this.sync();
  }

  lang(id: string): QLang {
    return this.langs.get(id) ?? this.room;
  }

  setAway(ids: string[]) {
    setAway(this.g, ids);
  }

  /** Advances the match by `dt` ms (not called while paused). */
  step(dt: number) {
    this.now += dt;
    const g = this.g;
    if (g.phase === "wager") this.slideWagers(dt);
    this.handle(tick(g, dt));
    this.heartbeat();
    this.fx = this.fx.filter((f) => this.now - f.at < 2500);
    this.sync();
  }

  action(id: string, action: string) {
    const g = this.g;
    if (!player(g, id)) return;
    if (action === "buzz") this.handle(buzz(g, id));
    else if (action === "allin") {
      setWager(g, id, 1);
      this.sfx.play("sparkle", 0.6);
      this.handle(lockWager(g, id));
    } else if (action === "lock") this.handle(lockWager(g, id));
    else {
      const pos = posOf(action);
      if (pos !== null) {
        const ev = answer(g, id, pos);
        if (ev.length || player(g, id)!.answer) this.sfx.play("select", 0.35);
        this.handle(ev);
      }
    }
    this.sync();
  }

  private say(moment: Moment) {
    this.host = { moment, n: this.host.n + 1, at: this.now };
  }

  private effect(kind: Fx["kind"]) {
    this.fx.push({ kind, at: this.now, id: ++this.fxId });
  }

  private handle(events: GameEvent[]) {
    const g = this.g;
    for (const e of events) {
      if (e.kind === "phase") this.onPhase();
      else if (e.kind === "reveal") {
        if (e.index > 0) this.sfx.thok();
        if (e.index < (round(g).q.emoji?.length ?? 0) - 1) this.sfx.drumroll(g.cfg.revealStep);
      } else if (e.kind === "buzz") {
        this.sfx.play("buzz", 0.9);
        this.bridge.event(e.id, "vibrate", { ms: 80 });
        this.effect("flash-good");
      } else if (e.kind === "wrong-buzz") {
        this.sfx.play("wrong", 0.8);
        this.sfx.play("vWrong", 0.6, 0.25);
        this.effect("shake");
        this.kit.toast(e.id, say(this.lang(e.id), e.timeout ? "pSlow" : "pWrongBuzz", { pts: e.penalty }), "bad");
        this.bridge.event(e.id, "vibrate", { ms: 300 });
        this.say("wrong");
      } else if (e.kind === "steal-open") {
        this.sfx.play("steal", 0.8, 0.5);
      } else if (e.kind === "answered") {
        this.kit.toast(e.id, say(this.lang(e.id), "pDone"), "info");
      } else if (e.kind === "result") this.onResult(e.outcome);
      else if (e.kind === "over") this.finish();
    }
  }

  private onPhase() {
    const g = this.g;
    const r = round(g);
    this.hurried = false;
    if (g.phase === "round-intro") {
      this.sfx.play("whoosh", 0.6);
      if (r.kind === "final") this.sfx.play("vFinal", 0.8, 0.3);
      this.say(r.kind);
    } else if (g.phase === "reveal") this.sfx.play("vGo", 0.5);
    else if (g.phase === "board") {
      this.sfx.play("jingleBoard", 0.5);
      this.sfx.play("shuffle", 0.5, 0.6);
      this.say("board");
    } else if (g.phase === "all" && r.kind === "emoji") this.say("nobody");
    else if (g.phase === "podium") {
      this.sfx.play("jingleWin", 0.6);
      this.sfx.play("vCongrats", 0.8, 1.2);
      this.effect("confetti");
      this.say("podium");
      this.outcomes();
    }
  }

  private onResult(o: Outcome) {
    const g = this.g;
    const r = round(g);
    const any = o.winners.length > 0;
    this.sfx.play(any ? "right" : "wrong", 0.7);
    if (any) this.sfx.play("vCorrect", 0.5, 0.35);
    else this.sfx.play("vTimeOver", 0.5, 0.35);
    const hot = o.winners.some((id) => (o.streaks[id] ?? 0) >= 3);
    if (o.stealer) this.say("steal");
    else if (o.comeback.length) this.say("comeback");
    else if (hot) this.say("streak");
    else this.say(any ? "right" : "nobody");
    if (o.stealer || hot || (r.kind === "final" && any)) this.effect("confetti");
    this.effect(any ? "flash-good" : "flash-bad");
    const ranks = standings(g).map((p) => p.id);
    for (const p of g.players) {
      const l = this.lang(p.id);
      const gain = o.gains[p.id] ?? 0;
      const tried = !!p.answer || p.locked || r.kind === "final";
      if (o.winners.includes(p.id)) this.kit.toast(p.id, say(l, "pRight", { pts: gain }), "good");
      else if (r.kind === "final" && gain < 0) this.kit.toast(p.id, `${say(l, "pWrong")} ${gain}`, "bad");
      else if (tried && !p.locked) this.kit.toast(p.id, say(l, "pWrong"), "bad");
      this.bridge.event(p.id, "vibrate", { ms: o.winners.includes(p.id) ? 120 : 40 });
      this.statusFor(p.id, ranks.indexOf(p.id) + 1);
    }
  }

  private statusFor(id: string, rank: number) {
    const p = player(this.g, id)!;
    const flame = p.streak >= 3 ? ` · 🔥${p.streak}` : "";
    const text = say(this.lang(id), "pStatus", { pts: p.score, n: rank }) + flame;
    if (this.status.get(id) === text) return;
    this.status.set(id, text);
    this.kit.status(id, { text });
  }

  /** ◀ ▶ moves the wager like a slider: full range in about 1.5 s. */
  private slideWagers(dt: number) {
    for (const p of this.g.players) {
      if (p.wagerLocked) continue;
      const x = this.kit.get(p.id).x;
      if (Math.abs(x) < 0.2) continue;
      setWager(this.g, p.id, p.wagerFrac + x * (dt / 1500));
    }
  }

  private heartbeat() {
    const g = this.g;
    const timed = g.phase === "answer" || g.phase === "steal" || g.phase === "all" || g.phase === "wager";
    if (!timed) return;
    const left = g.dur - g.t;
    const every = left < 2500 ? 330 : left < 5000 ? 600 : 1000;
    if (this.now - this.beatAt >= every) {
      this.beatAt = this.now;
      this.sfx.heartbeat();
    }
    if (!this.hurried && left < 3000 && g.dur > 4000) {
      this.hurried = true;
      this.sfx.play("vHurry", 0.45);
    }
  }

  private finish() {
    if (this.finished) return;
    this.finished = true;
    this.onOver();
  }

  /** Each phone's final screen, shown while the TV plays the podium. */
  private outcomes() {
    const ranks = standings(this.g);
    ranks.forEach((p, i) => {
      const l = this.lang(p.id);
      const first = i === 0 && p.score > 0;
      this.kit.outcome(p.id, first ? say(l, "pOutcomeWin") : say(l, "pOutcome", { n: i + 1, pts: p.score }), first ? "🏆" : i < 3 ? "🎉" : "👏");
    });
  }

  /** The screen each phone should show right now. */
  private specFor(id: string): ControlSpec {
    const g = this.g;
    const p = player(g, id)!;
    const l = this.lang(id);
    const r = round(g);
    const labels = () => {
      const t = textOf(r.q, l).t;
      return r.order.map((a) => t.answers[a]!);
    };
    switch (g.phase) {
      case "reveal":
        return p.locked ? waitSpec(l, say(l, "pLocked")) : buzzSpec(l);
      case "answer":
        if (id === g.buzzer) return answerSpec(l, labels(), g.out);
        return waitSpec(l, say(l, "buzzed", { name: this.nameOf(g.buzzer!) }));
      case "steal":
        if (p.locked) return waitSpec(l, say(l, "pLocked"));
        if (p.answer?.done) return waitSpec(l, say(l, "pDone"));
        return answerSpec(l, labels(), g.out);
      case "all": {
        if (p.answer?.done) return waitSpec(l, say(l, "pDone"));
        if (r.kind !== "order") return answerSpec(l, labels(), g.out);
        const seq = p.answer?.seq ?? [];
        return answerSpec(l, labels(), seq, () => `${seq.length + 1}.`);
      }
      case "wager":
        return p.wagerLocked ? waitSpec(l, say(l, "pDone")) : wagerSpec(l);
      default:
        return waitSpec(l);
    }
  }

  names = new Map<string, string>();
  private nameOf(id: string) {
    return this.names.get(id) ?? "";
  }

  /** Sends each phone its screen when it changes, and the wager bar while betting. */
  sync() {
    const g = this.g;
    if (g.phase === "over") return;
    for (const p of g.players) {
      const spec = this.specFor(p.id);
      const key = JSON.stringify(spec);
      if (this.sent.get(p.id) !== key) {
        this.sent.set(p.id, key);
        this.bridge.layout(p.id, "game", spec as unknown as Record<string, unknown>);
        if (g.phase === "answer" && p.id === g.buzzer) this.kit.toast(p.id, say(this.lang(p.id), "pYourTurn"), "good");
        if (g.phase === "steal" && !p.locked) this.kit.toast(p.id, say(this.lang(p.id), "pSteal"), "info");
      }
      if (g.phase === "wager" && !p.wagerLocked) {
        const w = wagerOf(p);
        const text = say(this.lang(p.id), "pWager", { pts: w });
        if (this.status.get(p.id) !== text) {
          this.status.set(p.id, text);
          this.kit.status(p.id, { text, bars: [{ label: "", value: p.wagerFrac, color: "#ff2e63" }] });
        }
      }
    }
  }

  /** Points on offer right now (for the TV's "Worth …" chip). */
  worth(): number {
    const g = this.g;
    if (g.phase === "steal") return STEAL_FIRST;
    return emojiPoints(Math.max(1, g.revealed));
  }

  correct(): number | number[] {
    const r = round(this.g);
    return r.kind === "order" ? (r.q.correct as number[]).map((a) => r.order.indexOf(a)) : correctPos(r);
  }
}
