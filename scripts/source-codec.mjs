import { decodeUtf8Source, defineSourceCodec, encodeUtf8Source } from "@red-cup-engineering/signcell/source-codec";
import { jsonToToml, tomlToJson } from "./convert-toml.mjs";

/** The TOML-to-JSON profile refuses values whose TOML types JSON cannot preserve. */
export const tomlJsonSourceCodec = defineSourceCodec({
  id: "toml.json/v1", mediaType: "application/toml", maxBytes: 65536, valueIdentity: "exact",
  decode: bytes => tomlToJson({ text: decodeUtf8Source(bytes) }).value,
  encode: value => encodeUtf8Source(jsonToToml({ value }).text),
});
