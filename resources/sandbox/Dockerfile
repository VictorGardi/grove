# The sandbox image (ADR 0034): everything a session's agent can see and run against,
# and nothing of this Mac. Content-addressed by grove on this file alone, so nothing that
# differs per install may go in here — least of all the CLI bundle, which is mounted read-only
# at run time instead (D7, ADR 0039), or every grove upgrade would rebuild the image.
FROM node:22-slim

# git, ripgrep and jq are the tools an agent reaches for, and the hooks grove itself runs
# need (`jq`, ADR 0032). The empty directory is what `core.hooksPath` points at inside the
# sandbox, so a hook written on the host can never run as uid=0 in here.
RUN apt-get update \
 && apt-get install -y --no-install-recommends git ripgrep jq ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && mkdir -p /etc/grove/no-hooks

# Pinned independently of the host's version, on purpose. Minor skew is tolerated on the
# `--server` path — it warns and proceeds — while this file's bytes are what the image is
# content-addressed on, so a host-pinned version would rebuild the image on every host upgrade.
# `opencode-ai@2.x` does not exist: the package was renamed and rescoped, and the 2.x tarball is a
# self-contained Bun binary needing glibc only, so it costs no new apt package.
RUN npm install -g @anthropic-ai/claude-code@2.1.296 @opencode/cli@2.0.26

# grove's own CLI, for a sandboxed agent to orchestrate with. The bundle's path differs per
# install, so it cannot be baked in either: grove passes it in, on the mount it made.
RUN printf '#!/bin/sh\nGROVE_CLI_BUNDLE=${GROVE_CLI_BUNDLE:?grove: GROVE_CLI_BUNDLE is not set}\nexec node "$GROVE_CLI_BUNDLE" "$@"\n' > /usr/local/bin/grove \
 && chmod +x /usr/local/bin/grove