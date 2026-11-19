# @red-cup-engineering/toml-engineering-services-section

<!-- 561-group-standards:badges:start -->
[![Red Cup Engineering](https://img.shields.io/badge/561%20Group-Red%20Cup%20Engineering-c0392b)](https://github.com/red-cup-engineering)
[![License: MIT](https://img.shields.io/badge/license-MIT-c0392b)](LICENSE)
[![Indigenous data: CARE](https://img.shields.io/badge/Indigenous%20data-CARE-4b6f44)](https://github.com/red-cup-engineering/.github/blob/main/GOVERNANCE.md)
[![Tips welcome](https://img.shields.io/badge/tips-welcome-d4a017)](https://github.com/561-group/.github/blob/main/TIPS.md)
<!-- 561-group-standards:badges:end -->

Proof-path section for TOML flatfile serialization.

The native TOML 1.1 parser and serializer serve file callers, Markdown
frontmatter and market operations. Ordinary objects retain own keys safely.
Safe integers remain numbers, larger signed 64-bit integers remain BigInt, and
`TomlDate` retains the four date and time types at millisecond precision.
Decoding accepts one leading UTF-8 BOM. Encoding refuses values that TOML
cannot carry, including null, undefined, sparse arrays, and out-of-range BigInt.

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

## Tests

Run `npm test` for the native codec and root key edit tests. The TOML 1.1
reference files are maintained by [toml-test](https://github.com/toml-lang/toml-test).

## Source-preserving root key edits

The `./toml-codec` export `renameBareTomlRootKey(text, { from, to })` changes a
single bare root assignment token in documents up to four MiB. Other bytes,
including comments and whitespace, stay intact. The edit requires a bare root
key and a vacant destination.
