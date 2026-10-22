import path from 'node:path'
import type { Session } from '@shared/types'
import { opencodeCliConfig, opencodeModelEnv } from '@shared/opencodeSession'
import { isSandboxKind, type AgentKind } from '../agents/types'

// Every host path a sandboxed session's container binds, each at the identical path inside
// (ADR 0035): diff, discovery, autolink and the viewer all resolve `project.path` on the host,
// so a remapped path would break all four. Resolved once, in `src/main/index.ts`.
export interface AgentPaths {
  claudeHome: string
  claudeJson: string
  opencodeShare: string
  opencodeConfig: string
  opencodeState: string
  opencodeRegistration: string // the service's own registration — where it says it can be reached, and the password it wants (D6)
  opencodeServiceConfig: string // the service's config — where grove writes the address to bind (D6)
  gitconfig: string
  spoolDir: string
  socketPath: string
  cliBundle: string
}

// What grove actually mounts with: everything optional but the socket, since a pane that cannot
// reach the app has no CLI at all. A path main did not resolve is simply left unmounted —
// `container` tolerates an absent `--read-only-path` target, and a `--volume` of a path that is
// not there would create it.
export type MountPaths = Partial<AgentPaths> & { socketPath: string }

// What `core.hooksPath` points at inside the image: an empty directory baked into it. Set at
// git's command-line scope it beats both `~/.gitconfig` and `.git/config` for every git call in
// the pane, so a host hook can never run as uid=0 inside. A repo that uses `core.hooksPath` of
// its own loses those hooks — the same class of divergence as shipping no rc files.
const NO_HOOKS = '/etc/grove/no-hooks'

export interface SandboxSpec {
  container: string // the `container` binary
  image: string // grove-sandbox:<sha256 of the Dockerfile>
  cwd: string // the session's working directory, host-identical
  mounts: string[] // `<host>:<host>`, read-write
  readOnlyPaths: string[]
  env: Record<string, string>
  passEnv?: string[] // variables forwarded bare (D8): `container run -e VAR` with no `=value` takes the value from the calling process, so it never enters argv or ps
  credential?: string // a human label of the credential this session authenticates with (D8); absent: nothing was reachable
  cliBundle?: string // where the CLI bundle is mounted (D7); absent: no `grove` in the sandbox
}

// The whole host the sandbox sees, as read-write binds. `commonDir` arrives already resolved:
// non-null only when it needs a volume of its own (D2).
// Copilot has no sandbox (v1): a helper asked for one throws, so the OpenCode branch is never taken for it.
function assertSandboxKind(kind: AgentKind): void {
  if (!isSandboxKind(kind)) throw new Error(`no sandbox for ${kind}`)
}

export function mountsFor(kind: AgentKind, o: { cwd: string; commonDir: string | null; paths: MountPaths }): string[] {
  assertSandboxKind(kind)
  const p = o.paths
  const bind = (host: string | undefined) => (host ? [`${host}:${host}`] : [])
  return [
    `${o.cwd}:${o.cwd}`,
    ...(o.commonDir ? [`${o.commonDir}:${o.commonDir}`] : []),
    ...(kind === 'claude'
      ? [...bind(p.claudeHome), ...bind(p.claudeJson)]
      : [...bind(p.opencodeShare), ...bind(p.opencodeConfig)]),
    ...bind(p.spoolDir), // hooks append to it from inside, so it cannot be read-only
    ...bind(p.socketPath),
    ...bind(p.cliBundle),
  ]
}

// Everything carved out of the read-write binds. Read-only is the default for everything the
// agent must not change: an agent that could write the gitconfig could set `core.hooksPath` for
// every unsandboxed git run on this host afterwards, and one that could write a worktree's hooks
// or config could make the host run something on its next checkout.
export function readOnlyPathsFor(kind: AgentKind, o: { commonDir: string | null; paths: MountPaths }): string[] {
  assertSandboxKind(kind)
  const p = o.paths
  const carve = (dir: string | undefined, ...files: string[]) => (dir ? files.map((f) => path.join(dir, f)) : [])
  return [
    ...(o.commonDir ? [path.join(o.commonDir, 'hooks'), path.join(o.commonDir, 'config')] : []),
    // D8: the files that carry authority rather than state. A writable `settings.json` is a hook
    // that runs in every later *unsandboxed* session; a writable `.credentials.json` or `auth.json`
    // is a login the agent can rewrite. Readable — the human's own authority — never writable.
    ...(kind === 'claude' ? carve(p.claudeHome, 'settings.json', '.credentials.json') : carve(p.opencodeShare, 'auth.json')),
    ...(p.gitconfig ? [p.gitconfig] : []),
    ...(kind === 'opencode' && p.opencodeState ? [p.opencodeState] : []), // D6: never evict the host's service
    ...(p.cliBundle ? [p.cliBundle] : []),
  ]
}

// The pane's env *inside* the VM. The host login shell still runs outside it (ADR 0010), so
// this is the agent's whole environment: the image's, plus these.
export function envFor(
  kind: AgentKind,
  session: Session,
  o: { paths: MountPaths; serverPassword?: string },
): { env: Record<string, string>; passEnv: string[] } {
  assertSandboxKind(kind)
  const p = o.paths
  const env: Record<string, string> = {
    GROVE_SESSION_ID: session.id,
    GROVE_SOCKET: p.socketPath,
    TERM: 'xterm-256color', // not the pane's own TERM: the image knows nothing of tmux's
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: 'core.hooksPath',
    GIT_CONFIG_VALUE_0: NO_HOOKS,
  }
  // D8: the container runs uid=0 with HOME=/root, so both agents resolve `~` to /root while grove
  // mounts the host's config under /Users/victor/... Those volumes have been there all along and
  // were never read — measured. One pointer each, at the paths already mounted, through each
  // agent's own documented mechanism: no new mount, and ADR 0035's same-path invariant untouched.
  if (kind === 'claude') {
    if (p.claudeHome) env.CLAUDE_CONFIG_DIR = p.claudeHome
  } else {
    if (p.opencodeShare) env.XDG_DATA_HOME = path.dirname(p.opencodeShare)
    if (p.opencodeConfig) env.XDG_CONFIG_HOME = path.dirname(p.opencodeConfig)
    // D6: the third pointer, and the one that decides whether this session joins the host's service
    // or starts its own. The registration lives at `$XDG_STATE_HOME/opencode/service.json` and the
    // state dir is mounted read-only; without the pointer the client looks in `/root/.local/state`,
    // finds nothing, registers its own service — and a second registration evicts the host's, taking
    // down status, waiting and linking for every OpenCode session on this machine.
    if (p.opencodeState) env.XDG_STATE_HOME = path.dirname(p.opencodeState)
    // grove's own session chrome — tabs off, one theme — for every OpenCode session it starts.
    // The pane's environment carries it via `cliEnv`, but `container run` forwards only what is
    // explicitly passed, so without this a sandboxed session falls back to the user's
    // `opencode.json` and comes up looking like a different application. Measured 2026-10-12.
    env.OPENCODE_CLI_CONFIG_CONTENT = opencodeCliConfig()
    // The model from `grove new opencode --model`, through OpenCode's inline config; same helper as the host path.
    Object.assign(env, opencodeModelEnv(session.launchModel, process.env.OPENCODE_CONFIG_CONTENT))
    // The address comes from the registration the client reads; the credential does not, so grove
    // hands it over. Without it the service answers 401.
    if (o.serverPassword) env.OPENCODE_SERVER_PASSWORD = o.serverPassword
  }
  // Forwarded bare, so the value comes from the pane's login shell and never enters argv or ps.
  // OpenCode needs no channel of its own (D8), so it forwards nothing.
  return { env, passEnv: kind === 'claude' ? ['CLAUDE_CODE_OAUTH_TOKEN', 'ANTHROPIC_API_KEY'] : [] }
}

export function specFor(o: {
  kind: AgentKind
  cwd: string
  commonDir: string | null // `gitCommonDir(cwd)`, or null: not a repo
  paths: MountPaths
  session: Session
  container: string
  image: string
  credential?: string // D8: a label of the credential this session authenticates with; absent: nothing reachable
  serverPassword?: string // D6: the host service's password, for a sandboxed opencode to join it
}): SandboxSpec {
  // A plain checkout's common dir is `.git`, *below* the working directory, so the working
  // directory's volume already carries it and it needs no carve-outs. A worktree's points at
  // another repository entirely, and a session started in a subfolder's points at its parent —
  // both outside the mount, without which git cannot resolve them at all (D2).
  const commonDir = o.commonDir && !o.commonDir.startsWith(o.cwd + path.sep) ? o.commonDir : null
  const { env, passEnv } = envFor(o.kind, o.session, { paths: o.paths, serverPassword: o.serverPassword })
  return {
    container: o.container,
    image: o.image,
    cwd: o.cwd,
    mounts: mountsFor(o.kind, { cwd: o.cwd, commonDir, paths: o.paths }),
    readOnlyPaths: readOnlyPathsFor(o.kind, { commonDir, paths: o.paths }),
    env,
    passEnv,
    ...(o.credential && { credential: o.credential }),
    ...(o.paths.cliBundle && { cliBundle: o.paths.cliBundle }),
  }
}