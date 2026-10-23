import { useState } from "react";
import { useInstall } from "./install";
import { t } from "./i18n";

/**
 * Phone: a small dismissible strip on the join page and in the lobby (never during a game).
 * Shows the browser's Install button where it exists, or the right instructions for this browser.
 */
export function InstallBanner() {
  const s = useInstall();
  if (!s.show || s.platform === "tv-browser") return null;
  const text =
    s.canPrompt ? t("install.phone")
    : s.platform === "ios" ? t("install.ios")
    : s.platform === "in-app" ? t("install.inApp")
    : s.platform === "firefox-android" ? t("install.firefox")
    : "";
  if (!text) return null;
  return (
    <div className="install-banner" role="region" aria-label={t("install.title")} data-platform={s.platform}>
      <img src="/icons/icon-192.png" alt="" width={36} height={36} />
      <span>{text}</span>
      {s.canPrompt && <button className="btn install-btn" onClick={() => void s.prompt()}>{t("install.button")}</button>}
      <button className="link-btn" onClick={s.dismiss} aria-label={t("install.later")}>✕</button>
    </div>
  );
}

/**
 * TV: one header chip, reachable with the remote. Installs on PCs / laptops connected to a TV; on TV browsers
 * (which cannot install web apps) it explains how to bookmark the page instead.
 */
export function TvInstallChip() {
  const s = useInstall();
  const [help, setHelp] = useState(false);
  if (!s.show || !(s.canPrompt || s.platform === "tv-browser")) return null;
  return (
    <>
      <button className="chip tv-install" data-nav onClick={() => (s.canPrompt ? void s.prompt() : setHelp(true))}>
        📲 {s.canPrompt ? t("install.tvButton") : t("install.tvSave")}
      </button>
      {help && (
        <div className="tv-install-help" role="dialog" aria-label={t("install.tvSave")}>
          <div>
            <h2>{t("install.tvSave")}</h2>
            <p>{t("install.tvBookmark")}</p>
            <div className="row" style={{ justifyContent: "center" }}>
              <button className="btn" data-nav autoFocus onClick={() => setHelp(false)}>OK</button>
              <button className="btn secondary" data-nav onClick={() => { setHelp(false); s.dismiss(); }}>{t("install.later")}</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
