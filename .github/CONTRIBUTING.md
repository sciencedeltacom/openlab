# Contributing

Thanks for helping. openlab is a research workbench, so changes should keep the work
reproducible and the interface quiet.

## Set up

```bash
bun install
bun run tauri dev
```

You need Bun, Rust 1.90 or newer, the platform webview, and libsodium with pkg-config. See
the README for details.

## Before a pull request

```bash
bun run typecheck
bun run verify:web
cargo test --manifest-path src-tauri/Cargo.toml --lib
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
```

Keep the change focused. Match the surrounding code, comments included. Do not add a
dependency for something the standard library or an installed package already does.

## Pull requests

- One subject per pull request.
- Say what changes, why, and how you checked it.
- Include a screenshot for a visible interface change.
- Do not include secrets, tokens or personal paths.
- Report security problems through [SECURITY.md](./SECURITY.md), not in an issue or a pull
  request.

## Skills

Some procedures are adapted from the Scientific Agent Skills collection by K-Dense Inc.
(MIT). If you add or change one, say where it came from and keep its licence terms.
