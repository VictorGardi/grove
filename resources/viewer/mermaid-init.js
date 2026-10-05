// Replaces the page's inline Mermaid init, which the artifact CSP blocks.
mermaid.initialize({ startOnLoad: true, theme: matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'default' })
