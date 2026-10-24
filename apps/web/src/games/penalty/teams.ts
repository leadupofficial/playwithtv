/** Fictional teams and stadiums: original names and colours only (no real clubs, nations, kits or crests). */
export interface Team { name: string; short: string; shirt: string; trim: string; keeper: string }

export const TEAMS: Team[] = [
  { name: "Aurora Comets", short: "AUR", shirt: "#ff6b35", trim: "#1b1b3a", keeper: "#2ec4b6" },
  { name: "Lagoon Lions", short: "LAG", shirt: "#00a6a6", trim: "#ffd166", keeper: "#ef476f" },
  { name: "Monsoon Kites", short: "MON", shirt: "#7b2ff7", trim: "#f1f1f1", keeper: "#ffd166" },
  { name: "Cedar Falcons", short: "CED", shirt: "#2a9d8f", trim: "#e9c46a", keeper: "#f15bb5" },
  { name: "Ember Rhinos", short: "EMB", shirt: "#e63946", trim: "#1d3557", keeper: "#a8dadc" },
  { name: "Glacier Owls", short: "GLA", shirt: "#4cc9f0", trim: "#14213d", keeper: "#fb8500" },
  { name: "Saffron Hornets", short: "SAF", shirt: "#ffb703", trim: "#023047", keeper: "#8338ec" },
  { name: "Coral Mantas", short: "COR", shirt: "#ff7f7f", trim: "#0b3954", keeper: "#9ef01a" },
];
/** The CPU's side in a solo shoot-out. */
export const CPU_TEAM: Team = { name: "Robo Rovers", short: "ROB", shirt: "#9aa5b1", trim: "#222831", keeper: "#ffd23f" };
export const STADIUMS = ["Lumen Park", "Harbour Bowl", "Sunridge Arena", "Monsoon Dome", "Kestrel Fields", "Tidewater Stadium"];
