# 0036. Sandbox isolation is filesystem-only; egress policy is deferred

Date: 2026-10-09

## Status

Proposed

## Context

The questions phase answered the network question with a product lean: use the
allow-list Docker Sandboxes ships by default, "since this must have been solved
before."

That answer was about which *behaviour* to adopt, not about what Apple's
`container` can enforce. Its networking surface is thin and thinly documented —
there is no per-host policy. The realistic ways to get an allow-list are to run a
second, always-on host proxy and route the container's egress through it, or to
write and maintain firewall rules.

An allow-list proxy is a new long-lived process, a new thing that can fail, and
a new surface to secure — against a jail whose actual blast radius is already
bounded by its mount set (ADR 0035). That is a disproportionate amount of new
machinery for this round, and it is separable: the mount set is the property
that does the confining.

## Decision

- **This round:** a sandboxed session runs with Apple's default container
  networking. No egress restriction is attempted.
- **Deferred:** an `sbx`-style allow-list, as its own feature, once the
  filesystem jail has proven itself in use.
- **Named honestly:** the UI tag on a sandboxed session says it isolates the
  filesystem, not the network, so "sandboxed" is never read as more than it is.

## Consequences

- What "sandboxed" means is the thing the ticket asked for: the agent can roam
  its working directory and cannot damage the rest of the host. It does not mean
  the agent cannot reach the internet.
- The exposure is bounded — a sandboxed session can only exfiltrate what it can
  read, which is its working directory and its own agent config directory.
- Adding the allow-list later does not change the mount set or the argv shape;
  it adds a proxy process and env. It is additive, not a redesign.
- Rejected: `--network none` (the agent cannot reach its own API host, so the
  session simply does not work); writing pf rules per session (privileges,
  lifecycle, and rules that outlive the session if cleanup fails); shipping the
  proxy now (a second daemon and a second failure mode for a jail whose
  boundary is already set).
- The deferred allow-list is its own feature, not an open question about this
  one: nothing about this decision blocks starting it later.