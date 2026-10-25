/**
 * Cache-Control for the built web app. The aim: browsers and the CDN (Cloudflare) serve every game file, so the
 * hub's own bandwidth goes to rooms, not downloads, while a deploy still reaches everyone quickly.
 *
 *  - Pages, the service worker and app manifests: always revalidated, so a new deploy is picked up at once.
 *  - Build files with a content hash in the name (/assets/Name-AbCd1234.js) and versioned vendor folders
 *    (/vendor/<name>-<version>/): never change under the same URL, so cached for a year.
 *  - Everything else (game art, models, sounds, fonts, icons under fixed names): an hour in the browser, a day at
 *    the CDN, then served stale while the CDN refetches in the background. A replaced file reaches players within
 *    a day without anyone downloading it twice a session.
 */
export const IMMUTABLE = "public, max-age=31536000, immutable";
export const REVALIDATE = "no-cache";
export const STATIC = "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800";

/**
 * Vite output: directly in /assets, `name-<8 char hash>.ext` (and `.js.map`). Hand-made game files must live in a
 * sub-folder of /assets (apps/web/public/assets/<game>/), which keeps them out of this rule (tested).
 */
const HASHED_BUILD_FILE = /^\/assets\/[^/]+-[A-Za-z0-9_-]{8}(\.[a-z0-9]+)+$/;
/** Self-hosted vendor files sit in a folder named after their version, e.g. /vendor/mediapipe-0.10.35/. */
const VERSIONED_VENDOR = /^\/vendor\/[a-z0-9._-]+-\d+(\.\d+)+\//i;

/** The Cache-Control header for a URL path of the built web app (no query string). */
export function cacheControlFor(urlPath: string): string {
  const p = urlPath.split(/[?#]/, 1)[0]!;
  if (p === "/" || p.endsWith(".html") || p === "/sw.js" || p.endsWith(".webmanifest") || p === "/manifest-pick.js") return REVALIDATE;
  if (HASHED_BUILD_FILE.test(p) || VERSIONED_VENDOR.test(p)) return IMMUTABLE;
  return STATIC;
}
