/**
 * kitcouple/Shell: the TV side every couples game shares.
 *
 *   practice → chapters → (age check, After Dark only) → story → cards → result → chapters … → Finish
 *
 * Two phones play together. Picks are secret (they live on each phone's buttons and the TV only shows a
 * lock until both are in). Progress and rewards stay on the TV (kitgrid/progress), the 18+ confirmation
 * only lasts for this match and is never saved.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { ControlSpec, PlayerView } from "@playwithtv/protocol";
import type { GameProps } from "../types";
import { ControlPlayers } from "../controlKit";
import { ControlTutorial } from "../ControlTutorial";
import { AVATARS } from "../../avatars";
import { GridSfx } from "../kitgrid/sfx";
import { load, nextReward, record, save, total, unlocked, type Progress } from "../kitgrid/progress";
import type { Reward } from "../kitgrid/types";
import { CHAPTERS, CoupleMatch, SPICY, chapterOpen, deal, type Action, type Card, type CoupleTitle, type MatchEvent } from "./engine";
import "./couple.css";

const QUICK = typeof location !== "undefined" && new URLSearchParams(location.search).get("quick") === "1";
const ACTIONS: Action[] = ["o0", "o1", "o2", "o3", "pass"];
const COLORS = ["#ff6b8b", "#5b8def", "#f5b62e", "#3fbf7f"];

export function controlsFor(name: string): ControlSpec {
  return {
    title: name,
    modes: ["buttons"],
    stick: "none",
    tilt: "none",
    actions: [
      ...["🅰", "🅱", "🅲", "🅳"].map((label, i) => ({ id: `o${i}`, label, color: COLORS[i] })),
      { id: "pass", label: "🙅 Pass", color: "#8a8fa3" },
    ],
    hints: { buttons: "Your picks stay secret on your phone until both of you are in" },
  };
}

type Phase = "chapters" | "gate" | "story" | "play" | "result";

export function CoupleShell({ title, players, bridge, paused, onFinish }: GameProps & { title: CoupleTitle }) {
  const pair = useRef(players.filter((p) => p.connected).slice(0, 2)).current;
  const controls = useMemo(() => controlsFor(title.name), [title]);
  const kit = useRef<ControlPlayers | null>(null);
  kit.current ??= new ControlPlayers(bridge, pair.map((p) => p.id), controls);
  const [practising, setPractising] = useState(true);
  useEffect(() => {
    kit.current!.start();
    return () => kit.current!.dispose();
  }, []);
  if (practising) {
    return (
      <div className="tv couple" style={{ background: title.themes[""] }}>
        <ControlTutorial title={`${title.emoji} ${title.name}`} players={pair} kit={kit.current} practice={[]} quick={QUICK} onDone={() => setPractising(false)} />
      </div>
    );
  }
  if (pair.length < 2) {
    return (
      <div className="tv couple center" style={{ background: title.themes[""] }}>
        <h1>{title.emoji} {title.name}</h1>
        <p className="couple-lead">This one is for two. Join with a second phone and start again.</p>
      </div>
    );
  }
  return <Journey title={title} pair={pair as [PlayerView, PlayerView]} kit={kit.current} bridge={bridge} paused={paused} onFinish={onFinish} />;
}

function Stars({ n }: { n: number }) {
  return <span className="couple-stars" aria-label={`${n} of 3 stars`}>{[0, 1, 2].map((i) => <span key={i} className={i < n ? "on" : ""}>★</span>)}</span>;
}

function Journey({ title, pair, kit, bridge, paused, onFinish }: {
  title: CoupleTitle; pair: [PlayerView, PlayerView]; kit: ControlPlayers; bridge: GameProps["bridge"]; paused: boolean; onFinish: GameProps["onFinish"];
}) {
  const campaign = useMemo(() => ({ id: title.id, levels: CHAPTERS, rewards: title.rewards }), [title]);
  const [progress, setProgress] = useState<Progress>(() => load(campaign));
  const [phase, setPhase] = useState<Phase>("chapters");
  const [cursor, setCursor] = useState(() => {
    const first = load(campaign).stars.findIndex((s, i) => s === 0 && i !== SPICY);
    return first < 0 ? 0 : first;
  });
  const [match, setMatch] = useState<CoupleMatch | null>(null);
  const [result, setResult] = useState<{ stars: number; fresh: Reward[]; best: boolean } | null>(null);
  const [gate, setGate] = useState<[boolean, boolean]>([false, false]);
  const [, rerender] = useState(0);
  const adults = useRef(false); // both confirmed 18+ during this match (never saved)
  const used = useRef(new Set<Card>());
  const hearts = useRef(0);
  const startedAt = useRef(Date.now());
  const finished = useRef(false);
  const sfx = useMemo(() => new GridSfx(), []);
  const names: [string, string] = [pair[0].name, pair[1].name];
  const live = useRef({ phase, cursor, progress, match, paused, gate });
  live.current = { phase, cursor, progress, match, paused, gate };

  useEffect(() => () => sfx.dispose(), [sfx]);

  const finish = () => {
    if (finished.current) return;
    finished.current = true;
    for (const p of pair) kit.outcome(p.id, `${hearts.current} ❤ together`, "💞");
    // a couple plays together: both share first place and the heart total
    onFinish(pair.map((p) => ({ playerId: p.id, score: hearts.current, place: 1 })), Date.now() - startedAt.current);
  };

  const emit = (evs: MatchEvent[]) => {
    for (const e of evs) {
      if (e.sfx) sfx.play(e.sfx);
      const to = e.to === "both" ? pair : [pair[e.to]];
      for (const p of to) {
        if (e.toast) kit.toast(p.id, e.toast, e.tone ?? "info");
        if (e.buzz) bridge.event(p.id, "vibrate", { ms: e.buzz });
      }
    }
  };

  const begin = (chapter: number) => {
    const m = new CoupleMatch(deal(title.cards, chapter, Math.random, used.current, QUICK), names);
    setMatch(m);
    setPhase("play");
  };

  const open = (chapter: number) => {
    if (CHAPTERS[chapter]!.spicy && !adults.current) {
      setGate([false, false]);
      setPhase("gate");
      return;
    }
    setPhase("story");
  };

  const endChapter = (m: CoupleMatch) => {
    const ch = live.current.cursor;
    const stars = m.stars();
    hearts.current += m.hearts;
    const before = live.current.progress.stars[ch] ?? 0;
    // After Dark is a bonus: it never counts towards (or locks) rewards, so nobody has to play it
    if (CHAPTERS[ch]!.spicy) {
      setResult({ stars, fresh: [], best: false });
    } else {
      const { progress: next, fresh } = record(campaign, live.current.progress, ch, stars);
      save(campaign, next);
      setProgress(next);
      setResult({ stars, fresh, best: stars > before });
      if (fresh.length) setTimeout(() => sfx.play("star"), 1400);
    }
    for (let i = 0; i < stars; i++) setTimeout(() => sfx.play("star"), 400 + i * 300);
    setPhase("result");
  };

  // phone buttons and status follow the phase
  useEffect(() => {
    const hide: Record<Action, string> = { o0: "", o1: "", o2: "", o3: "", pass: "" };
    pair.forEach((p, who) => {
      if (phase === "chapters") {
        kit.status(p.id, { text: "Pick a chapter together", labels: { ...hide, o0: "◀ Chapter", o1: "Chapter ▶", o2: "▶ Play", o3: "✓ Finish" } });
      } else if (phase === "gate") {
        kit.status(p.id, gate[who as 0 | 1]
          ? { text: "Thanks! Waiting for your partner…", labels: hide }
          : { text: "After Dark is for adults. Are you 18 or older?", labels: { ...hide, o0: "✅ I'm 18+", o1: "✖ Not for us" } });
      } else if (phase === "story") {
        kit.status(p.id, { text: "Tap ▶ to start the chapter", labels: { ...hide, o0: "▶ Start" } });
      } else if (phase === "result") {
        kit.status(p.id, { text: "▶ next chapter, ◀ chapters, ✓ finish", labels: { ...hide, o0: "▶ Next", o1: "◀ Chapters", o3: "✓ Finish" } });
      } else if (match) {
        kit.status(p.id, { text: match.status(who as 0 | 1), labels: match.labels(who as 0 | 1) });
      }
    });
  });

  // phone actions
  useEffect(() => kit.onAction((id, action) => {
    const L = live.current;
    const at = pair.findIndex((p) => p.id === id);
    if (at < 0 || L.paused || finished.current) return;
    const who = at as 0 | 1;
    const a = action as Action;
    if (L.phase === "play" && L.match) {
      emit(L.match.act(who, a));
      if (L.match.step === "done") setTimeout(() => endChapter(L.match!), 700);
      rerender((n) => n + 1);
      return;
    }
    if (L.phase === "chapters") {
      if (a === "o0") { setCursor((c) => (c + CHAPTERS.length - 1) % CHAPTERS.length); sfx.play("move"); }
      else if (a === "o1") { setCursor((c) => (c + 1) % CHAPTERS.length); sfx.play("move"); }
      else if (a === "o2") {
        if (chapterOpen(L.progress.stars, L.cursor)) { sfx.play("select"); open(L.cursor); }
        else kit.toast(id, "🔒 Finish the chapter before this one first", "info");
      } else if (a === "o3") { sfx.play("back"); finish(); }
      return;
    }
    if (L.phase === "gate") {
      if (a === "o1") {
        setPhase("chapters");
        for (const p of pair) kit.toast(p.id, "No problem. After Dark stays closed", "info");
        return;
      }
      if (a !== "o0") return;
      const g: [boolean, boolean] = [...L.gate];
      g[who] = true;
      setGate(g);
      if (g[0] && g[1]) { adults.current = true; setPhase("story"); }
      return;
    }
    if (L.phase === "story") {
      if (a === "o0") begin(L.cursor);
      return;
    }
    if (L.phase === "result") {
      setResult(null);
      if (a === "o0") {
        // next chapter in the journey (After Dark is never chosen for you)
        let n = L.cursor + 1;
        while (n < CHAPTERS.length && CHAPTERS[n]!.spicy) n++;
        if (n < CHAPTERS.length && chapterOpen(L.progress.stars, n)) { setCursor(n); open(n); }
        else setPhase("chapters");
      } else if (a === "o1") setPhase("chapters");
      else if (a === "o3") finish();
    }
  }), [kit]); // eslint-disable-line react-hooks/exhaustive-deps

  const theme = title.themes[progress.theme] ?? title.themes[""];
  const owned = unlocked(campaign, progress.stars);
  const upcoming = nextReward(campaign, progress.stars);
  const ch = CHAPTERS[cursor]!;
  const state = { phase, chapter: cursor, step: match?.step, round: match?.i, hearts: match?.hearts, kind: match?.round.kind, stars: progress.stars, gate, result };

  return (
    <div className="tv couple" style={{ background: theme }} data-couple={JSON.stringify(state)}>
      <div className="couple-top">
        <span className="couple-title"><span>{title.emoji}</span>{title.name}</span>
        <span className="couple-pair">
          {pair.map((p) => <span key={p.id} style={{ borderColor: p.color }}>{AVATARS[p.avatar]?.emoji} {p.name}</span>)}
        </span>
        {match && phase === "play" && (
          <>
            <span className="couple-chip">{ch.emoji} {ch.name} · {match.i + 1} / {match.rounds.length}</span>
            <span className="couple-meter" aria-label="heart meter"><span style={{ width: `${(match.hearts / match.rounds.length) * 100}%` }} /> ❤ {match.hearts}</span>
          </>
        )}
      </div>

      {phase === "chapters" && (
        <div className="couple-chapters">
          <p className="couple-lead">{title.tagline}</p>
          <div className="couple-path">
            {CHAPTERS.map((c, i) => {
              const ok = chapterOpen(progress.stars, i);
              return (
                <div key={c.name} className={`couple-stop ${i === cursor ? "on" : ""} ${ok ? "" : "locked"} ${c.spicy ? "spicy" : ""}`}>
                  <span className="emoji">{ok ? c.emoji : "🔒"}</span>
                  <span className="name">{c.name}</span>
                  {c.spicy ? <span className="tag">18+ · optional</span> : <Stars n={progress.stars[i] ?? 0} />}
                </div>
              );
            })}
          </div>
          <p className="couple-brief">
            {ch.spicy
              ? "Flirty truths and dares for adult couples. Both of you confirm you're 18+ first, and either of you can pass anything."
              : chapterOpen(progress.stars, cursor) ? title.stories[cursor]!.split(". ")[0] + "." : "Finish the chapter before this one to open it."}
          </p>
          <div className="couple-rewards">
            {title.rewards.map((r) => (
              <span key={r.id} className={`couple-reward ${owned.some((o) => o.id === r.id) ? "owned" : ""}`}>
                {r.emoji} {r.name} <small>{owned.some((o) => o.id === r.id) ? "✓" : `${r.stars} ★`}</small>
              </span>
            ))}
          </div>
          <p className="couple-foot">★ {total(progress.stars)} / 12{upcoming ? ` · ${upcoming.stars - total(progress.stars)} more ★ for ${upcoming.emoji} ${upcoming.name}` : " · every reward unlocked!"}</p>
        </div>
      )}

      {phase === "gate" && (
        <div className="couple-card center">
          <div className="big">🌶️</div>
          <h2>After Dark is for adults only</h2>
          <p>Flirty, never explicit. Both of you confirm on your phones that you're 18 or older.<br />Either of you can pass any card, any time.</p>
          <div className="couple-gate">
            {pair.map((p, i) => <span key={p.id} className={gate[i] ? "yes" : ""}>{gate[i] ? "✅" : "…"} {p.name}</span>)}
          </div>
        </div>
      )}

      {phase === "story" && (
        <div className="couple-card center">
          <div className="big">{ch.emoji}</div>
          <h2>Chapter {cursor + 1} · {ch.name}</h2>
          <p>{title.stories[cursor]}</p>
          <p className="couple-how">{title.howTo}</p>
        </div>
      )}

      {phase === "play" && match && <Play match={match} pair={pair} />}

      {phase === "result" && match && result && (
        <div className="couple-card center">
          <h2>{ch.emoji} {ch.name} complete!</h2>
          <Stars n={result.stars} />
          <p className="couple-hearts">❤ {match.hearts} / {match.rounds.length}{result.best ? " · new best!" : ""}</p>
          <ul className="couple-checks">
            {match.checks().map((c) => <li key={c.text} className={c.ok ? "ok" : ""}>{c.ok ? "★" : "☆"} {c.text}</li>)}
          </ul>
          {result.fresh.map((r) => <p key={r.id} className="couple-unlock">🎁 Unlocked: {r.emoji} {r.name}</p>)}
          {ch.spicy && <p className="couple-how">After Dark is a bonus chapter: it doesn't count towards rewards.</p>}
        </div>
      )}

      {paused && <div className="paused-overlay"><div className="big-title">⏸ Paused</div><p className="hint">The TV lost its connection; reconnecting…</p></div>}
    </div>
  );
}

const LETTERS = ["A", "B", "C", "D"];

function Play({ match, pair }: { match: CoupleMatch; pair: [PlayerView, PlayerView] }) {
  const r = match.round;
  const reveal = match.step === "reveal";
  const avatar = (who: 0 | 1) => AVATARS[pair[who].avatar]?.emoji ?? "🙂";
  const waiting = match.waitingOn();

  if (r.kind === "lantern") {
    const actor = pair[r.actor];
    return (
      <div className="couple-play">
        {match.step === "ask" ? (
          <>
            <h2 className="couple-prompt">{avatar(r.actor)} {actor.name}, pick a lantern</h2>
            <div className="couple-lanterns">
              <div className="lantern truth"><span>🏮</span>Truth</div>
              <div className="lantern dare"><span>🏮</span>Dare</div>
            </div>
          </>
        ) : (
          <div className={`couple-dare ${match.choice}`}>
            <div className="kind">{match.choice === "truth" ? "💬 Truth" : "🔥 Dare"} for {actor.name}</div>
            <div className="text">{match.fill(match.choice === "truth" ? r.truth : r.dare)}</div>
            {reveal && <div className="couple-verdict">{match.ended === "done" ? "❤ Done! The meter fills" : "🙅 Passed. Totally fine, on to the next"}</div>}
          </div>
        )}
      </div>
    );
  }

  const opts = r.kind === "pick" ? r.options : r.options;
  const prompt = r.kind === "pick" ? r.prompt : match.fill(r.prompt);
  return (
    <div className="couple-play">
      <h2 className="couple-prompt">{prompt}</h2>
      {r.kind === "guess" && <p className="couple-sub">{pair[r.actor].name} answers honestly · {pair[1 - r.actor]!.name} guesses</p>}
      <div className={`couple-options n${opts.length}`}>
        {opts.map((o, k) => {
          const who = ([0, 1] as const).filter((p) => match.picks[p] === k);
          const truth = r.kind === "guess" && reveal && match.picks[r.actor] === k;
          return (
            <div key={k} className={`couple-option c${k} ${truth ? "truth" : ""}`}>
              <span className="letter">{LETTERS[k]}</span>
              <span className="text">{o}</span>
              {reveal && <span className="who">{who.map((p) => <span key={p} title={pair[p].name}>{avatar(p)}</span>)}</span>}
            </div>
          );
        })}
      </div>
      <div className="couple-locks">
        {reveal
          ? <span className={`couple-verdict ${match.matched() ? "good" : ""}`}>{match.matched() ? (r.kind === "pick" ? "💞 Same path! +❤" : `💞 ${pair[1 - r.actor]!.name} guessed right! +❤`) : r.kind === "pick" ? "Different paths. Tell each other why!" : "Not quite. Tell the story behind it!"}</span>
          : pair.map((p, i) => <span key={p.id} className={waiting.includes(i as 0 | 1) ? "" : "in"}>{waiting.includes(i as 0 | 1) ? "…" : "🔒"} {p.name}</span>)}
      </div>
    </div>
  );
}
