import { describe, expect, it } from "vitest";
import { screenForm } from "./device";

const PIXEL = "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Mobile Safari/537.36";
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1";
const MI_TV = "Mozilla/5.0 (Linux; Android 11; MiTV-AXSO0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0 Safari/537.36";
const MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36";

describe("screenForm", () => {
  it("tells our TV app, TV browsers, computers, tablets and phones apart", () => {
    expect(screenForm(`${MI_TV} PlayWithTV/1`, false, 540)).toBe("tv-app");
    expect(screenForm("Mozilla/5.0 (SMART-TV; Linux; Tizen 6.0) Chrome/85 TV Safari/537.36", false, 540)).toBe("tv");
    expect(screenForm(MAC, false, 900)).toBe("desktop");
    expect(screenForm(PIXEL, true, 412)).toBe("phone");
    expect(screenForm(IPHONE, true, 390)).toBe("phone");
    expect(screenForm("Mozilla/5.0 (iPad; CPU OS 17_4 like Mac OS X)", true, 820)).toBe("tablet");
  });

  it("does not take a TV box browser (no touch, no Mobile) for a phone", () => {
    expect(screenForm(MI_TV, false, 540)).not.toBe("phone");
    expect(screenForm(`Mozilla/5.0 (Linux; Android 11; MiTV-AXSO0; wv) Chrome/138.0 Mobile Safari/537.36`, false, 540)).toBe("desktop");
  });
});
