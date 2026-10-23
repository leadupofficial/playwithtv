import { useEffect, useState, type FormEvent } from "react";
import { AD_IMAGE_MAX_BYTES, AD_IMAGE_TYPES, AD_PLACEMENTS, type AdPlacement, type AdRecord, type AdStats } from "@playwithtv/protocol";

const LABELS: Record<AdPlacement, string> = {
  "lobby-rail": "Lobby banner",
  "results-rail": "Results banner",
  "presented-by": "Presented-by card",
  "in-game": "In-game name",
};

const blank = (today: string) => ({
  advertiser: "", title: "", line: "", placements: ["lobby-rail", "results-rail"] as AdPlacement[],
  startsOn: today, endsOn: today, enabled: true,
});

/** Sponsor bookings: who, which TV slots, which days, the banner image, and how often each was shown. */
export function SponsorsAdmin({ auth }: { auth: Record<string, string> }) {
  const [data, setData] = useState<{ today: string; ads: AdRecord[]; stats: AdStats[] } | null>(null);
  const [form, setForm] = useState(blank(""));
  const [editing, setEditing] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function load() {
    const r = await fetch("/api/admin/ads", { headers: auth });
    if (r.ok) setData(await r.json());
  }
  useEffect(() => {
    void load();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (data && !form.startsOn) setForm(blank(data.today));
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps

  async function send(method: string, path: string, body?: BodyInit, type = "application/json") {
    const r = await fetch(path, { method, headers: { ...auth, ...(body ? { "content-type": type } : {}) }, body });
    if (!r.ok) throw new Error((await r.json().catch(() => null))?.message ?? `HTTP ${r.status}`);
    return r.status === 204 ? null : r.json();
  }

  async function uploadImage(id: string, f: File) {
    if (!(AD_IMAGE_TYPES as readonly string[]).includes(f.type)) throw new Error("The banner must be PNG, JPEG or WebP.");
    if (f.size > AD_IMAGE_MAX_BYTES) throw new Error("The banner must be 300 KB or smaller.");
    await send("PUT", `/api/admin/ads/${id}/image`, f, f.type);
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    try {
      const saved = (await send(editing ? "PUT" : "POST", editing ? `/api/admin/ads/${editing}` : "/api/admin/ads", JSON.stringify(form))) as AdRecord;
      if (file) await uploadImage(saved.id, file);
      setMsg(`Saved ${saved.advertiser}.`);
      setEditing(null);
      setFile(null);
      setForm(blank(data?.today ?? ""));
      (e.target as HTMLFormElement).reset();
      await load();
    } catch (err) {
      setMsg((err as Error).message);
    }
  }

  async function toggle(a: AdRecord) {
    const { id: _id, imageType: _t, imageVersion: _v, ...input } = a;
    await send("PUT", `/api/admin/ads/${a.id}`, JSON.stringify({ ...input, enabled: !a.enabled })).catch((err) => setMsg(err.message));
    await load();
  }

  async function remove(a: AdRecord) {
    if (!window.confirm(`Delete ${a.advertiser}? Its impression counts are deleted too.`)) return;
    await send("DELETE", `/api/admin/ads/${a.id}`).catch((err) => setMsg(err.message));
    await load();
  }

  const shown = (id: string) => data?.stats.filter((s) => s.id === id) ?? [];
  const running = (a: AdRecord) => !!data && a.enabled && a.startsOn <= data.today && data.today <= a.endsOn;

  return (
    <section className="sponsors">
      <h2>Sponsors</h2>
      <p className="hint">Shown on TVs only, never on phones and never over gameplay. Banners: 970×90 or 1940×180, PNG/JPEG/WebP, up to 300 KB. Dates are India time, inclusive.</p>
      <table>
        <thead><tr><th>Banner</th><th>Sponsor</th><th>Slots</th><th>Dates</th><th>Shown (30 days)</th><th>On</th><th /></tr></thead>
        <tbody>{data?.ads.map((a) => (
          <tr key={a.id}>
            <td>{a.imageType ? <img className="sponsor-thumb" src={`/api/ads/${a.id}/image?v=${a.imageVersion}`} alt="" /> : <span className="hint">text only</span>}</td>
            <td><b>{a.advertiser}</b><br /><span className="hint">{a.title}</span></td>
            <td>{a.placements.map((p) => LABELS[p]).join(", ")}</td>
            <td>{a.startsOn} → {a.endsOn}<br /><span className="hint">{running(a) ? "running today" : a.enabled ? "not today" : "paused"}</span></td>
            <td>{shown(a.id).map((s) => `${LABELS[s.placement]}: ${s.impressions}`).join(" · ") || "–"}</td>
            <td><input type="checkbox" checked={a.enabled} onChange={() => void toggle(a)} aria-label={`Show ${a.advertiser}`} /></td>
            <td className="row" style={{ gap: 8 }}>
              <button className="link-btn" onClick={() => {
                setEditing(a.id);
                setForm({ advertiser: a.advertiser, title: a.title, line: a.line, placements: a.placements, startsOn: a.startsOn, endsOn: a.endsOn, enabled: a.enabled });
              }}>Edit</button>
              <button className="link-btn" onClick={() => void remove(a)}>Delete</button>
            </td>
          </tr>
        ))}</tbody>
      </table>

      <form className="sponsor-form" onSubmit={save}>
        <h3>{editing ? "Edit sponsor" : "Add a sponsor"}</h3>
        {msg && <div className="notice">{msg}</div>}
        <label>Advertiser<input className="input" required maxLength={60} value={form.advertiser} onChange={(e) => setForm({ ...form, advertiser: e.target.value })} /></label>
        <label>Headline (text banner)<input className="input" required maxLength={60} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></label>
        <label>Second line<input className="input" maxLength={120} value={form.line} onChange={(e) => setForm({ ...form, line: e.target.value })} /></label>
        <fieldset>
          <legend>Slots</legend>
          {AD_PLACEMENTS.map((p) => (
            <label key={p} className="check">
              <input type="checkbox" checked={form.placements.includes(p)} onChange={(e) => setForm({
                ...form, placements: e.target.checked ? [...form.placements, p] : form.placements.filter((x) => x !== p),
              })} /> {LABELS[p]}
            </label>
          ))}
        </fieldset>
        <div className="row">
          <label>From<input className="input" type="date" required value={form.startsOn} onChange={(e) => setForm({ ...form, startsOn: e.target.value })} /></label>
          <label>To<input className="input" type="date" required value={form.endsOn} onChange={(e) => setForm({ ...form, endsOn: e.target.value })} /></label>
        </div>
        <label>Banner image (optional; without one the headline is shown as text)
          <input type="file" accept={AD_IMAGE_TYPES.join(",")} onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </label>
        <div className="row">
          <button className="btn" type="submit" disabled={!form.placements.length}>{editing ? "Save changes" : "Add sponsor"}</button>
          {editing && <button className="btn secondary" type="button" onClick={() => { setEditing(null); setForm(blank(data?.today ?? "")); }}>Cancel</button>}
        </div>
      </form>
    </section>
  );
}
