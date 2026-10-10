/** TOML 1.1 values ↔ text. One standards parser for files, Markdown and paid conversions. */
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
