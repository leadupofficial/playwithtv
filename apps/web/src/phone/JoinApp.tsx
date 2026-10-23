import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { InstallBanner } from "../InstallBanner";
import type { Avatar, JoinResponse } from "@scp/protocol";
import { api } from "../net";
import { AVATARS } from "../avatars";
import { Controller } from "./Controller";

const SESSION_KEY = "scp.phone.session";
const PROFILE_KEY = "scp.phone.profile";

export interface PhoneSession { roomId: string; playerId: string; playerToken: string }

function load<T>(key: string): T | null {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "null") as T | null;
  } catch {
    return null;
  }
}

/** Guest join: the invite comes from the QR (?i=…) or a typed 4-letter code. No account, no app. */
export function JoinApp() {
  const [params, setParams] = useSearchParams();
  const invite = params.get("i") ?? undefined;
  const profile = load<{ name: string; avatar: Avatar }>(PROFILE_KEY);
  const [name, setName] = useState(profile?.name ?? "");
  const [avatar, setAvatar] = useState<Avatar>(profile?.avatar ?? "tiger");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A reload or a phone that slept goes straight back into the room it was in.
  const [session, setSession] = useState<PhoneSession | null>(() => (invite ? null : load<PhoneSession>(SESSION_KEY)));

  useEffect(() => {
    document.title = "Join · Scan Connect Play";
  }, []);

  async function join(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const prev = load<PhoneSession>(SESSION_KEY);
      const res = await api<JoinResponse>("/api/join", {
        inviteToken: invite,
        joinCode: invite ? undefined : code,
        name: name.trim(),
        avatar,
        playerToken: prev?.playerToken,
      });
      localStorage.setItem(PROFILE_KEY, JSON.stringify({ name: name.trim(), avatar }));
      localStorage.setItem(SESSION_KEY, JSON.stringify(res));
      setParams({}, { replace: true }); // drop the invite token from the address bar
      setSession(res);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (session) {
    return (
      <Controller
        session={session}
        onLeave={(forget) => {
          if (forget) localStorage.removeItem(SESSION_KEY);
          setSession(null);
        }}
      />
    );
  }

  return (
    <form className="phone" onSubmit={join}>
      <h1>🎮 Join the game</h1>
      <InstallBanner />
      <p className="hint" style={{ margin: 0 }}>{invite ? "You scanned a TV code. Pick a name and avatar." : "Type the 4-letter code shown on the TV."}</p>
      {!invite && (
        <div className="field">
          <label htmlFor="code">TV code</label>
          <input id="code" className="input code-input" value={code} maxLength={4} autoCapitalize="characters" autoComplete="off"
            inputMode="text" onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z2-9]/g, ""))} placeholder="ABCD" required />
        </div>
      )}
      <div className="field">
        <label htmlFor="name">Your name</label>
        <input id="name" className="input" value={name} maxLength={16} autoComplete="nickname" onChange={(e) => setName(e.target.value)} placeholder="e.g. Priya" required />
      </div>
      <div className="field">
        <label>Avatar</label>
        <div className="avatar-grid">
          {(Object.keys(AVATARS) as Avatar[]).map((a) => (
            <button key={a} type="button" className={`avatar-btn ${a === avatar ? "on" : ""}`} aria-label={AVATARS[a].label} aria-pressed={a === avatar} onClick={() => setAvatar(a)}>
              {AVATARS[a].emoji}
            </button>
          ))}
        </div>
      </div>
      {error && <div className="notice" role="alert">{error}</div>}
      <button className="btn" type="submit" disabled={busy || !name.trim() || (!invite && code.length !== 4)}>
        {busy ? "Joining…" : "Join as guest"}
      </button>
      <p className="hint" style={{ margin: 0, fontSize: 13 }}>No account or app needed. Your name is only shown on this TV.</p>
    </form>
  );
}
