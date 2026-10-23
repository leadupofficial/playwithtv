/**
 * Arrow-key focus movement for TV remotes: moves focus to the nearest focusable element in the pressed
 * direction (TV browsers deliver the remote's D-pad as arrow keys). Elements opt in with data-nav.
 */
export function installSpatialNav(): () => void {
  const onKey = (e: KeyboardEvent) => {
    const dir = ({ ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] } as Record<string, [number, number]>)[e.key];
    if (!dir) return;
    const all = [...document.querySelectorAll<HTMLElement>("[data-nav]")].filter((el) => !(el as HTMLButtonElement).disabled && el.offsetParent);
    if (!all.length) return;
    const cur = document.activeElement as HTMLElement | null;
    if (!cur || !all.includes(cur)) {
      all[0]!.focus();
      e.preventDefault();
      return;
    }
    const a = cur.getBoundingClientRect();
    const ax = a.left + a.width / 2, ay = a.top + a.height / 2;
    let best: HTMLElement | null = null, bestScore = Infinity;
    for (const el of all) {
      if (el === cur) continue;
      const b = el.getBoundingClientRect();
      const dx = b.left + b.width / 2 - ax, dy = b.top + b.height / 2 - ay;
      const along = dx * dir[0] + dy * dir[1];
      if (along <= 4) continue;
      const across = Math.abs(dx * dir[1]) + Math.abs(dy * dir[0]);
      const score = along + across * 2.5;
      if (score < bestScore) { bestScore = score; best = el; }
    }
    if (best) {
      best.focus();
      e.preventDefault();
    }
  };
  window.addEventListener("keydown", onKey);
  return () => window.removeEventListener("keydown", onKey);
}
