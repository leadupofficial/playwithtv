/**
 * quality/store: the one place the app keeps the render tier. Games read it with useQuality() (React) or
 * getQuality() (plain code); the lobby chip changes the setting.
 *
 *   tier = ?quality=… (this page load only)  ??  saved setting (Auto/Lite/High/Ultra)  ??  detection
 *
 * Detection runs once, lazily, the first time anything asks (or immediately with ensureDetected()).
 */
import { useEffect, useSyncExternalStore } from "react";
import { type Detection, detectTier } from "./detect";
import { type QualityProfile, type QualitySetting, type Tier, effectiveTier, parseOverride, profileFor } from "./tier";

const SETTING_KEY = "pwtv.quality.setting";

export interface QualityState {
  /** The tier in use. */
  tier: Tier;
  profile: QualityProfile;
  /** The lobby setting ("auto" follows detection). */
  setting: QualitySetting;
  /** `?quality=` on this page load, if any (wins over the setting). */
  override: QualitySetting | null;
  /** What detection decided (null until it has run). */
  detection: Detection | null;
  /** True once detection finished (or was not needed because a fixed tier is chosen). */
  ready: boolean;
}

function readSetting(): QualitySetting {
  try {
    const v = localStorage.getItem(SETTING_KEY);
    return v === "lite" || v === "high" || v === "ultra" ? v : "auto";
  } catch {
    return "auto";
  }
}

let state: QualityState | null = null;
const listeners = new Set<() => void>();
let detecting: Promise<Detection> | null = null;

function compute(setting: QualitySetting, override: QualitySetting | null, detection: Detection | null): QualityState {
  const tier = effectiveTier(detection?.tier ?? "lite", setting, override);
  const fixed = (override ?? setting) !== "auto";
  return { tier, profile: profileFor(tier), setting, override, detection, ready: fixed || !!detection };
}

function current(): QualityState {
  state ??= compute(readSetting(), typeof location !== "undefined" ? parseOverride(location.search) : null, null);
  return state;
}

function emit(next: QualityState) {
  state = next;
  for (const l of listeners) l();
}

/** Starts detection if it has not run yet. Resolves with the detection result. */
export function ensureDetected(force = false): Promise<Detection> {
  if (detecting && !force) return detecting;
  detecting = detectTier({ force }).then((d) => {
    const s = current();
    emit(compute(s.setting, s.override, d));
    return d;
  }).catch((e) => {
    detecting = null;
    throw e;
  });
  return detecting;
}

export function getQuality(): QualityState {
  return current();
}

/** Saves the lobby setting (Auto/Lite/High/Ultra). */
export function setQualitySetting(setting: QualitySetting) {
  try {
    localStorage.setItem(SETTING_KEY, setting);
  } catch { /* not saved, still applied for this visit */ }
  const s = current();
  emit(compute(setting, s.override, s.detection));
}

/** Overrides the tier for this page only (the showroom's tier switcher; not saved). */
export function setQualityOverride(override: QualitySetting | null) {
  const s = current();
  emit(compute(s.setting, override, s.detection));
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/**
 * The current tier and profile; re-renders when it changes. Kicks off detection on first use (≤ 1.5 s once per
 * device, then cached), during which the tier is "lite" with ready=false: wait for `ready` before building a
 * scene if you would otherwise build it twice.
 */
export function useQuality(): QualityState {
  const s = useSyncExternalStore(subscribe, current, current);
  useEffect(() => {
    if (!current().detection) void ensureDetected().catch(() => undefined);
  }, []);
  return s;
}

/** For tests: forget everything. */
export function resetQualityForTests() {
  state = null;
  detecting = null;
  listeners.clear();
}
