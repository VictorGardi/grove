// What a failed command says, in one place, for both surfaces. The CLI had these and the renderer
// did not, so a refusal that read as a sentence in the terminal showed up in the launch dialog as a
// bare code — which is the opposite of useful at exactly the moment somebody is stuck.
//
// `errorMessage` returns the code itself for anything it does not know, so a new failure is never
// silently blank: the worst case is the same bare code as before.

export const ERROR_MESSAGES: Record<string, string> = {
  'not-found': 'no such session, or the folder is not a directory',
  'no-feature': 'no such feature in that project',
  'no-source': 'that agent is not available',
  ambiguous: 'more than one session matches',
  timeout: 'timed out waiting for the session',
  'no-status': 'a terminal session has no status to wait on',
  gone: 'the session has ended and cannot be resumed',
  'not-ready': 'the resumed session did not draw its prompt in time',
  'no-git': 'git was not found, so no worktree could be made',
  'worktree-failed': 'the worktree could not be created',

  // One entry per way a sandbox cannot be had, each naming the command that fixes *that* one. These
  // used to be a single message, which meant a missing bridge told you to install Docker. A refusal
  // is the only thing the human can act on, so it has to be specific.
  'no-sandbox-kind': 'a terminal session has no agent to put in a sandbox — sandboxing applies to Claude Code and OpenCode sessions',
  'no-sandbox-unconfigured': 'this build cannot find the sandbox image recipe, so it cannot sandbox anything',
  'no-sandbox-no-container': "Apple's `container` CLI is not installed or not on your PATH — install it, then run `container system start`",
  'no-sandbox-no-image': 'the sandbox image could not be built — run `container image ls` to see why, and check `resources/sandbox/Dockerfile`',
  'no-sandbox-no-bridge': 'no container bridge appeared — run `container system start` and try again; grove waits for it, and gave up',
  'no-sandbox-no-service': "no OpenCode service is running on this machine, so there is none for the sandbox to join — start one with `opencode`, then try again",
  // The "shell profile, not this terminal" clause is not decoration: grove probes by spawning
  // `$SHELL -l -i -c`, so an export typed into one terminal is invisible to it, and the app that owns
  // the session never sees the invoking shell's environment either. Naming the variable is the whole
  // mitigation — grove cannot tell a one-year `setup-token` from a short-lived one.
  'no-sandbox-no-credential':
    "run `claude setup-token` and put `export CLAUDE_CODE_OAUTH_TOKEN=…` in your shell profile (~/.zshrc): grove reads it from a login shell, so exporting it in one terminal will not do",
  // Kept as the last resort: an unlisted sandbox failure still says something better than a code.
  'no-sandbox': 'this machine cannot give a sandboxed session what it needs',
}

export const errorMessage = (code: string): string => ERROR_MESSAGES[code] ?? code