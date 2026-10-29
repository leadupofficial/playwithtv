import fs from "node:fs";
import path from "node:path";

/** Every registry game whose code (followed through relative imports) reaches the "three" package. */
const SRC = path.resolve(import.meta.dirname, "..");
const reg = fs.readFileSync(path.join(SRC, "games/registry.ts"), "utf8");

function resolve(from: string, spec: string): string | null {
  const base = path.resolve(path.dirname(from), spec);
  for (const c of [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts"), path.join(base, "index.tsx")]) {
    if (fs.existsSync(c) && fs.statSync(c).isFile()) return c;
  }
  return null;
}

function usesThree(file: string, seen = new Set<string>()): boolean {
  if (seen.has(file)) return false;
  seen.add(file);
  const src = fs.readFileSync(file, "utf8");
  for (const m of src.matchAll(/(?:from|import\()\s*["']([^"']+)["']/g)) {
    const spec = m[1]!;
    if (spec === "three" || spec.startsWith("three/")) return true;
    if (spec.startsWith(".")) {
      const r = resolve(file, spec);
      if (r && usesThree(r, seen)) return true;
    }
  }
  return false;
}

/** id → the module the registry lazy-loads for it */
export function registryModules(): Map<string, string> {
  const comp = new Map<string, string>(); // component const → file
  const at = path.join(SRC, "games/registry.ts");
  for (const m of reg.matchAll(/const (\w+) = lazy\(\(\) => import\("(\.[^"]+)"\)/g)) comp.set(m[1]!, resolve(at, m[2]!)!);
  for (const m of reg.matchAll(/import \{([^}]+)\} from "(\.[^"]+)"/g)) {
    for (const name of m[1]!.split(",").map((x) => x.trim().split(/\s+as\s+/).pop()!)) if (name) comp.set(name, resolve(at, m[2]!)!);
  }
  const out = new Map<string, string>();
  for (const m of reg.matchAll(/"([a-z0-9-]+)":\s*(\w+)/g)) if (comp.has(m[2]!)) out.set(m[1]!, comp.get(m[2]!)!);
  return out;
}

export function threeGames(): string[] {
  return [...registryModules()].filter(([, f]) => usesThree(f)).map(([id]) => id).sort();
}
