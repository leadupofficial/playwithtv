import { Link } from "react-router-dom";
import { setQualitySetting, useQuality } from "./store";
import { type QualitySetting, nextSetting } from "./tier";
import "./quality.css";

const LABEL: Record<QualitySetting, string> = { auto: "Auto", lite: "Lite", high: "High", ultra: "Ultra" };

/**
 * TV lobby chip "Graphics: Auto (Lite)": OK on the remote cycles Auto → Lite → High → Ultra (saved on this
 * device). On the lite tier it also offers the power-host tip (cast from a laptop for console-quality graphics).
 */
export function GraphicsChip() {
  const q = useQuality();
  const shown = q.override ?? q.setting;
  const detail = shown === "auto" ? (q.ready ? ` (${LABEL[q.tier]})` : " (checking…)") : "";
  return (
    <>
      {q.tier === "lite" && shown === "auto" && q.ready && (
        <Link to="/tv/hosting" className="chip quality-tip" data-nav data-quality-tip>
          ✨ Console-quality graphics: cast from a laptop
        </Link>
      )}
      <button
        className="chip quality-chip"
        data-nav
        data-quality={q.tier}
        data-quality-setting={shown}
        aria-label={`Graphics: ${LABEL[shown]}${detail}. Press to change.`}
        onClick={() => setQualitySetting(nextSetting(q.setting))}
      >
        🎨 Graphics: {LABEL[shown]}{detail}
      </button>
    </>
  );
}
