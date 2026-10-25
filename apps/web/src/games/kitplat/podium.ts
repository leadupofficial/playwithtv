/** kitplat/podium: the little stage the winners stand on at the end (1st in the middle, highest). */
import type { LevelDef } from "./level";

/** Where 1st, 2nd, 3rd and 4th stand (x, y) on podiumLevel(). */
export const PODIUM_SPOTS: Array<[number, number]> = [[11.5, 6], [7.5, 5], [15.5, 4], [19.5, 4]];
/** Camera for the podium: centre and view width (tiles), framing the steps above the award cards. */
export const PODIUM_CAM = { x: 13.5, y: 4.3, vw: 15 };

export function podiumLevel(): LevelDef {
  const w = 26, h = 14;
  const rows: string[][] = Array.from({ length: h }, () => Array.from({ length: w }, () => " "));
  const set = (c: number, r: number, ch: string) => { rows[h - 1 - r]![c] = ch; };
  const block = (c0: number, c1: number, top: number) => { for (let c = c0; c <= c1; c++) for (let r = 0; r < top; r++) set(c, r, "#"); };
  block(0, w - 1, 3);
  block(10, 12, 6);
  block(6, 8, 5);
  block(14, 16, 4);
  block(18, 20, 4);
  set(2, 3, "P");
  return { id: "podium", name: "Podium", time: 999, rows: rows.map((r) => r.join("")) };
}
