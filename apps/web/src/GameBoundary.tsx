import { Component, type ReactNode } from "react";

/**
 * Catches a game (or page) that throws while loading or drawing, so the TV shows a message instead of a blank
 * screen. A game file that can't be loaded usually means a new version was deployed while this TV was open
 * (the old file is gone): the page reloads itself once to pick up the new version.
 */
const RELOADED = "pwtv.chunkReload";

export function isChunkError(e: unknown): boolean {
  const m = String((e as Error)?.message ?? e);
  return /dynamically imported module|Importing a module script failed|error loading dynamically imported|Failed to fetch|ChunkLoadError|Unable to preload CSS|is not a valid JavaScript MIME type/i.test(m);
}

/** Reloads the page once (per tab, per 30 s) to fetch the current build. Returns false if it already tried. */
export function reloadForNewVersion(): boolean {
  try {
    const last = Number(sessionStorage.getItem(RELOADED) ?? 0);
    if (Date.now() - last < 30_000) return false;
    sessionStorage.setItem(RELOADED, String(Date.now()));
  } catch {
    return false;
  }
  location.reload();
  return true;
}

interface Props {
  children: ReactNode;
  /** What to call it on the error screen ("the game", "this page"). */
  what?: string;
  /** A way out, e.g. back to the lobby. */
  onExit?: () => void;
}

export class GameBoundary extends Component<Props, { error: unknown; reloading: boolean }> {
  state = { error: null as unknown, reloading: false };

  static getDerivedStateFromError(error: unknown) {
    return { error };
  }

  componentDidCatch(error: unknown) {
    console.error("[pwtv] crashed:", error);
    if (isChunkError(error) && reloadForNewVersion()) this.setState({ reloading: true });
  }

  render() {
    if (!this.state.error) return this.props.children;
    const what = this.props.what ?? "the game";
    return (
      <div className="tv" role="alert" data-crash>
        <div className="center-screen">
          <div style={{ display: "flex", flexDirection: "column", gap: "1em", alignItems: "center", textAlign: "center" }}>
            {this.state.reloading ? (
              <p className="hint">Updating to the newest version…</p>
            ) : (
              <>
                <h1 className="big-title">Oops, {what} hit a snag</h1>
                <p className="hint">{isChunkError(this.state.error) ? "It couldn't be loaded. Check the internet connection." : "Something went wrong while it was running."}</p>
                <div className="row">
                  <button className="btn" data-nav autoFocus onClick={() => location.reload()}>Try again</button>
                  {this.props.onExit && (
                    <button className="btn secondary" data-nav onClick={() => { this.setState({ error: null }); this.props.onExit!(); }}>Back to games</button>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    );
  }
}
