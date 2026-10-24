/**
 * Which animation a fighter shows, from the engine state alone (pure, shared by both tiers):
 *   lite        a clip of the pre-rendered sprite sheet and its frame (`progress` 0..1 for one-shot clips)
 *   high/ultra  the KayKit clip with the same timing, via kit3d Character
 */
import { MOVES, ROLL_TIME, character, type FighterId, type Fighter, type Match } from "./rules";

export type Clip = "idle" | "run" | "jab" | "cross" | "kick" | "heavy" | "guard" | "hit" | "roll" | "special" | "cheer" | "ko";

/** KayKit action per clip and fighter (the same table renders the sprite sheets: tools/blender/kalari/fighter_sprites.py). */
const BASE: Record<Clip, string> = {
  idle: "Unarmed_Idle", run: "Running_A", jab: "Unarmed_Melee_Attack_Punch_A", cross: "Unarmed_Melee_Attack_Punch_B",
  kick: "Unarmed_Melee_Attack_Kick", heavy: "2H_Melee_Attack_Chop", guard: "Blocking", hit: "Hit_A", roll: "Dodge_Forward",
  special: "", cheer: "Cheer", ko: "Death_A",
};
export const ACTIONS: Record<FighterId, Record<Clip, string>> = {
  simha: { ...BASE, special: "Jump_Full_Short" },
  mayil: { ...BASE, idle: "2H_Melee_Idle", run: "Running_B", jab: "1H_Melee_Attack_Stab", cross: "1H_Melee_Attack_Slice_Diagonal", kick: "2H_Melee_Attack_Slice", special: "2H_Melee_Attack_Spinning" },
  puli: { ...BASE, special: "Jump_Full_Long" },
  ashwa: { ...BASE, special: "2H_Melee_Attack_Spin" },
};

export interface AnimPick {
  clip: Clip;
  /** One-shot clips: how far through (0..1). Loops: null (play by time). */
  progress: number | null;
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

export function pickAnim(f: Fighter, m: Match, cheering: boolean): AnimPick {
  if (cheering && f.alive) return { clip: "cheer", progress: null };
  switch (f.state) {
    case "attack": {
      const mv = MOVES[f.move ?? "jab"];
      // the hit frame of the clip lines up with the end of the startup
      const total = mv.startup + mv.active + mv.recovery;
      return { clip: f.move ?? "jab", progress: clamp01(f.t / total) };
    }
    case "guard": return { clip: "guard", progress: null };
    case "hit": case "stagger": return { clip: "hit", progress: clamp01(f.t / 0.35) };
    case "air": return { clip: "hit", progress: 0.6 };
    case "down": return { clip: "ko", progress: clamp01(0.5 + (1 - f.t / 0.55) * 0.5) };
    case "ko": case "fall": case "out": return { clip: "ko", progress: clamp01(f.t / 0.6) };
    case "roll": return { clip: "roll", progress: clamp01(f.t / ROLL_TIME) };
    case "special": return { clip: "special", progress: clamp01(f.t / character(f.char).special.duration) };
    default: {
      const moving = Math.hypot(f.vx, f.vz) > 0.8 && m.phase === "fight";
      return { clip: moving ? "run" : "idle", progress: null };
    }
  }
}

export interface SheetClip { start: number; frames: number; fps: number; loop: boolean }

/** The sprite-sheet frame (within a direction) for a pick at `time` seconds. */
export function sheetFrame(pick: AnimPick, clips: Record<string, SheetClip>, time: number): number {
  const c = clips[pick.clip] ?? clips.idle!;
  const k = pick.progress === null ? Math.floor(time * c.fps) % c.frames : Math.min(c.frames - 1, Math.floor(pick.progress * c.frames));
  return c.start + k;
}
