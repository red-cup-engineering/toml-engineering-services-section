import assert from "node:assert/strict";
import test from "node:test";
import { decodeToml, encodeToml } from "@red-cup-engineering/toml-engineering-services-section/toml-codec";
import { tomlToJson, jsonToToml, validateTomlDocument } from "@red-cup-engineering/toml-engineering-services-section/convert-toml";

test("the standards parser preserves native TOML values, nested array tables and data keys", () => {
  const source = '[[groups]]\nname="first"\n[groups.nested]\ncount=1\n[[groups]]\nname="second"\n[groups.nested]\ncount=2\n';
  const value = { groups: [{ name: "first", nested: { count: 1 } }, { name: "second", nested: { count: 2 } }] };
  assert.deepEqual(decodeToml(source), value);
  assert.deepEqual(decodeToml(encodeToml(value)), value);
  assert.equal(decodeToml('integer=9007199254740993').integer, 9007199254740993n);
  assert.equal(decodeToml('at=1979-05-27').at.toISOString(), '1979-05-27');
  const risky = decodeToml('__proto__.polluted=true\nconstructor="data"');
  assert.equal(({}).polluted, undefined);
  assert.equal(Object.getPrototypeOf(risky), Object.prototype);
  assert.equal(Object.hasOwn(risky, '__proto__'), true);
  assert.equal(risky.__proto__.polluted, true);
  assert.deepEqual(decodeToml(encodeToml(risky)), risky);
  for (const text of ['a=1\na=2', 'a=[1 2]', 'a="\\q"', 'a=01', '[a]\nx=1\n[a]\ny=2']) assert.throws(() => decodeToml(text), SyntaxError);
  for (const value of [{ a: null }, { a: undefined }, { a: [undefined] }, { a: 2n ** 63n }]) assert.throws(() => encodeToml(value));
});

test("TOML 1.1 validation returns real diagnostics and JSON conversion refuses loss", () => {
  assert.deepEqual(validateTomlDocument({ text: 'a={\n x="\\x41\\e",\n}\nat=07:32' }), { valid: true, standard: 'TOML1.1.0', issues: [] });
  assert.deepEqual(tomlToJson({ text: '\uFEFFa=1' }), { value: { a: 1 } });
  assert.equal(validateTomlDocument({ text: '\uFEFFa=1' }).valid, true);
  const invalid = validateTomlDocument({ text: 'a=1\na=2' });
  assert.equal(invalid.valid, false); assert.equal(invalid.issues[0].line, 2); assert(invalid.issues[0].column >= 1);
  const value = { title: 'a\nb', nested: { rows: [{ count: 1 }, { count: 2 }] } };
  assert.deepEqual(tomlToJson({ text: jsonToToml({ value }).text }), { value });
  for (const text of ['a=9007199254740993', 'a=inf', 'a=nan', 'a=1979-05-27']) assert.throws(() => tomlToJson({ text }));
  assert.throws(() => jsonToToml({ value: { a: null } }));
  assert.throws(() => validateTomlDocument({ text: 'x'.repeat(65537) }), RangeError);
  assert.throws(() => validateTomlDocument({ text: 'a=' + '['.repeat(66) + '1' + ']'.repeat(66) }), RangeError);
  assert.throws(() => validateTomlDocument({ text: '\uD800' }), TypeError);
  assert.throws(() => validateTomlDocument({ text: '', extra: true }), TypeError);
});

test("the TOML JSON source profile witnesses BOM bytes and refuses lossy values", async () => {
  const { tomlJsonSourceCodec } = await import("@red-cup-engineering/toml-engineering-services-section/source-codec");
  const { verifyContentAddress } = await import("@red-cup-engineering/signcell/content-address/raw");
  const bytes = Buffer.from("\uFEFFa = 1\r\n");
  const reading = tomlJsonSourceCodec.read(bytes);
  assert.deepEqual(reading.value, { a: 1 });
  assert.equal(verifyContentAddress(bytes, reading.source), true);
  assert.deepEqual(tomlJsonSourceCodec.write(reading.value).reading.value, reading.value);
  assert.throws(() => tomlJsonSourceCodec.read(Buffer.from("a = 1979-05-27")));
});
