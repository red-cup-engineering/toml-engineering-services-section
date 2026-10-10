/** Bounded TOML/JSON conversions and standards diagnostics, without I/O. */
import { canonicalizeJson, JSON_RESOURCE_ENVELOPE } from "@red-cup-engineering/json-services-section/canonical-json";
import { decodeToml, encodeToml } from "./toml-codec.mjs";

const LIMIT = 65536;
const envelope = Object.freeze({ ...JSON_RESOURCE_ENVELOPE, maxSourceBytes: LIMIT, maxCanonicalBytes: LIMIT, maxNodes: 8192, maxArrayLength: 4096 });
function request(body, key) {
  if (!body || typeof body !== "object" || Array.isArray(body) || !Object.hasOwn(body, key) || Object.keys(body).some(k => k !== key)) throw new TypeError(`request requires exactly ${key}`);
  return body[key];
}
function admitTomlText(body) {
  const text = request(body, "text");
  if (typeof text !== "string" || !text.isWellFormed()) throw new TypeError("text must be well-formed Unicode TOML text");
  if (new TextEncoder().encode(text).byteLength > LIMIT) throw new RangeError(`TOML text exceeds ${LIMIT} bytes`);
  return text;
}
export function tomlToJson(body) {
  const value = decodeToml(admitTomlText(body), { maxDepth: 64 });
  // Date, BigInt, NaN and infinity are deliberately refused, never JSON.stringify'd away.
  return { value: canonicalizeJson(value, envelope).value };
}
export function jsonToToml(body) {
  const value = canonicalizeJson(request(body, "value"), envelope).value;
  const text = encodeToml(value);
  if (new TextEncoder().encode(text).byteLength > LIMIT) throw new RangeError(`TOML output exceeds ${LIMIT} bytes`);
  return { text };
}
export function validateTomlDocument(body) {
  const text = admitTomlText(body);
  try {
    decodeToml(text, { maxDepth: 64 });
    return { valid: true, standard: "TOML1.1.0", issues: [] };
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    return { valid: false, standard: "TOML1.1.0", issues: [{ message: error.message.split("\n")[0].slice(0, 1024), line: error.line, column: error.column }] };
  }
}
