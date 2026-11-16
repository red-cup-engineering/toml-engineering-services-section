import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeToml, renameBareTomlRootKey } from "@red-cup-engineering/toml-engineering-services-section/toml-codec";

const keys = { from: "date_created", to: "date-created" };

test("renames only the proved root key, retaining byte spelling, CRLF, inline comments and table/string lookalikes", () => {
  const raw = [
    "\uFEFFdescription = '''",
    'date_created = "not metadata"',
    "'''",
    '  date_created  = "2025-11-09" # authorship',
    'date_modified = "2026-11-09"',
    "[references]",
    'date_created = "not the root"',
    "precise = 9223372036854775807",
    "",
  ].join("\r\n");
  const actual = renameBareTomlRootKey(raw, keys);
  const expected = raw.replace("  date_created  =", "  date-created  =");
  assert.equal(actual, expected);
  assert.equal(renameBareTomlRootKey(actual, { from: keys.to, to: keys.from }), raw);
  const result = decodeToml(actual);
  assert.equal(result["date-created"], "2025-11-09");
  assert.equal(result.references.date_created, "not the root");
  assert.equal(result.references.precise, 9223372036854775807n);
});

test("fails closed on an absent, quoted, conflicting or malformed root key", () => {
  assert.throws(() => renameBareTomlRootKey('[memo]\ndate_created = "2025-11-09"\n', keys), /absent/);
  assert.throws(() => renameBareTomlRootKey('"date_created" = "2025-11-09"\n', keys), /no bare root/);
  assert.throws(() => renameBareTomlRootKey('date_created = "old"\ndate-created = "new"\n', keys), /already exists/);
  assert.throws(() => renameBareTomlRootKey('date_created = [\n', keys), SyntaxError);
  assert.throws(() => renameBareTomlRootKey('date_created = "old"\n', { ...keys, to: "foreign.child" }), /distinct bare/);
});

test("preserves own data keys and bounds ambiguous lexical work", () => {
  const out = decodeToml(renameBareTomlRootKey("identifier = 9\n", { from: "identifier", to: "__proto__" }));
  assert.equal(Object.getPrototypeOf(out), Object.prototype);
  assert.equal(Object.getOwnPropertyDescriptor(out, "__proto__").value, 9);
  const decoys = 'note = """\n' + 'date_created = "decoy"\n'.repeat(16) + '"""\ndate_created = "2025-11-09"\n';
  assert.throws(() => renameBareTomlRootKey(decoys, keys), /too many candidate/);
});
