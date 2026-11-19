/** TOML 1.1 values ↔ text for files, Markdown and conversions. */
import { parseTomlDocument } from "./toml-parser.mjs";
import { TomlDate } from "./toml-date.mjs";

export { TomlDate } from "./toml-date.mjs";

/** Keep signed 64-bit precision and retain the four TOML datetime types. */
export function decodeToml(text, { maxDepth = 1000 } = {}) {
  return parseTomlDocument(text, maxDepth);
}

const BARE_KEY = /^[A-Za-z0-9_-]+$/u;
const MAX_RENAME_BYTES = 4 * 1024 * 1024;

function quoted(value) {
  return JSON.stringify(value).replaceAll("\x7f", "\\u007f");
}

function keyText(key) {
  return BARE_KEY.test(key) ? key : quoted(key);
}

function isTable(value) {
  return value !== null && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype;
}

function printValue(value) {
  if (typeof value === "string") return quoted(value);
  if (typeof value === "number") {
    if (Number.isNaN(value)) return "nan";
    if (!Number.isFinite(value)) return value < 0 ? "-inf" : "inf";
    if (Object.is(value, -0)) return "-0.0";
    const text = value.toString();
    return !Number.isSafeInteger(value) && /^-?\d+$/u.test(text) ? text + ".0" : text;
  }
  if (value instanceof Date) {
    const text = value instanceof TomlDate ? value.toISOString() : Date.prototype.toISOString.call(value);
    if (!/^\d{4}-|^\d{2}:/u.test(text)) throw new RangeError("TOML datetime requires a four-digit year");
    return text;
  }
  if (Array.isArray(value)) return value.length === 0 ? "[]" : `[ ${value.map(printValue).join(", ")} ]`;
  if (isTable(value)) {
    const assignments = Object.entries(value).map(([key, item]) => `${keyText(key)} = ${printValue(item)}`);
    return assignments.length === 0 ? "{}" : `{ ${assignments.join(", ")} }`;
  }
  return String(value);
}

function printToml(table) {
  const blocks = [];
  function section(table, path, array = false) {
    const name = path.join(".");
    const lines = path.length === 0 ? [] : [array ? `[[${name}]]` : `[${name}]`];
    const nested = [];
    for (const [key, value] of Object.entries(table)) {
      const field = keyText(key);
      if (isTable(value)) nested.push({ field, value });
      else if (Array.isArray(value) && value.length > 0 && value.every(isTable)) nested.push({ field, value, array: true });
      else lines.push(`${field} = ${printValue(value)}`);
    }
    if (lines.length > 0) blocks.push(lines.join("\n"));
    for (const { field, value, array } of nested) {
      const child = [...path, field];
      if (array) for (const member of value) section(member, child, true);
      else section(value, child);
    }
  }
  section(table, []);
  return blocks.length === 0 ? "" : blocks.join("\n\n") + "\n";
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
  return printToml(table);
}

/** Replace the parser's exact bare root key token. */
export function renameBareTomlRootKey(text, { from, to } = {}) {
  if (typeof text !== "string" || Buffer.byteLength(text) > MAX_RENAME_BYTES)
    throw new TypeError("root key rename requires TOML text of at most four MiB");
  if (typeof from !== "string" || typeof to !== "string" || !BARE_KEY.test(from) || !BARE_KEY.test(to) || from === to)
    throw new TypeError("root key rename requires two distinct bare TOML keys");

  const offsets = new Map();
  const root = parseTomlDocument(text, 1000, offsets);
  if (!Object.hasOwn(root, from)) throw new TypeError("original root key is absent");
  if (Object.hasOwn(root, to)) throw new TypeError("destination root key already exists");
  const offset = offsets.get(from);
  if (offset === undefined) throw new TypeError("no bare root key edit matches the TOML parse");
  return text.slice(0, offset) + to + text.slice(offset + from.length);
}
