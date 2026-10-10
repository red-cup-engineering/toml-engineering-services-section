import assert from "node:assert/strict";
import test from "node:test";
import { decodeToml, encodeToml } from "../scripts/toml-codec.mjs";

test("decodes and re-encodes the recovered TOML value tree", () => {
  const decoded = decodeToml('title = "proof path"\n[counts]\nfiles = 3\n');
  assert.deepEqual(decoded, { title: "proof path", counts: { files: 3 } });
  assert.deepEqual(decodeToml(encodeToml(decoded)), decoded);
});

test("round-trips scalars, arrays, and inline tables", () => {
  const value = {
    title: "note",
    count: 3,
    ratio: 1.5,
    active: true,
    tags: ["a", "b"],
    point: { x: 1, y: 2 },
  };
  const encoded = encodeToml(value);
  assert.deepEqual(decodeToml(encoded), value);
});

test("round-trips arrays of tables", () => {
  const text = "[[items]]\nname = \"a\"\n\n[[items]]\nname = \"b\"\n";
  const decoded = decodeToml(text);
  assert.deepEqual(decoded, { items: [{ name: "a" }, { name: "b" }] });
  assert.deepEqual(decodeToml(encodeToml(decoded)), decoded);
});

test("refuses non-string input", () => {
  assert.throws(() => decodeToml(42), TypeError);
  assert.throws(() => encodeToml(null), TypeError);
});
