const KEY = "pwtv.device";
let memo: string | null = null;

/**
 * Anonymous install id for this browser: 22 random URL-safe characters, kept in localStorage. It is sent when a
 * TV opens a room or a phone joins one, so the operator can count unique and returning devices. It holds no
 * personal data, and clearing site data makes a new one. Private mode / blocked storage gets one per page load.
 */
export function deviceId(): string {
  if (memo) return memo;
  try {
    const saved = localStorage.getItem(KEY);
    if (saved && /^[A-Za-z0-9_-]{16,64}$/.test(saved)) return (memo = saved);
  } catch { /* storage blocked */ }
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  memo = btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  try {
    localStorage.setItem(KEY, memo);
  } catch { /* storage blocked: keep it for this page only */ }
  return memo;
}

export type ScreenForm = "tv-app" | "tv" | "desktop" | "tablet" | "phone";

/** Coarse kind of screen this is: our TV app, a TV browser, a computer, a tablet or a phone (no fingerprinting). */
// "coarse" = a touch screen: coarse pointer AND touch points (TV boxes report 0, and a remote is never touch)
export function screenForm(ua = navigator.userAgent, coarse = matchMedia("(pointer: coarse)").matches && navigator.maxTouchPoints > 0, short = Math.min(screen.width, screen.height)): ScreenForm {
  if (/PlayWithTV\//.test(ua)) return "tv-app";
  if (/Android TV|AFT[A-Z]|BRAVIA|SMART-TV|SmartTV|Tizen|Web0S|webOS|CrKey|GoogleTV|HbbTV|Large Screen/i.test(ua)) return "tv";
  if (!coarse) return "desktop";
  if (/iPad|Tablet/i.test(ua) || (/Android/i.test(ua) && !/Mobile/i.test(ua)) || short >= 700) return "tablet";
  return "phone";
}
