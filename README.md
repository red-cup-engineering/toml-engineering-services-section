# TOML file services section

One TOML 1.1 parser and serializer serves file callers, Markdown frontmatter and
market operations. The handwritten parser is replaced by smol-toml 1.9.0, pinned
to its immutable npm tarball; ordinary objects retain own keys safely. Safe
integers remain numbers, larger signed 64-bit integers remain BigInt, and dates
use native TomlDate values. Dates use the library's millisecond precision.
File and market decoding both permit one leading BOM. Null, undefined, sparse arrays and out-of-range integers are refused
on encoding rather than silently dropped or converted into invalid TOML.

`./convert-toml` exports `validateTomlDocument`, `tomlToJson`, `jsonToToml`.
Market conversions are bounded to 65536 UTF-8/canonical JSON
bytes and depth 64. JSON conversion refuses native dates, large integers and
nonfinite floats; it does not stringify or round them away. The validator returns
syntax diagnostics for invalid documents, which are legitimate analysis inputs;
malformed invocations and resource-limit violations are refused.

The existing market offers these operations for $0.0001 each:
`/v1/data/toml-validate`, `/v1/data/toml-to-json`, `/v1/data/json-to-toml`.
Their declarations, runnable examples and native payment challenges are served
at https://market.561.group/v1/catalog.
