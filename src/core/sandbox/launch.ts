import path from 'node:path'
import type { Session } from '@shared/types'
import type { AgentKind } from '../agents/types'
import { loginShellArgv } from '../env'
import { sandboxArgv } from './argv'
import { loginShellCredential } from './auth'
import { ensureImage, imageRef } from './image'
import { specFor, type AgentPaths } from './spec'

// What a sandbox needs from the host, all of it from CoreOptions: the binary, the image recipe,
// the paths a pane mounts, and the way to find a repo's common dir.
export interface SandboxDeps {
  sandbox?: { container: string; dockerfile: string }
  sessionEnv?: { socketPath: string; binDir: string } & Partial<AgentPaths>
  gitCommonDir(cwd: string): string | null
}

// What a resumed session lost when its sandbox could not be built. Fixed, and deliberately not a
// diagnosis: `sandboxArgvFor` collapses every failure to `null` because none of them may fall back
// to an unguarded pane, so core does not know which one it was and must not guess at one. What it
// does know is the consequence, and that is what the human has to be told.
export const LOST_SANDBOX = 'Its sandbox could not start, so it is running on your host with no filesystem isolation.'

// The pane's argv for a sandboxed agent session, or null when this host cannot build one.
// Every reason collapses to null because none of them may fall back to an unguarded pane
// (ADR 0036): creation refuses with `no-sandbox`, and a resume downgrades and says so
// (ADR 0033). Called from both, so a resumed session cannot come back wider than it started.
export async function sandboxArgvFor(o: {
  kind: AgentKind
  session: Session
  cwd: string
  agentArgv: string[]
  deps: SandboxDeps
}): Promise<string[] | null> {
  const { sandbox, sessionEnv: paths, gitCommonDir: commonDir } = o.deps
  if (!paths || !sandbox) return null // never configured to sandbox at all
  try {
    const image = imageRef(sandbox.dockerfile) // the image is content-addressed on the Dockerfile
    await ensureImage({ container: sandbox.container, dir: path.dirname(sandbox.dockerfile), tag: image })
    // D8: no credential reachable means a pane that stops at a login screen it cannot pass.
    // The probe runs the same login shell the pane is built on, and never throws. Re-probed on
    // every launch, because a resume can happen after the human logged out.
    const credential = await loginShellCredential(o.kind, {
      shell: process.env.SHELL || '/bin/zsh',
      claudeHome: paths.claudeHome,
    })
    if (!credential) return null
    const spec = specFor({
      kind: o.kind,
      cwd: o.cwd,
      commonDir: commonDir(o.cwd),
      paths,
      session: o.session,
      container: sandbox.container,
      image,
      credential,
    })
    return loginShellArgv(sandboxArgv({ name: o.session.tmuxName, spec, agentArgv: o.agentArgv }), { pathPrefix: paths.binDir })
  } catch {
    return null // no binary, no system, no build, no Dockerfile
  }
}