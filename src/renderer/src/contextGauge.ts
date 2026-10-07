import type { Session } from '@shared/types'

// What the gauge shows for a session; pct null: running without a reading ("—").
export interface ContextView { pct: number | null; tokens: number | null; window: number | null; dim: boolean }

// Claude sessions only (OpenCode follows). Running: the live reading, or none yet. Ended: the last known one, dimmed.
export function contextView(s: Session): ContextView | null {
  if (s.kind !== 'claude') return null
  if (s.lastStatus === 'running') {
    return { pct: s.contextPct ?? null, tokens: s.contextTokens ?? null, window: s.contextWindow ?? null, dim: false }
  }
  return s.lastContext ? { ...s.lastContext, dim: true } : null
}

// The share of the gauge that is filled, 0..1; an unknown reading is empty.
export const gaugeFill = (pct: number | null): number => (pct === null || !Number.isFinite(pct) ? 0 : Math.min(1, Math.max(0, pct / 100)))

// 190300 → "190.3k", 1000000 → "1.0M"; under 1000 as is.
export function formatTokens(n: number): string {
  if (n < 1000) return String(n)
  const k = Math.round(n / 100) / 10
  return k < 1000 ? `${k.toFixed(1)}k` : `${(Math.round(n / 100000) / 10).toFixed(1)}M`
}

export const formatPct = (pct: number | null): string => (pct === null ? '—' : `${Math.round(pct)}%`)

// "190.3k / 1.0M"; null without a window size.
export function formatUsage(tokens: number | null, window: number | null): string | null {
  if (window === null) return null
  return `${tokens === null ? '—' : formatTokens(tokens)} / ${formatTokens(window)}`
}
