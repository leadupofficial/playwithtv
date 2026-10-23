import { useEffect, useState, type ReactNode } from "react";

/**
 * Every TV screen is laid out on one fixed 1920×1080 canvas, then scaled to fit the real screen.
 * TVs report very different viewports (1280×720 WebViews, 960×540 at high pixel density, 1920×1080 browsers,
 * 21:9 or 4:3 sets), so sizing in vw/vh made content overflow on some and float on others. With a fixed
 * stage the layout is identical everywhere; other aspect ratios get even bars instead of a different layout.
 */
export const STAGE_W = 1920;
export const STAGE_H = 1080;

const fit = () => Math.min(window.innerWidth / STAGE_W, window.innerHeight / STAGE_H);

export function Stage({ children }: { children: ReactNode }) {
  const [scale, setScale] = useState(fit);
  useEffect(() => {
    const on = () => setScale(fit());
    window.addEventListener("resize", on);
    window.addEventListener("orientationchange", on);
    return () => {
      window.removeEventListener("resize", on);
      window.removeEventListener("orientationchange", on);
    };
  }, []);
  return (
    <div className="stage-viewport">
      <div className="stage" style={{ transform: `translate(-50%, -50%) scale(${scale})` }} data-scale={scale.toFixed(3)}>
        {children}
      </div>
    </div>
  );
}
