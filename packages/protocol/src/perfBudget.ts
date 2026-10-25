/**
 * Performance budgets per game class, measured on the TV at the "lite" quality tier: what a cheap Android TV /
 * Fire TV stick gets. CI measures every playable game against its class (e2e/budget.perf.ts); a game over
 * budget cannot be merged. Docs: docs/performance.md.
 *
 *  - "light": runs smoothly on any TV. The default for new games.
 *  - "heavy": real-time 3D that needs a mid-range TV or better. Allowed, but labelled, and shown with a warning on
 *    weak TVs. A heavy game still has a ceiling.
 *  - "camera": drawing as light as "light", but the TV also downloads the body-tracking model once (~17 MB,
 *    versioned under /vendor/ and cached for a year), so the download ceiling is higher.
 *
 * Frame rate is reported but not enforced in CI: CI draws with software GL, so fps there says little about a TV.
 * The enforced numbers are the ones that do not depend on the machine (draw calls, triangles, texture memory,
 * download size) plus the JavaScript time each frame costs, with generous headroom.
 */
export const PERF_CLASSES = ["light", "heavy", "camera"] as const;
export type PerfClass = (typeof PERF_CLASSES)[number];

export interface PerfBudget {
  /** draw calls per frame, 95th percentile */
  callsP95: number;
  /** triangles per frame, 95th percentile */
  trisP95: number;
  /** peak GPU texture memory while playing, MB */
  texPeakMB: number;
  /** what the TV downloads after Start is pressed, KB */
  downloadKB: number;
  /** JavaScript time per frame, 95th percentile, ms (the whole frame is 16.7 ms at 60 fps) */
  scriptMsP95: number;
  /** from pressing Start to the game on screen (CI, local server), ms */
  loadMs: number;
}

export const BUDGETS: Record<PerfClass, PerfBudget> = {
  light: { callsP95: 60, trisP95: 60_000, texPeakMB: 64, downloadKB: 2_048, scriptMsP95: 8, loadMs: 15_000 },
  camera: { callsP95: 60, trisP95: 60_000, texPeakMB: 96, downloadKB: 20_480, scriptMsP95: 10, loadMs: 30_000 },
  heavy: { callsP95: 160, trisP95: 400_000, texPeakMB: 192, downloadKB: 12_288, scriptMsP95: 14, loadMs: 30_000 },
};

export type PerfMeasurement = { [K in keyof PerfBudget]: number };

/** Human-readable list of every budget the measurement breaks (empty = within budget). */
export function overBudget(m: PerfMeasurement, cls: PerfClass): string[] {
  const b = BUDGETS[cls];
  return (Object.keys(b) as Array<keyof PerfBudget>)
    .filter((k) => m[k] > b[k])
    .map((k) => `${k} ${m[k]} > ${b[k]}`);
}

/** The class a game is held to: what its manifest declares, else "light". */
export const perfClassOf = (g: { perfClass?: PerfClass }): PerfClass => g.perfClass ?? "light";
