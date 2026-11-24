import assert from "node:assert/strict";
import test from "node:test";
import { tomlJsonSourceCodec } from "@red-cup-engineering/toml-engineering-services-section/source-codec";
import { decodeToml, encodeToml } from "@red-cup-engineering/toml-engineering-services-section/toml-codec";

test("room metadata preserves its source identity across reads", () => {
  const bytes = new TextEncoder().encode('title = "Garden"\r\n[room]\r\nexits = ["north", "south"]\r\n');
  const original = tomlJsonSourceCodec.read(bytes);
  assert.deepEqual(original.value, { title: "Garden", room: { exits: ["north", "south"] } });
  const rewritten = tomlJsonSourceCodec.write(original.value).reading;
  assert.deepEqual(rewritten.value, original.value);
  assert.deepEqual(tomlJsonSourceCodec.read(bytes).claim, original.claim);
});

test("calendar dates round-trip in TOML and refuse conversion to a JSON room record", () => {
  const text = "opens = 2024-02-29\n";
  const room = decodeToml(text);
  assert.equal(room.opens.toISOString(), "2024-02-29");
  assert.equal(decodeToml(encodeToml(room)).opens.toISOString(), room.opens.toISOString());
  assert.throws(() => decodeToml("opens = 2023-02-29"));
  assert.throws(() => tomlJsonSourceCodec.read(new TextEncoder().encode(text)));
});
