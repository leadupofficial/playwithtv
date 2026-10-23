import { describe, expect, it } from "vitest";
import { detectPlatform } from "./install";

const UA = {
  androidChrome: "Mozilla/5.0 (Linux; Android 16; I2304) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36",
  iphone: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1",
  ipadDesktopUa: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15",
  macSafari: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15",
  windowsChrome: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
  samsungTv: "Mozilla/5.0 (SMART-TV; LINUX; Tizen 7.0) AppleWebKit/537.36 (KHTML, like Gecko) 94.0.4606.31/7.0 TV Safari/537.36",
  lgTv: "Mozilla/5.0 (Web0S; Linux/SmartTV) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/87.0.4280.88 Safari/537.36 WebAppManager",
  fireTv: "Mozilla/5.0 (Linux; Android 9; AFTMM Build/PS7633) AppleWebKit/537.36 (KHTML, like Gecko) Silk/118.3.1 like Chrome/118.0.5993.144 Safari/537.36",
  ourTvApp: "Mozilla/5.0 (Linux; Android 14; MiTV-AXFU0; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/155.0.8059.43 Mobile Safari/537.36 PlayWithTV/1",
  instagram: "Mozilla/5.0 (Linux; Android 16; I2304; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/141.0 Mobile Safari/537.36 Instagram 350.0",
  firefoxAndroid: "Mozilla/5.0 (Android 16; Mobile; rv:144.0) Gecko/144.0 Firefox/144.0",
};

describe("install platform detection", () => {
  it.each([
    ["androidChrome", 5, "android"],
    ["iphone", 5, "ios"],
    ["ipadDesktopUa", 5, "ios"],        // iPadOS reports a Mac, but has touch
    ["macSafari", 0, "desktop"],
    ["windowsChrome", 0, "desktop"],
    ["samsungTv", 0, "tv-browser"],
    ["lgTv", 0, "tv-browser"],
    ["fireTv", 0, "tv-browser"],
    ["ourTvApp", 0, "tv-app"],          // already the TV app: never prompt
    ["instagram", 5, "in-app"],
    ["firefoxAndroid", 5, "firefox-android"],
  ] as const)("%s → %s", (name, touch, expected) => {
    expect(detectPlatform(UA[name], touch)).toBe(expected);
  });
});
