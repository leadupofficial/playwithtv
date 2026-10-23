import { useEffect, useMemo, useRef, useState } from "react";
import { zoneOf } from "@playwithtv/motion";
import type { GameProps } from "../types";
import { AVATARS } from "../../avatars";
import { QUESTIONS } from "./questions";
import { makeRounds, placings, points, QUESTION_MS, ROUNDS } from "./engine";
import { MotionPlayers, type MotionControl } from "../motionKit";
import { MotionTutorial } from "../MotionTutorial";
import "./trivia.css";

type Phase = "tutorial" | "intro" | "question" | "reveal" | "board" | "done";
const CONTROLS: MotionControl[] = [{ motion: "roll", label: "move your marker to an answer" }, { motion: "push", label: "lock it in" }];
/** ?quick=1 on the TV URL: 3 short rounds, used by the end-to-end tests and for quick demos. */
const QUICK = typeof location !== "undefined" && new URLSearchParams(location.search).get("quick") === "1";
const SCALE = QUICK ? 0.25 : 1;
const PHASE_MS: Record<Exclude<Phase, "tutorial" | "question" | "done">, number> = { intro: 3000 * SCALE, reveal: 4200 * SCALE, board: 3200 * SCALE };
export const SHAPES = ["▲", "◆", "●", "■"];

interface Answer { option: number; msLeft: number }

/**
 * Tamil Trivia Royale on the TV. Motion only: each player turns their phone like a steering wheel to move
 * their marker across the four answers, and pushes it towards the TV to lock in the answer under the marker.
 */
export function TriviaGame({ players, bridge, paused, onFinish, sponsor }: GameProps) {
  const rounds = useMemo(() => makeRounds(QUESTIONS, QUICK ? 3 : ROUNDS, Math.random), []);
  const [round, setRound] = useState(0);
  const [phase, setPhase] = useState<Phase>("tutorial");
  const [left, setLeft] = useState(PHASE_MS.intro);   // ms left in the current phase
  const [answers, setAnswers] = useState<Map<string, Answer>>(new Map());
  const [scores, setScores] = useState<Map<string, number>>(() => new Map(players.map((p) => [p.id, 0])));
  const [gained, setGained] = useState<Map<string, number>>(new Map());
  const kit = useMemo(() => new MotionPlayers(bridge, players.map((p) => p.id)), [bridge]); // eslint-disable-line react-hooks/exhaustive-deps
  const [aims, setAims] = useState<Map<string, number>>(new Map());
  const live = useRef({ phase, left, answers, round });
  live.current = { phase, left, answers, round };
  const startedAt = useRef(Date.now());
  const r = rounds[round]!;
  const aimOf = (id: string) => zoneOf(kit.get(id).roll, 4);

  useEffect(() => {
    kit.start();
    kit.controls("all", "Tamil Trivia Royale", CONTROLS);
    return () => kit.dispose();
  }, [kit]);

  // A push locks the answer under the player's marker; the first lock per question counts.
  useEffect(() => kit.onGesture((pid, g) => {
    const { phase: ph, left: ms, answers: ans } = live.current;
    if (g.kind !== "push" || ph !== "question" || ans.has(pid) || !players.some((p) => p.id === pid)) return;
    const opt = aimOf(pid);
    setAnswers(new Map(ans).set(pid, { option: opt, msLeft: ms }));
    kit.toast(pid, `Locked in ${SHAPES[opt]}`);
    bridge.event(pid, "vibrate", { ms: 40 });
  }), [kit, players]); // eslint-disable-line react-hooks/exhaustive-deps

  // Where each player is pointing, refreshed 10 times a second.
  useEffect(() => {
    const id = setInterval(() => setAims(new Map(players.map((p) => [p.id, aimOf(p.id)]))), 100);
    return () => clearInterval(id);
  }, [kit]); // eslint-disable-line react-hooks/exhaustive-deps

  // Phase clock (frozen while paused).
  useEffect(() => {
    if (paused || phase === "done" || phase === "tutorial") return;
    const id = setInterval(() => setLeft((l) => l - 100), 100);
    return () => clearInterval(id);
  }, [paused, phase]);

  // Everyone answered: no need to wait for the timer.
  useEffect(() => {
    const here = players.filter((p) => p.connected); // a reconnecting player must not hold up the round
    if (phase === "question" && here.length > 0 && here.every((p) => answers.has(p.id))) setLeft(0);
  }, [answers, phase, players]);

  // Phase transitions.
  useEffect(() => {
    if (left > 0 || paused) return;
    if (phase === "intro") return startQuestion();
    if (phase === "question") return reveal();
    if (phase === "reveal") {
      setPhase("board");
      setLeft(PHASE_MS.board);
      return;
    }
    if (phase === "board") {
      if (round + 1 < rounds.length) {
        setRound(round + 1);
        startQuestion();
      } else {
        setPhase("done");
        onFinish(placings(scores), Date.now() - startedAt.current);
      }
    }
  }, [left, paused]); // eslint-disable-line react-hooks/exhaustive-deps

  function startQuestion() {
    const idx = live.current.phase === "board" ? live.current.round + 1 : live.current.round;
    const rr = rounds[idx]!;
    setAnswers(new Map());
    setGained(new Map());
    setPhase("question");
    setLeft(QUESTION_MS);
    kit.status("all", { text: `Question ${idx + 1} / ${rounds.length}: aim and push to answer` });
    void rr;
  }

  function reveal() {
    const g = new Map<string, number>();
    const s = new Map(scores);
    for (const p of players) {
      const a = answers.get(p.id);
      const pts = a ? points(a.option === r.correct, a.msLeft) : 0;
      g.set(p.id, pts);
      s.set(p.id, (s.get(p.id) ?? 0) + pts);
      const ok = !!a && a.option === r.correct;
      kit.toast(p.id, ok ? `✅ Correct! +${pts}` : a ? "❌ Not this time" : "⏰ Too slow", ok ? "good" : "bad");
      kit.status(p.id, { text: `${s.get(p.id)} points` });
      bridge.event(p.id, "vibrate", { ms: ok ? 120 : 300 });
    }
    setGained(g);
    setScores(s);
    setPhase("reveal");
    setLeft(PHASE_MS.reveal);
  }

  const sorted = [...players].sort((a, b) => (scores.get(b.id) ?? 0) - (scores.get(a.id) ?? 0));

  return (
    <div className="trivia">
      <div className="trivia-top">
        <span className="chip">🧠 Tamil Trivia Royale</span>
        <span className="chip">Question {Math.min(round + 1, rounds.length)} / {rounds.length}</span>
        {sponsor && <span className="chip sponsor-chip">Quiz sponsored by <b>{sponsor.name}</b></span>}
        {phase === "question" && <span className="chip timer">{Math.ceil(left / 1000)}s</span>}
      </div>
      {phase === "question" && <div className="timebar"><div style={{ width: `${(left / QUESTION_MS) * 100}%` }} /></div>}

      {phase === "tutorial" && (
        <MotionTutorial title="🧠 Tamil Trivia Royale" players={players} kit={kit} controls={CONTROLS} practice={["push"]} quick={QUICK}
          onDone={() => { setPhase("intro"); setLeft(PHASE_MS.intro); }} />
      )}

      {phase === "intro" && (
        <div className="center-screen"><div>
          <h1 className="big-title">Get ready!</h1>
          <p className="hint">{rounds.length} questions · turn your phone to aim, push towards the TV to answer · faster answers score more</p>
          <p className="big-title tamil" style={{ fontSize: "2em" }}>தயாரா? 🎉</p>
        </div></div>
      )}

      {(phase === "question" || phase === "reveal") && (
        <>
          <div className="question">
            <div className="q-ta tamil">{r.question.q.ta}</div>
            <div className="q-en">{r.question.q.en}</div>
          </div>
          <div className="options">
            {r.order.map((o, i) => {
              const pickers = players.filter((p) => answers.get(p.id)?.option === i);
              const state = phase === "reveal" ? (i === r.correct ? "right" : "wrong") : "";
              return (
                <div key={i} className={`option a${i} ${state}`}>
                  <span className="shape">{SHAPES[i]}</span>
                  <span className="opt-text">
                    <span className="tamil">{r.question.options.ta[o]}</span>
                    {r.question.options.en[o] !== r.question.options.ta[o] && <span className="opt-en">{r.question.options.en[o]}</span>}
                  </span>
                  {phase === "question" && (
                    <span className="aimers">
                      {players.filter((p) => !answers.has(p.id) && aims.get(p.id) === i).map((p) => (
                        <span key={p.id} style={{ borderColor: p.color }}>{AVATARS[p.avatar].emoji}</span>
                      ))}
                    </span>
                  )}
                  {phase === "reveal" && <span className="pickers">{pickers.map((p) => <span key={p.id} title={p.name}>{AVATARS[p.avatar].emoji}</span>)}</span>}
                </div>
              );
            })}
          </div>
          <div className="answered">
            {players.map((p) => (
              <span key={p.id} className={`chip ${answers.has(p.id) ? "in" : ""} ${p.connected ? "" : "off"}`} style={{ borderColor: p.color }}>
                {AVATARS[p.avatar].emoji} {p.name}{p.connected ? "" : " 📵"} {phase === "reveal" ? <b>+{gained.get(p.id) ?? 0}</b> : answers.has(p.id) ? "✓" : "…"}
              </span>
            ))}
          </div>
        </>
      )}

      {(phase === "board" || phase === "done") && (
        <div className="center-screen"><div className="podium">
          <h2 className="big-title" style={{ fontSize: "2.2em" }}>{phase === "done" ? "Final scores" : "Leaderboard"}</h2>
          {sorted.map((p, i) => (
            <div key={p.id} className={`podium-row ${i === 0 ? "first" : ""}`} style={{ animationDelay: `${i * 0.08}s` }}>
              <span className="place">{i + 1}</span>
              <span className="avatar" style={{ boxShadow: `0 0 0 0.15em ${p.color}` }}>{AVATARS[p.avatar].emoji}</span>
              <span style={{ fontWeight: 700 }}>{p.name}</span>
              <span style={{ fontWeight: 800 }}>{scores.get(p.id) ?? 0}</span>
            </div>
          ))}
        </div></div>
      )}

      {paused && <div className="paused-overlay"><div className="big-title">⏸ Paused</div><p className="hint">The TV lost its connection; reconnecting…</p></div>}
    </div>
  );
}
