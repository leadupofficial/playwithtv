/**
 * Built-ins newer than Chrome 66 (the WebView on 2018-19 Android TVs) that the app or its libraries call. Each is
 * installed only when missing, so modern browsers run their native versions. Imported first by main.tsx; the
 * syntax side (?. ?? etc.) is lowered by the build target in vite.config.ts.
 */
/* eslint-disable no-extend-native */
const def = (o: object, k: string, v: unknown) => {
  if (!(k in o)) Object.defineProperty(o, k, { value: v, writable: true, configurable: true, enumerable: false });
};

if (typeof globalThis === "undefined") (self as unknown as { globalThis: unknown }).globalThis = self;
const G = globalThis as unknown as Record<string, unknown>;

// Chrome 67+. zod builds int64/uint64 bounds with BigInt(...) when it loads; we use no 64-bit schemas, so a stand-in
// returning a plain number lets it load (no real bigint arithmetic exists on these TVs either way).
if (typeof G.BigInt === "undefined") {
  G.BigInt = (v: unknown) => Number(v);
}

function at(this: ArrayLike<unknown>, i: number) {
  const n = Math.trunc(i) || 0;
  const k = n < 0 ? this.length + n : n;
  return k < 0 || k >= this.length ? undefined : this[k];
}
def(Array.prototype, "at", at);
def(String.prototype, "at", at);
for (const T of [Int8Array, Uint8Array, Uint8ClampedArray, Int16Array, Uint16Array, Int32Array, Uint32Array, Float32Array, Float64Array]) def(T.prototype, "at", at);

def(Array.prototype, "flat", function flat(this: unknown[], depth = 1): unknown[] {
  return depth < 1 ? this.slice() : this.reduce<unknown[]>((acc, v) => acc.concat(Array.isArray(v) ? (flat as (d: number) => unknown[]).call(v, depth - 1) : [v]), []);
});
def(Array.prototype, "flatMap", function (this: unknown[], fn: (v: unknown, i: number, a: unknown[]) => unknown, thisArg?: unknown) {
  return (Array.prototype as unknown as { flat: (this: unknown[], d: number) => unknown[] }).flat.call(this.map(fn, thisArg), 1);
});
def(Array.prototype, "findLast", function (this: unknown[], fn: (v: unknown, i: number, a: unknown[]) => boolean) {
  for (let i = this.length - 1; i >= 0; i--) if (fn(this[i], i, this)) return this[i];
  return undefined;
});
def(Array.prototype, "findLastIndex", function (this: unknown[], fn: (v: unknown, i: number, a: unknown[]) => boolean) {
  for (let i = this.length - 1; i >= 0; i--) if (fn(this[i], i, this)) return i;
  return -1;
});

def(Object, "fromEntries", (it: Iterable<readonly [PropertyKey, unknown]>) => {
  const o: Record<PropertyKey, unknown> = {};
  for (const [k, v] of it) o[k] = v;
  return o;
});
def(Object, "hasOwn", (o: object, k: PropertyKey) => Object.prototype.hasOwnProperty.call(o, k));

def(String.prototype, "replaceAll", function (this: string, find: string | RegExp, rep: string | ((m: string, ...a: unknown[]) => string)) {
  if (find instanceof RegExp) {
    if (!find.global) throw new TypeError("replaceAll must be called with a global RegExp");
    return this.replace(find, rep as string);
  }
  return this.split(find).join(typeof rep === "function" ? rep(find) : rep);
});

def(Promise, "allSettled", (ps: Iterable<unknown>) =>
  Promise.all(Array.from(ps, (p) => Promise.resolve(p).then(
    (value) => ({ status: "fulfilled", value }),
    (reason) => ({ status: "rejected", reason }),
  ))));

if (typeof queueMicrotask !== "function") {
  G.queueMicrotask = (f: () => void) => {
    Promise.resolve().then(f).catch((e) => setTimeout(() => { throw e; }));
  };
}

// Canvas roundRect: Chrome 99+. The 2D games draw every card, paddle and HUD pill with it.
type Radii = number | DOMPointInit | (number | DOMPointInit)[];
function roundRect(this: CanvasPath, x: number, y: number, w: number, h: number, radii: Radii = 0) {
  const list = (Array.isArray(radii) ? radii : [radii]).map((r) => (typeof r === "number" ? r : r.x ?? 0));
  const [tl, tr, br, bl] =
    list.length === 1 ? [list[0], list[0], list[0], list[0]]
    : list.length === 2 ? [list[0], list[1], list[0], list[1]]
    : list.length === 3 ? [list[0], list[1], list[2], list[1]]
    : [list[0], list[1], list[2], list[3]];
  // like the real one: radii that do not fit are scaled down together
  const f = Math.min(1, Math.abs(w) / ((tl! + tr!) || 1), Math.abs(w) / ((bl! + br!) || 1), Math.abs(h) / ((tl! + bl!) || 1), Math.abs(h) / ((tr! + br!) || 1));
  const [a, b, c, d] = [tl! * f, tr! * f, br! * f, bl! * f];
  this.moveTo(x + a, y);
  this.lineTo(x + w - b, y);
  this.arcTo(x + w, y, x + w, y + b, b);
  this.lineTo(x + w, y + h - c);
  this.arcTo(x + w, y + h, x + w - c, y + h, c);
  this.lineTo(x + d, y + h);
  this.arcTo(x, y + h, x, y + h - d, d);
  this.lineTo(x, y + a);
  this.arcTo(x, y, x + a, y, a);
  this.closePath();
}
if (typeof CanvasRenderingContext2D !== "undefined") def(CanvasRenderingContext2D.prototype, "roundRect", roundRect);
if (typeof Path2D !== "undefined") def(Path2D.prototype, "roundRect", roundRect);

// CSS `inset` (Chrome 87+). Stylesheets are lowered at build time, but React writes inline styles as
// `style.inset = "0px"`, which an older engine silently ignores: every full-screen game layer collapsed to 0 px
// tall on a Chrome 66 TV. Expand it to top/right/bottom/left like the shorthand does.
if (typeof CSSStyleDeclaration !== "undefined" && typeof document !== "undefined" && !("inset" in document.documentElement.style)) {
  const split = (v: string) => {
    const out: string[] = [];
    let depth = 0, cur = "";
    for (const ch of v.trim()) {
      if (ch === "(") depth++;
      if (ch === ")") depth--;
      if (/\s/.test(ch) && depth === 0) { if (cur) out.push(cur); cur = ""; } else cur += ch;
    }
    if (cur) out.push(cur);
    return out;
  };
  Object.defineProperty(CSSStyleDeclaration.prototype, "inset", {
    configurable: true,
    get(this: CSSStyleDeclaration) {
      const [t, r, b, l] = [this.top, this.right, this.bottom, this.left];
      if (!t && !r && !b && !l) return "";
      return t === r && r === b && b === l ? t : `${t} ${r} ${b} ${l}`;
    },
    set(this: CSSStyleDeclaration, value: string | number | null) {
      const v = value == null ? "" : String(value);
      const p = split(v);
      const [t, r = t, b = t, l = r] = p.length ? p : ["", "", "", ""];
      this.top = t!; this.right = r!; this.bottom = b!; this.left = l!;
    },
  });
}

if (typeof Element !== "undefined") {
  def(Element.prototype, "replaceChildren", function (this: Element, ...nodes: (Node | string)[]) {
    while (this.lastChild) this.removeChild(this.lastChild);
    for (const n of nodes) this.appendChild(typeof n === "string" ? document.createTextNode(n) : n);
  });
}

export {};
