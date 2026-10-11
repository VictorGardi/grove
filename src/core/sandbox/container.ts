import { execFile } from 'node:child_process'

// What grove calls its own containers. `container run --name <session.tmuxName>` is where the
// name comes from, and it is the only thing separating a session's VM from any other container
// on this machine — so the prefix is the whole boundary: grove deletes what it started and nothing
// else, however confident the name looks.
const GROVE = /^grove-/

// Takes a session's VM with it. `--rm` covers a clean agent exit, but SIGKILLing `container run`
// — which is what killing a tmux pane does — never fires it, so the container outlives the pane
// until this says otherwise.
//
// Resolves whatever the exit status. A container that cannot be removed must not fail the kill
// that came with it: the session is already gone either way, and `start` prunes whatever is left
// on the next launch.
export function removeContainer(container: string, name: string): Promise<void> {
  return new Promise((resolve) => {
    execFile(container, ['rm', '-f', name], () => resolve())
  })
}

// What a crash leaves behind: containers whose pane tmux still owns, and containers nobody owns.
// The live names come from `backend.list()` — the tmux sessions grove can see right now — and
// anything running or stopped that they do not account for is grove's to clean up.
//
// `--all`, because plain `container list` prints running containers only, and the most common
// orphan is a *stopped* one: its `container run` was killed and never got to remove it.
//
// Prunes nothing when the system is not running, and never rejects: `start` calls this before the
// window is up, and a machine without `container` is a machine without orphan containers.
export async function pruneContainers(container: string, live: Iterable<string>): Promise<void> {
  const names = await listNames(container)
  const running = new Set(live)
  await Promise.all(names.filter((n) => GROVE.test(n) && !running.has(n)).map((n) => removeContainer(container, n)))
}

// One name per line, or none at all if the binary is missing or the system is down.
function listNames(container: string): Promise<string[]> {
  return new Promise((resolve) => {
    execFile(container, ['list', '--all', '--quiet'], (err, stdout) => resolve(err ? [] : stdout.split('\n').map((l) => l.trim()).filter(Boolean)))
  })
}