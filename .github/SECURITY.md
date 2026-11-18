# Security policy

## Supported versions

The latest 0.1.x release receives security fixes. Older builds should be upgraded.

## Advisories we accept

Two open Dependabot advisories cannot be fixed from this repository yet. Neither is reachable
in the app, and both are dismissed with this note.

| Advisory | Package | Why it is accepted |
| --- | --- | --- |
| GHSA-wrw7-89jp-8q8g | `glib` 0.18.5 | Unsoundness in `VariantStrIter`, which openlab never calls. It arrives on Linux through `tao 0.37` into `gtk 0.18`; the fix needs gtk-rs 0.20, which tao and wry have not adopted. |
| GHSA-rhfx-m35p-ff5j | `lru` 0.12.5 | A `Stacked Borrows` violation in `IterMut`, in a cache openlab never calls. It arrives through `lancedb` into `tantivy`; the fix needs a tantivy built on `lru 0.16`, which a later lancedb carries. |

When either upstream moves, the upgrade lands with it.

## Reporting a vulnerability

Please use GitHub's private vulnerability reporting: open the **Security** tab of this
repository and choose **Report a vulnerability**. Do not open a public issue for a security
problem.

Include the version and platform, a reproduction, and the impact you expect. We aim to
acknowledge a report within three working days and to ship a fix or a mitigation within 30
days for a confirmed issue.

## Scope

In scope: the desktop app, the CLI, the Rust shell under `src-tauri`, and the release
pipeline. Out of scope: third-party model providers, research databases and services the app
connects to, and vulnerabilities that require a compromised machine or a modified build.

## Safe harbour

We will not pursue legal action for research that follows this policy, stays within your own
accounts and data, and avoids privacy violations and service disruption.
