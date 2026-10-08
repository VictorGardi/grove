# 0011. Main pushes whole state slices to the renderer

Date: 2026-10-05

## Status

Accepted

## Context

The renderer shows state that main owns as the only writer (ADR 0009): projects
and sessions now, and later features, live status, links and comment drafts. The
transport is fixed (`invoke` → `{ok,data}`, `webContents.send` pushes). What we needed
to decide was the shape of the state that flows over it, a pattern every later domain
copies.

## Decision

Core holds each domain slice in memory and emits the whole slice whenever it changes.
Main coalesces this to one `state:<slice>` push per tick. The renderer loads every slice
once with `state:get` into zustand stores and replaces a store wholesale on each push.
Mutations are `invoke` commands; their effect arrives through the next push. Terminal
bytes do not use this path.

## Consequences

- One code path per slice, no event ordering or missed-event bugs; a reload is just
  `state:get`. Core tests assert on slices.
- Every change resends a full slice. This is fine at hundreds of items. A slice that grows
  large can switch to patches behind the same store API.
- Rejected: fine-grained add/update/remove events with renderer reducers (bookkeeping
  per domain, snapshot/event races); pull + invalidate (two round trips, a cache layer).
