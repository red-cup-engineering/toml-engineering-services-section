/** TOML 1.1 values ↔ text. One standards parser for files, Markdown and paid conversions. */
import { isDeepStrictEqual } from "node:util";
import { parse, stringify, TomlError } from "smol-toml";
export { TomlDate } from "smol-toml";

// Parser tables are converted to the ordinary-object carrier existing callers
// consume. Own __proto__ keys remain data; assigning them never changes a prototype.
function plainTables(value, maxDepth) {
  const root = {};
  const pending = [{ source: value, target: root, depth: 0 }];
  while (pending.length) {
    const { source, target, depth } = pending.pop();
    if (depth > maxDepth) throw new RangeError(`TOML tree exceeds depth ${maxDepth}`);
    for (const [key, value] of Object.entries(source)) {
      let next = value;
      if (value && typeof value === "object" && !(value instanceof Date)) {
        next = Array.isArray(value) ? [] : {};
        pending.push({ source: value, target: next, depth: depth + 1 });
      }
      Object.defineProperty(target, key, { value: next, enumerable: true, writable: true, configurable: true });
    }
  }
  return root;
}

/** Safe integers remain numbers; larger TOML integers retain their exact BigInt value.
 * Datetimes retain the parser's native TomlDate representation. A leading UTF-8
 * BOM is admitted by the parser for existing file callers and market requests.
 */
export function decodeToml(text, { maxDepth = 1000 } = {}) {
  if (typeof text !== "string") throw new TypeError("TOML text must be a string");
  try {
    return plainTables(parse(text, { integersAsBigInt: "asNeeded", maxDepth }), maxDepth);
  } catch (cause) {
    if (!(cause instanceof TomlError)) throw cause;
    if (cause.message.startsWith("Invalid TOML document: document contains excessively nested structures.")) throw new RangeError(`TOML nesting exceeds depth ${maxDepth}`, { cause });
    const error = new SyntaxError(cause.message, { cause });
    error.line = cause.line;
    error.column = cause.column;
    throw error;
  }
}

/** Refuse values TOML cannot carry instead of silently omitting them. */
export function encodeToml(table) {
  if (table === null || typeof table !== "object" || Array.isArray(table) || Object.getPrototypeOf(table) !== Object.prototype) throw new TypeError("TOML root must be a plain table");
  const active = new Set();
  function inspect(value, depth) {
    if (depth > 64) throw new RangeError("TOML encoding exceeds depth 64");
    if (typeof value === "string") {
      if (!value.isWellFormed()) throw new TypeError("TOML strings must contain well-formed Unicode");
      return;
    }
    if (typeof value === "bigint" && (value < -(2n ** 63n) || value > 2n ** 63n - 1n)) throw new RangeError("TOML integers must fit signed 64 bits");
    if (["number", "bigint", "boolean"].includes(typeof value)) return;
    if (value instanceof Date) {
      if (!Number.isFinite(value.getTime())) throw new TypeError("TOML datetime is invalid");
      return;
    }
    if (value === null || typeof value !== "object") throw new TypeError("TOML has no null, undefined, function or symbol value");
    if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype) throw new TypeError("TOML tables must be plain objects");
    if (active.has(value)) throw new TypeError("TOML values must be acyclic");
    if (Object.getOwnPropertySymbols(value).length) throw new TypeError("TOML has no symbol key");
    if (Array.isArray(value) && Object.keys(value).some(key => !/^(0|[1-9][0-9]*)$/u.test(key) || Number(key) >= value.length)) throw new TypeError("TOML arrays cannot carry named properties");
    active.add(value);
    for (const key of Object.keys(value)) {
      if (!key.isWellFormed()) throw new TypeError("TOML keys must contain well-formed Unicode");
      inspect(value[key], depth + 1);
    }
    if (Array.isArray(value)) for (let i = 0; i < value.length; i++) if (!Object.hasOwn(value, i)) throw new TypeError("TOML arrays cannot contain holes");
    active.delete(value);
  }
  inspect(table, 0);
  return stringify(table);
}

const BARE_KEY = /^[A-Za-z0-9_-]+$/u;
const MAX_RENAME_BYTES = 4 * 1024 * 1024;
const MAX_KEY_CANDIDATES = 16;

/**
 * Rename one bare, line-start root key without reserializing a TOML document.
 * Use the codec to prove that the entire parsed value is unchanged apart from
 * the supplied key. Assignments in nested tables or multiline strings cannot
 * satisfy that proof. Quoted and dotted keys require a different edit.
 * @param {string} text Original TOML document.
 * @param {{from: string, to: string}} keys Distinct bare TOML keys.
 * @returns {string} Original text with exactly one key token replaced.
 */
export function renameBareTomlRootKey(text, { from, to } = {}) {
  if (typeof text !== "string" || Buffer.byteLength(text) > MAX_RENAME_BYTES)
    throw new TypeError("root key rename requires TOML text of at most four MiB");
  if (typeof from !== "string" || typeof to !== "string" || !BARE_KEY.test(from) || !BARE_KEY.test(to) || from === to)
    throw new TypeError("root key rename requires two distinct bare TOML keys");
  const original = decodeToml(text);
  if (!Object.hasOwn(original, from)) throw new TypeError("original root key is absent");
  if (Object.hasOwn(original, to)) throw new TypeError("destination root key already exists");
  const expected = Object.fromEntries(Object.entries(original).map(([key, value]) => [key === from ? to : key, value]));
  const offsets = [];
  for (const match of text.matchAll(/^(\uFEFF?[ \t]*)([A-Za-z0-9_-]+)(?=[ \t]*=)/gmu)) {
    if (match[2] !== from) continue;
    if (offsets.length === MAX_KEY_CANDIDATES) throw new RangeError("too many candidate TOML key tokens");
    offsets.push(match.index + match[1].length);
  }
  let result;
  for (const offset of offsets) {
    const candidate = text.slice(0, offset) + to + text.slice(offset + from.length);
    let parsed;
    try { parsed = decodeToml(candidate); }
    catch (error) { if (error instanceof SyntaxError) continue; throw error; }
    if (!isDeepStrictEqual(parsed, expected)) continue;
    if (result !== undefined) throw new TypeError("more than one root key edit matches the TOML parse");
    result = candidate;
  }
  if (result === undefined) throw new TypeError("no bare root key edit matches the TOML parse");
  return result;
}
