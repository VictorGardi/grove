import { execFile } from 'node:child_process'

// A login shell probe is slow to start, so it is given a generous limit.
export const PROBE_TIMEOUT_MS = 5000

// Whether `command` is on the login shell's PATH. A probe that times out counts as found: the shell was
// slow, not missing the command, and refusing a create on a slow machine is worse than trying it. A probe
// that cannot run at all counts as missing.
export function commandOnPath(command: string, shell: string, timeoutMs = PROBE_TIMEOUT_MS): Promise<boolean> {
  return new Promise((resolve) => {
    execFile(shell, ['-l', '-i', '-c', `command -v ${command}`], { timeout: timeoutMs }, (err, stdout) =>
      resolve(err ? (err as { killed?: boolean }).killed === true : stdout.trim() !== '')
    )
  })
}
