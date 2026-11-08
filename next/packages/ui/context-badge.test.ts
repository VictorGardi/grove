// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import type { ContextUsage } from '../protocol/messages.ts'
import { contextReadout, hideContextTip, markWithContext } from './context-badge.ts'
import { contextView } from './sidebar-model.ts'

const usage = (tokens: number | null, window: number | null, percent: number | null = null, model: string | null = 'opus', at = 0): ContextUsage => ({
  tokens,
  window,
  percent,
  model,
  at,
})

describe('contextView', () => {
  it('draws nothing without a reading or a window to fill the ring against', () => {
    expect(contextView(undefined)).toBeNull()
    expect(contextView(usage(null, 200_000))).toBeNull()
    expect(contextView(usage(0, 200_000))).toBeNull()
    expect(contextView(usage(45_000, null))).toBeNull()
  })

  it('shows a Copilot reading without a prompt budget as tokens alone, unfilled and timed', () => {
    const at = new Date(2026, 10, 8, 21, 10).getTime()
    expect(contextView(usage(101_079, null, null, 'gpt-6-luna', at), 'copilot')).toEqual({
      fraction: null,
      full: false,
      warn: false,
      last: true,
      headline: '101.1k prompt tokens · last request 21:10',
      detail: 'no prompt budget · gpt-6-luna',
    })
  })

  it('fills the ring by the used share of a Claude window', () => {
    expect(contextView(usage(124_000, 200_000))).toEqual({
      fraction: 0.62,
      full: false,
      warn: false,
      last: false,
      headline: '62% used',
      detail: '124k / 200k · opus',
    })
  })

  it('uses the status line percentage when Claude reports one', () => {
    expect(contextView(usage(45_000, 200_000, 23))?.headline).toBe('23% used')
  })

  it('says a Copilot reading is a last request against the prompt budget, timed', () => {
    const at = new Date(2026, 10, 8, 21, 10).getTime()
    expect(contextView(usage(101_079, 272_000, null, 'gpt-6-luna', at), 'copilot')).toEqual({
      fraction: 0.37,
      full: false,
      warn: false,
      last: true,
      headline: '37% · last request 21:10',
      detail: '101.1k / 272k prompt budget · gpt-6-luna',
    })
  })

  it('says an OpenCode reading is a last request against the model limit', () => {
    const at = new Date(2026, 10, 8, 21, 15).getTime()
    expect(contextView(usage(38_793, 400_000, null, 'gpt-5.2-codex', at), 'opencode')?.detail).toBe(
      '38.8k / 400k model limit · gpt-5.2-codex',
    )
  })

  it('warns from three quarters of the window up, and not once it is full', () => {
    expect(contextView(usage(148_000, 200_000))?.warn).toBe(false)
    expect(contextView(usage(150_000, 200_000))?.warn).toBe(true)
    expect(contextView(usage(200_000, 200_000))).toMatchObject({ warn: false, full: true })
  })

  it('marks a window that is used up as full, and clamps the ring to a whole circle', () => {
    expect(contextView(usage(200_000, 200_000))).toMatchObject({ fraction: 1, full: true, headline: '100% · full' })
    expect(contextView(usage(230_000, 200_000))).toMatchObject({ fraction: 1, full: true, headline: '115% · full' })
  })
})

describe('markWithContext', () => {
  it('keeps the mark alone in its stack when there is no ring to draw', () => {
    const mark = document.createElement('span')
    const stack = markWithContext(mark, undefined, 'claude')
    expect(stack.className).toBe('mark-stack')
    expect(stack.children).toHaveLength(1)
    expect(stack.querySelector('.context-ring')).toBeNull()
  })

  it('draws the ring around the mark, labelled with the headline and detail', () => {
    const stack = markWithContext(document.createElement('span'), usage(124_000, 200_000), 'claude')
    const badge = stack.querySelector<HTMLElement>('.context-ring')
    expect(badge?.getAttribute('aria-label')).toBe('62% used. 124k / 200k · opus')
    expect(badge?.style.background).toContain('conic-gradient')
    expect(badge?.classList.contains('last')).toBe(false)
    expect(badge?.classList.contains('full')).toBe(false)
  })

  it('marks a last request, a warning and a full window on the ring', () => {
    const last = markWithContext(document.createElement('span'), usage(101_079, 272_000), 'copilot')
    expect(last.querySelector('.context-ring')?.classList.contains('last')).toBe(true)
    const warn = markWithContext(document.createElement('span'), usage(174_000, 200_000), 'claude')
    expect(warn.querySelector('.context-ring')?.classList.contains('warn')).toBe(true)
    const full = markWithContext(document.createElement('span'), usage(200_000, 200_000), 'claude')
    expect(full.querySelector('.context-ring')?.classList.contains('full')).toBe(true)
  })

  it('shows the tooltip on hover and hides it when the pointer leaves', () => {
    const stack = markWithContext(document.createElement('span'), usage(124_000, 200_000), 'claude')
    document.body.append(stack)
    const badge = stack.querySelector<HTMLElement>('.context-ring')!
    badge.dispatchEvent(new Event('pointerenter'))
    const tip = document.querySelector<HTMLElement>('.context-tip')!
    expect(tip.hidden).toBe(false)
    expect(tip.querySelector('.context-tip-head')?.textContent).toBe('62% used')
    expect(tip.querySelector('.context-tip-detail')?.textContent).toBe('124k / 200k · opus')
    badge.dispatchEvent(new Event('pointerleave'))
    expect(tip.hidden).toBe(true)
    badge.dispatchEvent(new Event('pointerenter'))
    hideContextTip()
    expect(tip.hidden).toBe(true)
    stack.remove()
  })
})

describe('contextReadout', () => {
  it('has nothing to show without a reading', () => {
    expect(contextReadout(undefined, 'claude')).toBeNull()
    expect(contextReadout(usage(45_000, null), 'claude')).toBeNull()
    expect(contextReadout(usage(45_000, 200_000), undefined)).toBeNull()
  })

  it('shows a bar filled to the used share, with the headline and detail beside it', () => {
    const readout = contextReadout(usage(124_000, 200_000), 'claude')!
    expect(readout.querySelector<HTMLElement>('.context-bar i')?.style.width).toBe('62%')
    expect(readout.querySelector('.context-readout-head')?.textContent).toBe('62% used')
    expect(readout.querySelector('.context-readout-detail')?.textContent).toBe('124k / 200k · opus')
    expect(readout.classList.contains('warn')).toBe(false)
  })

  it('leaves the bar empty and dashed for a Copilot reading with no budget, and marks warnings and last requests', () => {
    const unknown = contextReadout(usage(101_079, null), 'copilot')!
    expect(unknown.querySelector('.context-bar i')).toBeNull()
    expect(unknown.classList.contains('unknown')).toBe(true)
    const warned = contextReadout(usage(174_000, 200_000), 'opencode')!
    expect(warned.classList.contains('warn')).toBe(true)
    expect(warned.classList.contains('last')).toBe(true)
  })
})
