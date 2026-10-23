/**
 * "Install as an app" on every platform that allows it.
 *   android / desktop  the browser's own install prompt (beforeinstallprompt), shown from our button
 *   ios                no prompt exists: instructions (Share → Add to Home Screen)
 *   in-app browsers    (opened from a chat or scanner app) can't install: "open in your browser"
 *   tv-app             already our Android TV app: nothing to show
 *   tv-browser         Samsung / LG / other TV browsers can't install web apps: suggest a bookmark
 */
import { useEffect, useState } from "react";

export type Platform = "android" | "ios" | "desktop" | "tv-app" | "tv-browser" | "in-app" | "firefox-android";

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const DISMISS_KEY = "pwtv.install.dismissed";
const DISMISS_DAYS = 7;

export function detectPlatform(ua: string, touchPoints = 0): Platform {
  if (/PlayWithTV\//.test(ua)) return "tv-app";
  if (/SMART-TV|SmartTV|Tizen|Web0S|webOS|NetCast|BRAVIA|HbbTV|CrKey|AFT[A-Z]|Android TV|GoogleTV/i.test(ua)) return "tv-browser";
  if (/FBAN|FBAV|Instagram|Line\/|Snapchat|; wv\)|WhatsApp/i.test(ua)) return "in-app";
  if (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && touchPoints > 1)) return "ios";
  if (/Android/.test(ua) && /Firefox/.test(ua)) return "firefox-android";
  if (/Android/.test(ua)) return "android";
  return "desktop";
}

export function isInstalled(): boolean {
  if (typeof window === "undefined") return false;
  const nav = navigator as Navigator & { standalone?: boolean };
  // our own full-screen request for the controller also matches "fullscreen", so it doesn't count
  const fullscreenApp = matchMedia("(display-mode: fullscreen)").matches && !document.fullscreenElement;
  return matchMedia("(display-mode: standalone)").matches || fullscreenApp || nav.standalone === true;
}

// The browser fires its install event once, early: catch it at startup so a later screen can use it.
let deferred: BeforeInstallPromptEvent | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((cb) => cb());
if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault(); // we show our own button at a sensible moment instead of the mini-infobar
    deferred = e as BeforeInstallPromptEvent;
    notify();
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    notify();
  });
}

function dismissedRecently(): boolean {
  try {
    const at = Number(localStorage.getItem(DISMISS_KEY));
    return at > 0 && Date.now() - at < DISMISS_DAYS * 86_400_000;
  } catch {
    return false;
  }
}

export interface InstallState {
  platform: Platform;
  /** The browser's own install prompt is ready. */
  canPrompt: boolean;
  /** Something useful to show (not installed, not dismissed, platform can do something). */
  show: boolean;
  prompt(): Promise<void>;
  dismiss(): void;
}

export function useInstall(): InstallState {
  const [, rerender] = useState(0);
  const [dismissed, setDismissed] = useState(dismissedRecently);
  useEffect(() => {
    const cb = () => rerender((n) => n + 1);
    listeners.add(cb);
    return () => void listeners.delete(cb);
  }, []);
  const platform = detectPlatform(navigator.userAgent, navigator.maxTouchPoints);
  const canPrompt = deferred !== null;
  const installed = isInstalled();
  const useful = canPrompt || platform === "ios" || platform === "in-app" || platform === "firefox-android" || platform === "tv-browser";
  return {
    platform,
    canPrompt,
    show: !installed && !dismissed && platform !== "tv-app" && useful,
    async prompt() {
      if (!deferred) return;
      const e = deferred;
      deferred = null;
      await e.prompt();
      await e.userChoice.catch(() => undefined);
      notify();
    },
    dismiss() {
      try {
        localStorage.setItem(DISMISS_KEY, String(Date.now()));
      } catch {
        /* private mode: just hide for now */
      }
      setDismissed(true);
    },
  };
}
