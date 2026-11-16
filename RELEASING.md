# Releasing openlab

A release is a tagged build of `apps/openlab` produced by `.github/workflows/release.yml`.
The workflow builds macOS (Apple silicon and Intel), Windows and Linux, then leaves a draft
release with the installers, their signatures and `latest.json` for the updater.

Two things are not in git and must exist before a build can ship: the embedded resources and
the signing identities.

## Embedded resources

`tauri.conf.json` bundles `src-tauri/resources/worker`, `mojo` and `bin`. Only `worker` is
tracked. `bin` (the embedding server and its libraries) and `mojo` (compiled shared objects)
are platform binaries, so they are built per target and published as release assets.

Build the archive on each target machine:

```bash
OPENLAB_LLAMA_URL=https://.../llama-<target>.tar.gz \
OPENLAB_LLAMA_SHA256=<sha256> \
bun run resources:build
```

The script compiles the Mojo hot path when Mojo is installed, fetches and verifies the
llama.cpp archive, refuses a binary that does not run, and writes
`resources-<platform>-<arch>.tar.gz` plus its `.sha256`.

The four archives the workflow expects are:

| Target | Archive |
| --- | --- |
| `aarch64-apple-darwin` | `resources-darwin-arm64.tar.gz` |
| `x86_64-apple-darwin` | `resources-darwin-x64.tar.gz` |
| `x86_64-pc-windows-msvc` | `resources-win32-x64.tar.gz` |
| `x86_64-unknown-linux-gnu` | `resources-linux-x64.tar.gz` |

Upload them and their `.sha256` files to a release, for example one tagged `resources`, then
set the repository variable `OPENLAB_RESOURCES_BASE` to the download base:

```
https://github.com/sciencedeltacom/openlab/releases/download/resources
```

No resource URLs or digests are stored as secrets. The workflow reads the variable and the
`.sha256` file beside each archive, so a fork can point at its own resources without a code
change.

## Signing

| Secret | Used for |
| --- | --- |
| `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD` | Developer ID Application certificate (base64 `.p12`) |
| `APPLE_SIGNING_IDENTITY` | e.g. `Developer ID Application: ScienceDelta (TEAMID)` |
| `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID` | notarization |
| `WINDOWS_CERTIFICATE`, `WINDOWS_CERTIFICATE_PASSWORD` | Authenticode certificate (base64 `.pfx`) |
| `TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | updater artifacts |

An unsigned macOS bundle is refused by Gatekeeper. An unsigned Windows installer trips
SmartScreen. Set the identities before publishing a stable release.

## Updater

The app checks
`https://github.com/sciencedeltacom/openlab/releases/latest/download/latest.json`
in production builds, verifies the signature against the public key in
`plugins.updater.pubkey`, and asks before installing.

The keypair is generated once and kept out of git:

```bash
bunx tauri signer generate -w ~/.tauri/openlab-updater.key
```

Put the public key in `src-tauri/tauri.conf.json`, and the private key and its password in
the two `TAURI_SIGNING_*` secrets. Losing the private key means installed copies can never
update again.

## Cutting a release

1. Set the same version in `package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`,
   `src-tauri/Cargo.lock` and `cli/package.json`.
2. Run `bun run verify:web` and `cargo test --manifest-path src-tauri/Cargo.toml --lib`.
3. Commit, tag `v<version>` and push the tag.
4. The release workflow builds every target and opens a draft release. Check the assets,
   then publish it. A draft release has no `latest` asset until it is published, so the
   updater cannot see it before that moment.
5. To rebuild a tag by hand, run the workflow with its `tag` input.

The preview workflow is separate: it produces an unsigned Windows installer without the
embedded resources, for trying the app before a release exists.
