// What a failed command says, in one place, for both surfaces. The CLI had these and the renderer
// did not, so a refusal that read as a sentence in the terminal showed up in the launch dialog as a
// bare code — which is the opposite of useful at exactly the moment somebody is stuck.
//
// `errorMessage` returns the code itself for anything it does not know, so a new failure is never
// silently blank: the worst case is the same bare code as before.

export const ERROR_MESSAGES: Record<string, string> = {
  'not-found': 'no such session, or the folder is not a directory',
  'no-feature': 'no such feature in that project',
  'no-parent': 'no such session to use as parent',
  'is-parent': 'that session has children of its own, so it cannot become a child',
  'same-session': 'a session cannot be its own parent',
  'no-source': 'that agent is not available',
  'no-copilot': 'GitHub Copilot CLI (`copilot`) was not found on your PATH — install it (`brew install --cask copilot-cli`), run `copilot login`, then try again',
  ambiguous: 'more than one session matches',
  timeout: 'timed out waiting for the session',
  'no-status': 'a terminal session has no status to wait on',
  gone: 'the session has ended and cannot be resumed',
  'not-ready': 'the resumed session did not draw its prompt in time',
  'no-git': 'git was not found, so no worktree could be made',
  'worktree-failed': 'the worktree could not be created',
}

export const errorMessage = (code: string): string => ERROR_MESSAGES[code] ?? code