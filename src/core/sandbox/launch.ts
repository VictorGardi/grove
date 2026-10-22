import path from 'node:path'
import type { Session } from '@shared/types'
import { isSandboxKind, type AgentKind } from '../agents/types'
import { loginShellArgv } from '../env'
import { sandboxArgv } from './argv'
import { loginShellCredential } from './auth'
import { ensureImage, imageRef, sandboxAvailability } from './image'
import { ensureServiceReachable, serviceEndpoint } from './service'
import { specFor, type AgentPaths } from './spec'

// What a sandbox needs from this host, all of it from CoreOptions: the binary, the image recipe,
// the paths a pane mounts, and the way to find a repo's common dir.
export interface SandboxDeps {
  sandbox?: { container: string; dockerfile: string }
  sessionEnv?: { socketPath: string; binDir: string } & Partial<AgentPaths>
  gitCommonDir(cwd: string): string | null
}

// Why there is no sandbox, named. Every one of these used to collapse to a single `no-sandbox`,
// which meant a missing bridge told the human to install Docker. The refusal is the only thing
// the human can act on, so it says which thing it was — and `shared/sandboxErrors.ts` turns each
// into the command that fixes it.
//
// A kind with no agent argv to wrap (a terminal) never reaches here: core refuses it first, as
// `no-sandbox-kind`.
export type SandboxRefusal = 'kind' | 'unconfigured' | 'no-container' | 'no-image' | 'no-credential' | 'no-bridge' | 'no-service'

// What a resumed session lost when its sandbox could not be built. Deliberately not a diagnosis:
// a resume cannot refuse — it must hand the human their session back — so it says the consequence,
// which is the half it knows for certain. The *reason* is in the refusal, for the create path that
// can act on it.
export const LOST_SANDBOX = 'Its sandbox could not start, so it is running on your host with no filesystem isolation.'

// D6: what a sandboxed OpenCode needs that a sandboxed Claude does not — the host's shared service
// bound to an address the container can reach, that address named on the command line, and the
// service's password. Null means there is nothing to join, which is a refusal rather than a pane
// that cannot work.
async function reachHostService(paths: Partial<AgentPaths>, container: string): Promise<{ url: string; password: string } | null> {
  if (!paths.opencodeServiceConfig || !paths.opencodeRegistration) return null
  // Idempotent, and a no-op once the bind is there. Inside the caller's try, so a bridge that never
  // appears is a refusal on create and a downgraded resume — never an OpenCode that quietly starts
  // a service of its own and evicts the host's.
  const gateway = await ensureServiceReachable({ configFile: paths.opencodeServiceConfig, container })
  return serviceEndpoint({ registrationFile: paths.opencodeRegistration, gateway })
}

// `--server` precedes any subcommand, so it goes in immediately after the binary. Without it the
// client falls back to starting a service of its own: measured 2026-10-12, it read the host's
// registration, tried the host's loopback, then died with `EADDRNOTAVAIL` binding the bridge
// address grove wrote into the config. Told where the service is, it binds nothing.
const withServer = (agentArgv: string[], url: string): string[] => [agentArgv[0], '--server', url, ...agentArgv.slice(1)]

// The pane's argv for a sandboxed agent session, or the reason there is none. None of them may fall
// back to an unguarded pane (ADR 0036): creation refuses, and a resume downgrades and says so
// (ADR 0033). Called from both, so a resumed session cannot come back wider than it started.
export async function sandboxArgvFor(o: {
  kind: AgentKind
  session: Session
  cwd: string
  agentArgv: string[]
  deps: SandboxDeps
}): Promise<{ argv: string[] } | { refusal: SandboxRefusal }> {
  if (!isSandboxKind(o.kind)) return { refusal: 'kind' } // Copilot: never wrapped, whatever was asked
  const { sandbox, sessionEnv: paths, gitCommonDir: commonDir } = o.deps
  if (!paths || !sandbox) return { refusal: 'unconfigured' } // never configured to sandbox at all
  // Before anything expensive. The bridge retry is three and a half minutes, and a missing binary
  // should be named in milliseconds rather than after a build attempt and a wait for a bridge.
  const available = await sandboxAvailability(sandbox.container)
  if (!available.ok) return available
  let image: string
  try {
    image = imageRef(sandbox.dockerfile) // the image is content-addressed on the Dockerfile
    await ensureImage({ container: sandbox.container, dir: path.dirname(sandbox.dockerfile), tag: image })
  } catch {
    return { refusal: 'no-image' } // the recipe is broken, or the build failed
  }
  // D8: no credential reachable means a pane that stops at a login screen it cannot pass.
  // The probe runs the same login shell the pane is built on, and never throws. Re-probed on
  // every launch, because a resume can happen after the human logged out.
  const credential = await loginShellCredential(o.kind, {
    shell: process.env.SHELL || '/bin/zsh',
    claudeHome: paths.claudeHome,
  })
  if (!credential) return { refusal: 'no-credential' }
  let endpoint: { url: string; password: string } | null = null
  if (o.kind === 'opencode') {
    try {
      endpoint = await reachHostService(paths, sandbox.container)
    } catch {
      return { refusal: 'no-bridge' } // the budget ran out with no gateway to name
    }
    // D6: no host service registered means no port to compose a URL from, and nothing to join.
    if (!endpoint) return { refusal: 'no-service' }
  }
  try {
    const spec = specFor({
      kind: o.kind,
      cwd: o.cwd,
      commonDir: commonDir(o.cwd),
      paths,
      session: o.session,
      container: sandbox.container,
      image,
      credential,
      serverPassword: endpoint?.password,
    })
    return {
      argv: loginShellArgv(sandboxArgv({ name: o.session.tmuxName, spec, agentArgv: endpoint ? withServer(o.agentArgv, endpoint.url) : o.agentArgv }), {
        pathPrefix: paths.binDir,
      }),
    }
  } catch {
    return { refusal: 'unconfigured' } // an unresolvable path: nothing here can be blamed on the host
  }
}