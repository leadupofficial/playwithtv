/**
 * A small JSON Schema checker for the subset content/trivia/schema.json uses (type, enum, required,
 * properties, additionalProperties: false, items, min/maxItems, min/maxLength, pattern, minimum/maximum,
 * oneOf and local $ref). No dependency, so the same check runs in the browser tests, Vitest and the CLI.
 */
export type Schema = Record<string, unknown>;

const typeOf = (v: unknown) => (Array.isArray(v) ? "array" : v === null ? "null" : typeof v);

function matchesType(v: unknown, t: string): boolean {
  if (t === "integer") return typeof v === "number" && Number.isInteger(v);
  if (t === "number") return typeof v === "number" && Number.isFinite(v);
  return typeOf(v) === t;
}

function resolve(root: Schema, ref: string): Schema {
  if (!ref.startsWith("#/")) throw new Error(`unsupported $ref ${ref}`);
  let node: unknown = root;
  for (const part of ref.slice(2).split("/")) node = (node as Record<string, unknown>)[part];
  if (!node || typeof node !== "object") throw new Error(`unresolved $ref ${ref}`);
  return node as Schema;
}

/** Returns a list of "path: problem" strings; empty when the value matches. */
export function checkSchema(value: unknown, schema: Schema, root: Schema = schema, path = "$"): string[] {
  if (typeof schema.$ref === "string") return checkSchema(value, resolve(root, schema.$ref), root, path);
  const errs: string[] = [];
  const s = schema as {
    type?: string; enum?: unknown[]; required?: string[]; properties?: Record<string, Schema>;
    additionalProperties?: boolean; items?: Schema; minItems?: number; maxItems?: number; minLength?: number;
    maxLength?: number; pattern?: string; minimum?: number; maximum?: number; oneOf?: Schema[];
  };
  if (s.oneOf) {
    const ok = s.oneOf.filter((sub) => checkSchema(value, sub, root, path).length === 0).length;
    if (ok !== 1) errs.push(`${path}: matches ${ok} of the oneOf choices (needs exactly 1)`);
    return errs;
  }
  if (s.type && !matchesType(value, s.type)) return [`${path}: expected ${s.type}, got ${typeOf(value)}`];
  if (s.enum && !s.enum.includes(value)) errs.push(`${path}: ${JSON.stringify(value)} is not one of ${JSON.stringify(s.enum)}`);
  if (typeof value === "string") {
    const len = [...value].length;
    if (s.minLength !== undefined && len < s.minLength) errs.push(`${path}: shorter than ${s.minLength}`);
    if (s.maxLength !== undefined && len > s.maxLength) errs.push(`${path}: longer than ${s.maxLength}`);
    if (s.pattern && !new RegExp(s.pattern, "u").test(value)) errs.push(`${path}: does not match ${s.pattern}`);
  }
  if (typeof value === "number") {
    if (s.minimum !== undefined && value < s.minimum) errs.push(`${path}: below ${s.minimum}`);
    if (s.maximum !== undefined && value > s.maximum) errs.push(`${path}: above ${s.maximum}`);
  }
  if (Array.isArray(value)) {
    if (s.minItems !== undefined && value.length < s.minItems) errs.push(`${path}: fewer than ${s.minItems} items`);
    if (s.maxItems !== undefined && value.length > s.maxItems) errs.push(`${path}: more than ${s.maxItems} items`);
    if (s.items) value.forEach((v, i) => errs.push(...checkSchema(v, s.items!, root, `${path}[${i}]`)));
  }
  if (typeOf(value) === "object") {
    const obj = value as Record<string, unknown>;
    for (const k of s.required ?? []) if (!(k in obj)) errs.push(`${path}: missing "${k}"`);
    for (const [k, v] of Object.entries(obj)) {
      const sub = s.properties?.[k];
      if (sub) errs.push(...checkSchema(v, sub, root, `${path}.${k}`));
      else if (s.additionalProperties === false) errs.push(`${path}: unexpected field "${k}"`);
    }
  }
  return errs;
}
