import { TomlDate } from "./toml-date.mjs";

const BARE_KEY = /[A-Za-z0-9_-]+/y;
const SCALAR = /[^ \t\r\n#,}\]]+/y;
const DATE_HEAD = /^\d{4}-\d{2}-\d{2}$/u;
const DATE_OR_TIME = /^\d{2}(?::\d{2}|\d{2}-\d{2}-\d{2})/u;
const INTEGER = /^[+-]?(?:0|[1-9](?:_?[0-9])*)$/u;
const NON_DECIMAL_INTEGER = /^(?:0x[0-9a-fA-F](?:_?[0-9a-fA-F])*|0o[0-7](?:_?[0-7])*|0b[01](?:_?[01])*)$/u;
const FLOAT = /^[+-]?(?:0|[1-9](?:_?[0-9])*)(?:\.[0-9](?:_?[0-9])*(?:[eE][+-]?[0-9](?:_?[0-9])*)?|[eE][+-]?[0-9](?:_?[0-9])*)$/u;
const INTEGER_MIN = -(1n << 63n);
const INTEGER_MAX = (1n << 63n) - 1n;
const ESCAPES = { b: "\b", t: "\t", n: "\n", f: "\f", r: "\r", e: "\x1b", '"': '"', "\\": "\\" };
const ESCAPE_WIDTH = { x: 2, u: 4, U: 8 };
const FORBIDDEN_CONTROL = /[\u0000-\u0008\u000a-\u001f\u007f]/u;
const HEX = /^[0-9a-fA-F]+$/u;

function put(table, key, value) {
  Object.defineProperty(table, key, { value, enumerable: true, writable: true, configurable: true });
}

function ensureDepth(depth, maximum) {
  if (depth > maximum) throw new RangeError(`TOML nesting exceeds depth ${maximum}`);
}

function checkTreeDepth(root, maxDepth) {
  const pending = [[root, 0]];
  while (pending.length !== 0) {
    const [table, depth] = pending.pop();
    ensureDepth(depth, maxDepth);
    for (const value of Object.values(table)) {
      if (value && typeof value === "object" && !(value instanceof Date)) pending.push([value, depth + 1]);
    }
  }
}

export function parseTomlDocument(text, maxDepth, rootKeyOffsets) {
  if (typeof text !== "string") throw new TypeError("TOML text must be a string");
  if (!Number.isSafeInteger(maxDepth) || maxDepth < 0) throw new RangeError("TOML depth must be a nonnegative integer");

  let offset = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  const tables = new WeakMap();
  const arraysOfTables = new WeakSet();
  const root = newTable("root");
  let currentTable = root;

  if (!text.isWellFormed()) {
    // Unicode-mode matching finds only an unpaired surrogate here.
    fail("document contains invalid Unicode", text.search(/[\ud800-\udfff]/u));
  }

  function newTable(kind) {
    const value = {};
    tables.set(value, kind);
    return value;
  }

  function fail(reason, at = offset) {
    const before = text.slice(0, at);
    const line = before.split("\n").length;
    const column = at - before.lastIndexOf("\n");
    const error = new SyntaxError(`Invalid TOML document: ${reason}`);
    error.line = line;
    error.column = column;
    throw error;
  }

  function match(pattern) {
    pattern.lastIndex = offset;
    const token = pattern.exec(text)?.[0];
    if (token !== undefined) offset += token.length;
    return token;
  }

  function take(token) {
    if (!text.startsWith(token, offset)) return false;
    offset += token.length;
    return true;
  }

  function expect(token) {
    if (!take(token)) fail(`expected ${JSON.stringify(token)}`);
  }

  function spaces() {
    while (text[offset] === " " || text[offset] === "\t") offset++;
  }

  function newline() {
    return take("\n") || take("\r\n");
  }

  function comment() {
    if (!take("#")) return;
    while (offset < text.length && text[offset] !== "\n" && text[offset] !== "\r") {
      if (FORBIDDEN_CONTROL.test(text[offset])) fail("control character in comment");
      offset++;
    }
  }

  function layout() {
    do {
      spaces();
      comment();
    } while (newline());
  }

  function escape(multiline) {
    const start = offset;
    if (multiline) {
      spaces();
      if (newline()) {
        do { spaces(); } while (newline());
        return "";
      }
      offset = start;
    }
    const kind = text[offset++];
    if (Object.hasOwn(ESCAPES, kind)) return ESCAPES[kind];
    const width = ESCAPE_WIDTH[kind];
    if (width === undefined) fail("unknown string escape", start);
    const digits = text.slice(offset, offset + width);
    if (digits.length !== width || !HEX.test(digits)) fail("expected hexadecimal digits in string escape", start);
    offset += width;
    const scalar = Number.parseInt(digits, 16);
    if (scalar > 0x10ffff || (scalar >= 0xd800 && scalar <= 0xdfff)) fail("escape is not a Unicode scalar", start);
    return String.fromCodePoint(scalar);
  }

  function string(quotedKey = false) {
    const quote = text[offset++];
    const basic = quote === '"';
    const multiline = text.startsWith(quote.repeat(2), offset);
    if (multiline) {
      if (quotedKey) fail("keys cannot use a multiline string");
      offset += 2;
      newline();
    }
    let value = "";
    while (offset < text.length) {
      if (text[offset] === quote) {
        if (!multiline) { offset++; return value; }
        let count = 0;
        while (count < 5 && text[offset + count] === quote) count++;
        offset += count;
        if (count >= 3) return value + quote.repeat(count - 3);
        value += quote.repeat(count);
      } else if (multiline && newline()) {
        value += "\n";
      } else if (basic && take("\\")) {
        value += escape(multiline);
      } else {
        if (FORBIDDEN_CONTROL.test(text[offset])) fail("control character or newline in string");
        value += text[offset++];
      }
    }
    fail("unterminated string");
  }

  function keyPath() {
    const path = [];
    do {
      spaces();
      const at = offset;
      const bare = text[offset] !== '"' && text[offset] !== "'";
      const name = bare ? match(BARE_KEY) : string(true);
      if (name === undefined) fail("expected a key");
      path.push({ name, at, bare });
      spaces();
    } while (take("."));
    return path;
  }

  function descend(table, key, declaration) {
    if (!Object.hasOwn(table, key.name)) {
      const kind = declaration ? "implicit" : "dotted";
      put(table, key.name, newTable(kind));
    }
    const child = table[key.name];
    const kind = tables.get(child);
    if (declaration && arraysOfTables.has(child)) return child.at(-1);
    if (kind === undefined || kind === "inline" || (!declaration && kind !== "dotted" && kind !== "implicit")) {
      fail(`key ${JSON.stringify(key.name)} cannot be extended`, key.at);
    }
    if (!declaration && kind === "implicit") tables.set(child, "dotted");
    return child;
  }

  function assignment(table, path, value) {
    const key = path.at(-1);
    for (const parent of path.slice(0, -1)) table = descend(table, parent, false);
    if (Object.hasOwn(table, key.name)) fail(`key ${JSON.stringify(key.name)} is already defined`, key.at);
    put(table, key.name, value);
  }

  function header(path, array) {
    let table = root;
    const key = path.at(-1);
    for (const parent of path.slice(0, -1)) table = descend(table, parent, true);
    const existing = Object.hasOwn(table, key.name) ? table[key.name] : undefined;
    if (array) {
      if (existing !== undefined && !arraysOfTables.has(existing)) fail("array of tables is already defined with another type", key.at);
      const list = existing ?? [];
      if (existing === undefined) {
        arraysOfTables.add(list);
        put(table, key.name, list);
      }
      const member = newTable("header");
      list.push(member);
      return member;
    }
    if (existing === undefined) {
      const value = newTable("header");
      put(table, key.name, value);
      return value;
    }
    if (tables.get(existing) !== "implicit") fail("table is already defined", key.at);
    tables.set(existing, "header");
    return existing;
  }

  function sequence(end, readItem) {
    layout();
    if (take(end)) return;
    for (;;) {
      readItem();
      layout();
      if (take(end)) return;
      expect(",");
      layout();
      if (take(end)) return;
    }
  }

  function scalar() {
    const at = offset;
    let token = match(SCALAR);
    if (token === undefined) fail("expected a value");
    if (DATE_HEAD.test(token) && text[offset] === " " && /^\d{2}:\d{2}/u.test(text.slice(offset + 1, offset + 6))) {
      offset++;
      token += " " + match(SCALAR);
    }
    if (token === "true" || token === "false") return token === "true";
    if (token === "inf" || token === "+inf" || token === "-inf") return token === "-inf" ? -Infinity : Infinity;
    if (token === "nan" || token === "+nan" || token === "-nan") return NaN;
    if (INTEGER.test(token) || NON_DECIMAL_INTEGER.test(token)) {
      const integer = BigInt(token.replaceAll("_", ""));
      if (integer < INTEGER_MIN || integer > INTEGER_MAX) fail("integer exceeds signed 64 bits", at);
      return integer >= BigInt(Number.MIN_SAFE_INTEGER) && integer <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(integer) : integer;
    }
    if (FLOAT.test(token)) return Number(token.replaceAll("_", ""));
    if (DATE_OR_TIME.test(token)) {
      const date = new TomlDate(token);
      if (date.isValid()) return date;
    }
    fail("invalid value", at);
  }

  function value(depth) {
    if (text[offset] === '"' || text[offset] === "'") return string();
    if (take("[")) {
      ensureDepth(depth, maxDepth);
      const list = [];
      sequence("]", () => list.push(value(depth + 1)));
      return list;
    }
    if (take("{")) {
      ensureDepth(depth, maxDepth);
      const table = newTable("inline");
      sequence("}", () => pair(table, depth + 1));
      return table;
    }
    return scalar();
  }

  function pair(table, depth) {
    const path = keyPath();
    expect("=");
    spaces();
    assignment(table, path, value(depth));
    if (rootKeyOffsets && table === root && path.length === 1 && path[0].bare) rootKeyOffsets.set(path[0].name, path[0].at);
  }

  layout();
  while (offset < text.length) {
    if (take("[")) {
      const array = take("[");
      const path = keyPath();
      expect(array ? "]]" : "]");
      currentTable = header(path, array);
    } else {
      pair(currentTable, 1);
    }
    spaces();
    comment();
    if (offset < text.length && !newline()) fail("expected end of line");
    layout();
  }
  checkTreeDepth(root, maxDepth);
  return root;
}
