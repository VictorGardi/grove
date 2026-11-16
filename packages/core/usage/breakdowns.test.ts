import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { UsageAgent } from '../../protocol/messages.ts'
import { GitError, type GitRun } from '../gitrun.ts'
import type { UsageRequest } from './history.ts'
import type { UsageReader } from './reader.ts'
import { desktopScratch, type RepositoryPlaces } from './repositories.ts'
import { UsageService } from './service.ts'

// The usage panel's breakdowns, from the requests the readers found to the summary: helper share and model split per day, the weekday by
// hour of work in local time, and where it went by repository.

const at = (day: number, hour = 10, minute = 0) => new Date(2026, 10, day, hour, minute).getTime()
// 2026-11-16, a Monday, local noon.
const NOW = new Date(2026, 10, 16, 12).getTime()

let seq = 0
const request = (over: Partial<UsageRequest> & { at: number }): UsageRequest => ({
  key: `r${seq++}`,
  agent: 'claude',
  source: 'claude',
  model: 'claude-opus',
  folder: '/work/app',
  input: 1,
  output: 2,
  cacheRead: 3,
  cacheWrite: 4,
  helper: false,
  nanoAiu: null,
  inGrove: null,
  ...over,
})

// A reader that hands over what it was given in one step.
function readerOf(agent: UsageAgent, requests: UsageRequest[]): UsageReader {
  let given = false
  return {
    agent,
    step: async () => {
      const out = given ? [] : requests
      given = true
      return { requests: out, done: true }
    },
  }
}

describe('usage breakdowns, from requests to the summary', () => {
  let dir: string
  let service: UsageService | undefined
  let now = NOW
  const zone = process.env.TZ

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'grove-usage-'))
    fs.mkdirSync(path.join(dir, 'home'))
    now = NOW
    seq = 0
  })

  afterEach(() => {
    service?.close()
    service = undefined
    if (zone === undefined) delete process.env.TZ
    else process.env.TZ = zone
    vi.restoreAllMocks()
    fs.rmSync(dir, { recursive: true, force: true })
  })

  const make = (requests: UsageRequest[], options: { spaces?: string[]; git?: GitRun; places?: RepositoryPlaces } = {}): UsageService => {
    const agents = [...new Set(requests.map((r) => r.agent))]
    return (service = new UsageService({
      home: path.join(dir, 'home'),
      readers: agents.map((agent) =>
        readerOf(
          agent,
          requests.filter((r) => r.agent === agent),
        ),
      ),
      clock: () => now,
      notifyMs: 10,
      spaces: () => options.spaces ?? [],
      git: options.git,
      places: options.places,
    }))
  }

  // The summary once git has been asked about every folder.
  const placed = async (s: UsageService, days = 30, range?: number) => {
    await s.drain()
    s.summary(days, range)
    await s.settled()
    return s.summary(days, range)
  }
  const of = (summary: ReturnType<UsageService['summary']>, agent: UsageAgent) => summary.agents.find((a) => a.agent === agent)!

  describe('per day', () => {
    it('shows the helper agents’ requests of a day, and the model split with requests and tokens per model', async () => {
      const s = make([
        request({ at: at(15), model: 'opus' }),
        request({ at: at(15), model: 'opus', helper: true, input: 10 }),
        request({ at: at(15), model: 'sonnet', helper: true }),
        request({ at: at(14), model: 'sonnet' }),
      ])
      const claude = of(await placed(s), 'claude')
      const day = claude.days.find((d) => d.day === '2026-11-15')!
      expect(day.requests).toBe(3)
      expect(day.helperRequests).toBe(2)
      expect(day.models).toMatchObject([
        { model: 'opus', requests: 2, input: 11, output: 4, cacheRead: 6, cacheWrite: 8 },
        { model: 'sonnet', requests: 1, input: 1, output: 2 },
      ])
      expect(claude.days.find((d) => d.day === '2026-11-14')).toMatchObject({ requests: 1, helperRequests: 0 })
    })

    it('carries credits, and the requests without a credit figure, through the model split', async () => {
      const copilot = (over: Partial<UsageRequest>) => request({ agent: 'copilot', source: 'copilot', at: at(15), ...over })
      const s = make([copilot({ model: 'gpt', nanoAiu: 2_500_000_000 }), copilot({ model: 'gpt', nanoAiu: 500_000_000 }), copilot({ model: 'gpt', nanoAiu: null }), copilot({ model: 'other', nanoAiu: 1_000_000_000 })])
      const day = of(await placed(s), 'copilot').days[0]
      expect(day.models).toMatchObject([
        { model: 'gpt', requests: 3, credits: 3, withoutCredits: 1 },
        { model: 'other', requests: 1, credits: 1, withoutCredits: 0 },
      ])
    })

    it('counts no request as without credits for Claude', async () => {
      const day = of(await placed(make([request({ at: at(15) })])), 'claude').days[0]
      expect(day.models[0]).toMatchObject({ credits: 0, withoutCredits: 0 })
    })
  })

  describe('when you work', () => {
    it('counts requests by weekday and hour, Monday first', async () => {
      // 2026-11-16 is a Monday, 2026-11-15 a Sunday.
      const s = make([request({ at: at(16, 9, 5) }), request({ at: at(16, 9, 55) }), request({ at: at(16, 11) }), request({ at: at(15, 23, 59) }), request({ at: at(14, 0, 0) })])
      const { hours } = of(await placed(s), 'claude')
      expect(hours).toHaveLength(168)
      expect(hours[0 * 24 + 9]).toBe(2)
      expect(hours[0 * 24 + 11]).toBe(1)
      expect(hours[6 * 24 + 23]).toBe(1)
      expect(hours[5 * 24 + 0]).toBe(1)
      expect(hours.reduce((a, b) => a + b, 0)).toBe(5)
    })

    it('uses the user’s local time, also for requests either side of midnight', async () => {
      process.env.TZ = 'Asia/Tokyo'
      now = Date.parse('2026-11-16T03:00:00Z') // noon on Monday the 16th in Tokyo
      // 23:30 Sunday and 00:10 Monday in Tokyo, 40 minutes apart.
      const s = make([request({ at: Date.parse('2026-11-15T14:30:00Z') }), request({ at: Date.parse('2026-11-15T15:10:00Z') })])
      const claude = of(await placed(s), 'claude')
      expect(claude.hours[6 * 24 + 23]).toBe(1)
      expect(claude.hours[0 * 24 + 0]).toBe(1)
      expect(claude.days.map((d) => [d.day, d.requests])).toEqual([
        ['2026-11-15', 1],
        ['2026-11-16', 1],
      ])
    })

    it('covers the range asked for, not the days of detail', async () => {
      const s = make([request({ at: at(16, 9) }), request({ at: at(1, 9) })])
      const total = (claude: { hours: number[] }) => claude.hours.reduce((a, b) => a + b, 0)
      expect(total(of(await placed(s, 30, 7), 'claude'))).toBe(1)
      expect(total(of(await placed(s, 30, 30), 'claude'))).toBe(2)
      // The days of detail still reach back as far as they were asked to.
      expect(of(await placed(s, 30, 7), 'claude').days).toHaveLength(2)
    })
  })

  describe('where it went', () => {
    const places = (): RepositoryPlaces => ({ home: path.join(dir, 'home'), worktreesRoot: path.join(dir, 'worktrees'), scratch: [path.join(dir, 'scratch')] })
    const folder = (...parts: string[]): string => {
      const full = path.join(dir, ...parts)
      fs.mkdirSync(full, { recursive: true })
      return full
    }
    // A fake git: the folders it knows are checkouts of a main one.
    const gitOf =
      (repos: Record<string, string>): GitRun =>
      async (args, cwd) => {
        expect(args).toEqual(['worktree', 'list', '--porcelain'])
        const main = repos[cwd]
        if (main === undefined) throw new GitError('fatal: not a git repository', true)
        return `worktree ${main}\nHEAD abc\nbranch refs/heads/main\n\nworktree ${cwd}\nHEAD def\n`
      }
    const rows = (summary: ReturnType<UsageService['summary']>, agent: UsageAgent = 'claude') => of(summary, agent).repositories.map((r) => [r.name, r.space, r.requests])

    it('rolls a worktree, and a subfolder, up into the main checkout', async () => {
      const app = folder('repos', 'app')
      const worktree = folder('elsewhere', 'app-feature')
      const sub = folder('repos', 'app', 'packages', 'ui')
      const s = make([request({ at: at(15), folder: app }), request({ at: at(15), folder: worktree }), request({ at: at(15), folder: worktree }), request({ at: at(15), folder: sub })], {
        places: places(),
        git: gitOf({ [app]: app, [worktree]: app, [sub]: app }),
      })
      expect(rows(await placed(s))).toEqual([['app', false, 4]])
    })

    it('rolls Grove’s own worktree folders up, also when the folder is gone', async () => {
      const app = folder('repos', 'app')
      const live = folder('worktrees', 'app', 'feature')
      const gone = path.join(dir, 'worktrees', 'app', 'removed-branch', 'src')
      const s = make([request({ at: at(15), folder: app }), request({ at: at(15), folder: live }), request({ at: at(15), folder: gone })], {
        places: places(),
        git: gitOf({ [app]: app, [live]: app }),
      })
      expect(rows(await placed(s))).toEqual([['app', false, 3]])
    })

    it('says what the path says before git has answered, and tells the window when the answer changes it', async () => {
      const app = folder('repos', 'app')
      const worktree = folder('elsewhere', 'app-feature')
      const s = make([request({ at: at(15), folder: app }), request({ at: at(15), folder: worktree })], { places: places(), git: gitOf({ [app]: app, [worktree]: app }) })
      const told = vi.fn()
      s.subscribe(told)
      await s.drain()
      // Neither folder is a Space or in Grove's worktree folder yet, and git has not been heard from: the path says nothing.
      expect(rows(s.summary())).toEqual([[null, false, 2]])
      await s.settled()
      expect(rows(s.summary())).toEqual([['app', false, 2]])
      await vi.waitFor(() => expect(told).toHaveBeenCalled())
    })

    it('marks the repositories that are current Spaces, a worktree Space marking its main checkout', async () => {
      const app = folder('repos', 'app')
      const tool = folder('repos', 'tool')
      const worktree = folder('worktrees', 'tool', 'feature')
      const s = make([request({ at: at(15), folder: app }), request({ at: at(15), folder: tool }), request({ at: at(15), folder: tool })], {
        places: places(),
        spaces: [worktree],
        git: gitOf({ [app]: app, [tool]: tool, [worktree]: tool }),
      })
      expect(rows(await placed(s))).toEqual([
        ['tool', true, 2],
        ['app', false, 1],
      ])
    })

    it('puts a folder inside a Space that is no repository under that Space, and marks it', async () => {
      const notes = folder('notes')
      const sub = folder('notes', 'drafts')
      const s = make([request({ at: at(15), folder: sub }), request({ at: at(15), folder: notes })], { places: places(), spaces: [notes], git: gitOf({}) })
      expect(rows(await placed(s))).toEqual([['notes', true, 2]])
    })

    it('groups folders with no repository or Space under Other: scratch, home, no folder, a plain folder, a folder gone', async () => {
      const app = folder('repos', 'app')
      const scratch = folder('scratch', 'try-things')
      const home = path.join(dir, 'home')
      const plain = folder('plain')
      const s = make(
        [
          request({ at: at(15), folder: app }),
          request({ at: at(15), folder: scratch }),
          request({ at: at(15), folder: scratch }),
          request({ at: at(15), folder: home }),
          request({ at: at(15), folder: '' }),
          request({ at: at(15), folder: plain }),
          request({ at: at(15), folder: path.join(dir, 'vanished') }),
        ],
        { places: places(), git: gitOf({ [app]: app }) },
      )
      expect((await placed(s)).agents[0].repositories.map((r) => [r.name, r.requests])).toEqual([
        [null, 6],
        ['app', 1],
      ])
    })

    it('keeps a repository in a scratch folder under Other, unless it is a Space', async () => {
      const scratch = folder('scratch', 'clone')
      const kept = folder('scratch', 'mine')
      const s = make([request({ at: at(15), folder: scratch }), request({ at: at(15), folder: kept })], { places: places(), spaces: [kept], git: gitOf({ [scratch]: scratch, [kept]: kept }) })
      // The core's rows are by requests, then name; the panel puts Other last.
      const found = rows(await placed(s))
      expect(found).toHaveLength(2)
      expect(found).toContainEqual([null, false, 1])
      expect(found).toContainEqual(['mine', true, 1])
    })

    it('puts Claude Desktop’s scratch workspaces under Other even when they are repositories', async () => {
      const home = path.join(dir, 'home')
      const mac = folder('home', 'Library', 'Application Support', 'Claude', 'scratch-workspaces', 'a-1', 'scratch-2026-09-28-dff86c')
      const linux = folder('home', '.config', 'Claude', 'scratch-workspaces', 'a-1', 'scratch-2026-10-30-bc6d9d')
      const git = gitOf({ [mac]: mac, [linux]: linux })
      const s = make([request({ at: at(15), folder: mac }), request({ at: at(15), folder: linux })], {
        places: { home, worktreesRoot: path.join(dir, 'worktrees'), scratch: desktopScratch(home) },
        git,
      })
      expect(rows(await placed(s))).toEqual([[null, false, 2]])
    })

    it('rolls a deleted agent worktree inside a Space’s repository up into it', async () => {
      const app = folder('repos', 'app')
      const gone = path.join(app, '.claude', 'worktrees', 'task-1')
      const s = make([request({ at: at(15), folder: app }), request({ at: at(15), folder: gone })], { places: places(), spaces: [app], git: gitOf({ [app]: app }) })
      expect(rows(await placed(s))).toEqual([['app', true, 2]])
    })

    it('treats a repository at the home folder as Other, and asks git nothing about home itself', async () => {
      const home = path.join(dir, 'home')
      const below = folder('home', 'Desktop', 'stuff')
      const git = vi.fn(gitOf({ [below]: home }))
      const s = make([request({ at: at(15), folder: home }), request({ at: at(15), folder: below })], { places: places(), git })
      expect(rows(await placed(s))).toEqual([[null, false, 2]])
      expect(git).toHaveBeenCalledTimes(1)
    })

    it('asks git once per folder, read-only and time limited, and survives git failing', async () => {
      const app = folder('repos', 'app')
      const git = vi.fn<GitRun>(async () => {
        throw new GitError('timed out', false, true)
      })
      vi.spyOn(console, 'error').mockImplementation(() => {})
      const s = make([request({ at: at(15), folder: app }), request({ at: at(15), folder: app })], { places: places(), git })
      expect(rows(await placed(s))).toEqual([[null, false, 2]])
      await placed(s)
      expect(git).toHaveBeenCalledTimes(1)
      expect(git.mock.calls[0][2]).toMatchObject({ kind: 'read', timeoutMs: expect.any(Number) })
      // The log line says what failed, not where.
      expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain(app)
    })

    it('keeps the answer for each folder across summaries, and covers the range asked for', async () => {
      const app = folder('repos', 'app')
      const old = folder('repos', 'old')
      const git = vi.fn(gitOf({ [app]: app, [old]: old }))
      const s = make([request({ at: at(15), folder: app }), request({ at: at(2), folder: old })], { places: places(), git })
      expect(rows(await placed(s, 30, 7))).toEqual([['app', false, 1]])
      expect(rows(await placed(s, 30, 30))).toEqual([
        ['app', false, 1],
        ['old', false, 1],
      ])
      expect(git).toHaveBeenCalledTimes(2)
    })

    it('carries credits and the requests without them through the repositories, most requests first', async () => {
      const app = folder('repos', 'app')
      const tool = folder('repos', 'tool')
      const copilot = (over: Partial<UsageRequest>) => request({ agent: 'copilot', source: 'copilot', at: at(15), ...over })
      const s = make(
        [
          copilot({ folder: app, nanoAiu: 1_500_000_000 }),
          copilot({ folder: app, nanoAiu: null }),
          copilot({ folder: tool, nanoAiu: 1_000_000_000 }),
          copilot({ folder: tool, nanoAiu: 1_000_000_000 }),
          copilot({ folder: tool, nanoAiu: 1_000_000_000 }),
        ],
        { places: places(), git: gitOf({ [app]: app, [tool]: tool }) },
      )
      expect(of(await placed(s), 'copilot').repositories).toMatchObject([
        { name: 'tool', requests: 3, credits: 3, withoutCredits: 0 },
        { name: 'app', requests: 2, credits: 1.5, withoutCredits: 1 },
      ])
    })
  })

  describe('by model', () => {
    it('adds up the models over the range, most requests first, with their tokens', async () => {
      const s = make([request({ at: at(16), model: 'a' }), request({ at: at(15), model: 'b' }), request({ at: at(14), model: 'b', output: 10 }), request({ at: at(1), model: 'c' })])
      expect(of(await placed(s, 30, 7), 'claude').models).toMatchObject([
        { model: 'b', requests: 2, output: 12 },
        { model: 'a', requests: 1 },
      ])
      expect(of(await placed(s, 30, 30), 'claude').models.map((m) => m.model)).toEqual(['b', 'a', 'c'])
    })
  })

  it('keeps every breakdown in step when a later line of a request replaces the earlier one', async () => {
    const early = request({ key: 'same', at: at(15, 10), model: 'm', output: 5, folder: '/x' })
    const copy = request({ key: 'same', at: at(14, 22), model: 'm', output: 5, folder: '/y', helper: true })
    const s = make([early, copy], {
      places: { home: '/h', worktreesRoot: '/w', scratch: [] },
      git: async () => {
        throw new GitError('x', true)
      },
    })
    const claude = of(await placed(s), 'claude')
    // One request, at its first occurrence.
    expect(claude.days).toMatchObject([{ day: '2026-11-14', requests: 1, helperRequests: 1 }])
    expect(claude.hours[5 * 24 + 22]).toBe(1)
    expect(claude.hours.reduce((a, b) => a + b, 0)).toBe(1)
    expect(claude.models).toMatchObject([{ model: 'm', requests: 1 }])
  })
})
