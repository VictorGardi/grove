# 0007. Artifacts served through a custom protocol with a header CSP

Date: 2026-10-05

## Status

Accepted

## Context

Artifacts are agent-written HTML (from `grove-render`, which loads Mermaid from
jsdelivr) or markdown. The app renderer has a privileged bridge to PTYs and the
file system, and the app is local-only. `file://` is ruled out by Electron's
security guidance and the `grantFileProtocolExtraPrivileges` fuse. A future
comment layer needs an injection point inside the rendered artifact.

## Decision

Artifacts are served via a privileged `grove-artifact://` scheme (`standard`,
`secure`) as `grove-artifact://<project-id>/<feature>/<file>`. The handler
serves only files inside discovered feature folders (traversal-checked), sets a
header CSP with `sandbox allow-scripts` and `script-src` limited to app-bundled
assets, rewrites the Mermaid CDN script to a bundled copy, and renders markdown
(markdown-it + bundled Mermaid) in main through the same path. The iframe uses
`sandbox="allow-scripts"` without same-origin. The handler may inject one app
script that talks to the app only via `postMessage`.

## Consequences

- The app's own CSP stays strict and independent of artifact needs; artifacts
  make no network calls; relative links and images resolve.
- One protocol handler with a path allowlist to maintain; Mermaid version is
  pinned by the app, not the artifact.
- Rejected: `srcdoc` (inherits and loosens the app CSP, breaks relative URLs);
  `WebContentsView` (manual bounds/focus syncing outside the React layout).
