/** Shared bits of the /tv/showroom page. */

const BASE = "/assets/cinematic/showroom";

export const ASSETS = {
  /** render_sprites.py output (lite). */
  sheet: `${BASE}/hatchback.json`,
  /** render_backdrop.py output (lite). */
  video: `${BASE}/ghat-loop.mp4`,
  poster: `${BASE}/ghat-loop-poster.webp`,
  /** export_glb.py output (high / ultra): `${BASE}/hatchback${profile.assetSuffix}.glb`. */
  model: (suffix: string) => `${BASE}/hatchback${suffix}.glb`,
  /** Poly Haven CC0 sky, real-time image-based lighting. */
  hdri: `${BASE}/kloofendal_overcast_puresky_1k.hdr`,
};

/** What the remote controls; views read it every frame (a ref, so pressing a button never rebuilds a scene). */
export interface ViewControl {
  angle: number;
  spin: boolean;
}

/** What a view reports for the on-screen stats and the data-showroom test attribute. */
export interface ViewStats {
  loaded?: boolean;
  video?: boolean;
  fps?: number;
  calls?: number;
  tris?: number;
  flash?: boolean;
  error?: string;
}
