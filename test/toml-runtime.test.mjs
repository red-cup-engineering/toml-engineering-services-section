import assert from "node:assert/strict";
import { test } from "node:test";
import { decodeToml, encodeToml, renameBareTomlRootKey } from "@red-cup-engineering/toml-engineering-services-section/toml-codec";
import { jsonToToml, tomlToJson, validateTomlDocument } from "@red-cup-engineering/toml-engineering-services-section/convert-toml";
import { tomlJsonSourceCodec } from "@red-cup-engineering/toml-engineering-services-section/source-codec";

const rename = { from: "date_created", to: "date-created" };

test("native TOML 1.1 codec preserves temporal forms and large signed integers", () => {
  const source = [
    "local_date = 2026-11-20",
    "local_time = 13:20:34.125",
    "local_date_time = 2026-11-20T13:20:34",
    "offset_date_time = 2026-11-20T13:20:34+02:00",
    "maximum = 9223372036854775807",
    ""
  ].join("\n");
  const data = decodeToml(source);
  assert.equal(data.maximum, 9223372036854775807n);
  assert.deepEqual(
    [data.local_date, data.local_time, data.local_date_time, data.offset_date_time].map(value => value.toISOString()),
    ["2026-11-20", "13:20:34.125", "2026-11-20T13:20:34.000", "2026-11-20T13:20:34.000+02:00"]
  );
  assert.deepEqual(decodeToml(encodeToml(data)), data);
  assert.throws(() => encodeToml({ unsupported: null }), TypeError);
});

test("root rename preserves original bytes around the selected token", () => {
  const original = [
    "\uFEFFdescription = '''", 'date_created = "not metadata"', "'''",
    '  date_created  = "2025-11-09" # authorship',
    "[references]", 'date_created = "not the root"', ""
  ].join("\r\n");
  const edited = renameBareTomlRootKey(original, rename);
  assert.equal(edited, original.replace("  date_created  =", "  date-created  ="));
  assert.equal(renameBareTomlRootKey(edited, { from: rename.to, to: rename.from }), original);
  assert.equal(decodeToml(edited)["date-created"], "2025-11-09");
  assert.equal(decodeToml(edited).references.date_created, "not the root");
  assert.throws(() => renameBareTomlRootKey('[nested]\ndate_created = "x"\n', rename), /absent/);
  assert.throws(() => renameBareTomlRootKey('"date_created" = "x"\n', rename), /no bare root/);
  assert.throws(() => renameBareTomlRootKey('date_created = "x"\ndate-created = "y"\n', rename), /already exists/);
});

test("bounded TOML-to-JSON rejects native values that JSON would discard or coerce", () => {
  const json = { title: "miigwech; niño", published: false, count: 3 };
  const { text } = jsonToToml({ value: json });
  assert.deepEqual(tomlToJson({ text }).value, json);
  assert.equal(validateTomlDocument({ text }).valid, true);
  const bad = validateTomlDocument({ text: "title = [\n" });
  assert.equal(bad.valid, false);
  assert.equal(bad.standard, "TOML1.1.0");
  assert.equal(typeof bad.issues[0].line, "number");
  for (const unsupported of ["2026-11-20", "9223372036854775807", "inf", "nan"]) {
    assert.throws(() => tomlToJson({ text: "x = " + unsupported + "\n" }), TypeError);
  }
  assert.throws(() => validateTomlDocument({ text: "# " + "é".repeat(32768) }), RangeError);
});

test("typed source codec distinguishes exact UTF-8 carriers including a BOM", () => {
  const encoder = new TextEncoder();
  const withoutBOM = tomlJsonSourceCodec.read(encoder.encode('title = "niño"\n'));
  const withBOM = tomlJsonSourceCodec.read(encoder.encode('\uFEFFtitle = "niño"\n'));
  assert.equal(withBOM.codec, "toml.json/v1");
  assert.equal(withBOM.valueIdentity, "exact");
  assert.deepEqual(withBOM.value, withoutBOM.value);
  assert.equal(withBOM.source.size, withoutBOM.source.size + 3);
  assert.notEqual(withBOM.source.ni, withoutBOM.source.ni);
  assert.equal(withBOM.claim.object, withoutBOM.claim.object);
  const written = tomlJsonSourceCodec.write(withBOM.value);
  assert.deepEqual(written.reading.value, withBOM.value);
  assert.throws(() => tomlJsonSourceCodec.read(new Uint8Array([0xff])), TypeError);
});
