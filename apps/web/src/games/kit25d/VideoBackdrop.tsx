import { useEffect, useRef, type CSSProperties } from "react";

/**
 * kit25d/VideoBackdrop: a pre-rendered H.264 loop (render_backdrop.py) behind a transparent WebGL canvas. The TV
 * decodes video in hardware, so a cinematic background costs almost nothing on the lite tier.
 *
 *   <div style={{ position: "relative" }}>
 *     <VideoBackdrop src="/assets/…/ghat-loop.mp4" poster="/assets/…/ghat-loop-poster.webp" paused={paused} />
 *     <canvas … style={{ position: "absolute", inset: 0 }} />   // renderer: new WebGLRenderer({ alpha: true })
 *   </div>
 *
 * Muted + playsInline + autoplay works without a user gesture on Chrome and Android WebViews. The poster shows
 * until the first frame is decoded (and if video is unavailable). `paused` freezes it with the game. Files must
 * be same-origin (our CSP: media-src 'self').
 */
export function VideoBackdrop({ src, poster, paused = false, playbackRate = 1, style, onReady }: {
  src: string;
  poster?: string;
  paused?: boolean;
  playbackRate?: number;
  style?: CSSProperties;
  /** Called once the first frame can be shown. */
  onReady?: (video: HTMLVideoElement) => void;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const ready = useRef(onReady);
  ready.current = onReady;
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    v.playbackRate = playbackRate;
    if (paused) v.pause();
    else void v.play().catch(() => undefined); // a blocked autoplay just leaves the poster up
  }, [paused, playbackRate]);
  useEffect(() => {
    const v = ref.current;
    // (re)attach the source: after a StrictMode remount the cleanup below has detached it
    if (v && v.getAttribute("src") !== src) {
      v.setAttribute("src", src);
      v.load();
      if (!paused) void v.play().catch(() => undefined);
    }
    // a native listener plus a readyState check: a cached file can be decoded before any handler would run
    const fire = () => ready.current?.(v!);
    if (v && v.readyState >= 2) fire();
    else v?.addEventListener("loadeddata", fire, { once: true });
    return () => {
      if (!v) return;
      v.removeEventListener("loadeddata", fire);
      v.pause();
      v.removeAttribute("src"); // release the decoder at once (TVs have one or two)
      v.load();
    };
  }, [src]); // eslint-disable-line react-hooks/exhaustive-deps -- `paused` is handled by the effect above
  return (
    <video
      ref={ref}
      src={src}
      poster={poster}
      muted
      playsInline
      loop
      autoPlay={!paused}
      preload="auto"
      disablePictureInPicture
      data-backdrop
      style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", pointerEvents: "none", ...style }}
    />
  );
}
