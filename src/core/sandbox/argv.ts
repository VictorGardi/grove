import type { SandboxSpec } from './spec'

// The pane's leaf command: the agent, inside its own Apple `container` VM (ADR 0034). Nothing
// wraps it but this array — `AgentSource` still produces the agent's argv unchanged and the tmux
// backend still runs whatever it is handed (D4). Flat, because `exec` in a login shell joins it.
export function sandboxArgv(o: { name: string; spec: SandboxSpec; agentArgv: string[] }): string[] {
  const s = o.spec
  return [
    s.container,
    'run',
    '--rm', // a clean agent exit takes the VM with it
    '-i',
    '-t', // the pane is the VM's tty; together these need a real controlling tty, which a pane has
    '--name',
    o.name, // so `container list` names the session
    '--workdir',
    s.cwd,
    ...s.mounts.flatMap((m) => ['--volume', m]),
    ...s.readOnlyPaths.flatMap((p) => ['--read-only-path', p]),
    ...Object.entries(s.env).flatMap(([k, v]) => ['-e', `${k}=${v}`]),
    // The CLI bundle is mounted rather than baked, so its per-install path cannot be either (D7).
    ...(s.cliBundle ? ['-e', `GROVE_CLI_BUNDLE=${s.cliBundle}`] : []),
    s.image,
    ...o.agentArgv,
  ]
}