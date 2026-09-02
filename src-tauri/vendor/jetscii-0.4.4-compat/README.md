# Vendored `jetscii` (compat patch)

This directory vendors a patched copy of the [`jetscii`](https://github.com/shepmaster/jetscii)
crate so that the project's Rust tests/build can compile on current Rust toolchains.

## Why this exists

The dependency chain is:

```
docx 1.1.2  →  strong-xml 0.5.0  →  jetscii ^0.4.4
```

`docx`'s latest release (1.1.2) pins `strong-xml ^0.5.0`, and `strong-xml` 0.5.0
requires `jetscii ^0.4.4`. The real crates.io `jetscii` 0.4.4 no longer compiles on
modern Rust (≥ 1.51), failing with:

```
error: generic parameters may not be used in const operations
   --> .../jetscii-0.4.4/src/simd.rs:109:13
    |
109 |             T::CONTROL_BYTE,
    |             ^ cannot perform const operation using `T`
```

This was fixed upstream in `jetscii` 0.5.0 and later. Because `strong-xml` 0.5.0's
`^0.4.4` requirement excludes `0.5.x` (semver-incompatible), Cargo will never pick up
the fixed release on its own, and `[patch.crates-io]` cannot point to a different
crates.io version.

## What this is

- Source: **jetscii 0.5.3**, copied verbatim from
  <https://crates.io/crates/jetscii/0.5.3> (also available at
  <https://github.com/shepmaster/jetscii>).
- Changes from upstream, all confined to `Cargo.toml` (the `src/*.rs` and `build.rs`
  are verbatim 0.5.3):
  - `version = "0.4.4"` so that it satisfies `strong-xml` 0.5.0's `^0.4.4` requirement.
    The public API is unchanged and compatible with how `strong-xml` uses it.
  - Dev-dependencies were omitted (they are only needed to run jetscii's own tests,
    which we do not run here).
  - A `[lints.rust] unexpected_cfgs` entry declares the `jetscii_sse4_2` cfg values
    that `build.rs` emits, silencing the modern-rustc `unexpected_cfgs` lint.

## License

jetscii is dual-licensed under **MIT OR Apache-2.0** (upstream choice). Both license
texts are included: [`LICENSE-MIT`](./LICENSE-MIT) and [`LICENSE-APACHE`](./LICENSE-APACHE).

## Maintenance

- This is a build-time-only workaround. To refresh it, download the current jetscii
  source, keep `Cargo.toml`'s `version = "0.4.4"` and the four `src/*.rs` + `build.rs`,
  and re-run `cargo test --manifest-path src-tauri/Cargo.toml`.
- If `docx` ever publishes a release that uses `strong-xml` ≥ 0.6.3 (which depends on
  `jetscii ^0.5`), delete this directory and the `[patch.crates-io]` entry in
  `src-tauri/Cargo.toml` and bump `docx` accordingly.
