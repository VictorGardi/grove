// grove's own chrome for an OpenCode session: the tabs it does not want, and the theme its own UI
// is drawn against. This merges **over** the user's global `cli.json`, so their plugins, models and
// providers still apply — only the chrome grove owns is pinned.
//
// `cliEnv` puts it on the pane. Takes options rather than carrying a fixed body so a future
// difference between callers is an argument instead of a second copy. The defaults are grove's
// choice; a caller that passes nothing and a caller that passes these defaults get the same string.
export interface OpencodeChrome {
  tabsMode?: 'off' | 'on'
  theme?: { name: string; mode: 'light' | 'dark' }
}

export function opencodeCliConfig(o: OpencodeChrome = {}): string {
  return JSON.stringify({
    tabs: { mode: o.tabsMode ?? 'off' },
    theme: { name: o.theme?.name ?? 'tokyonight', mode: o.theme?.mode ?? 'dark' },
  })
}

// The model a session was launched with (`grove new opencode --model`), as OpenCode's inline config:
// `OPENCODE_CONFIG_CONTENT` is merged over the user's own config, so only `model` is pinned.
// `cliEnv` uses this. When the environment already carries an inline config, its other keys are
// kept and grove wins for `model`; a value that is not a JSON object is replaced.
export function opencodeModelEnv(model: string | undefined, existing?: string): Record<string, string> {
  if (!model) return {}
  let base: Record<string, unknown> = {}
  if (existing) {
    try {
      const parsed: unknown = JSON.parse(existing)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) base = parsed as Record<string, unknown>
    } catch {}
  }
  return { OPENCODE_CONFIG_CONTENT: JSON.stringify({ ...base, model }) }
}
