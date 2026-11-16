// Test support: how long the event loop was held while a first scan ran.

// The longest a 5 ms timer ran late while `run` went on: the longest the loop was held, plus the timer's own jitter.
export async function worstStall(run: () => Promise<unknown>): Promise<number> {
  let worst = 0
  let last = performance.now()
  const probe = setInterval(() => {
    const t = performance.now()
    worst = Math.max(worst, t - last - 5)
    last = t
  }, 5)
  try {
    await run()
  } finally {
    clearInterval(probe)
  }
  return worst
}

// The bar a scan must meet: no stall of 100 ms or more. Other test files running at the same time delay a timer for reasons the code
// under test has nothing to do with, while a stall the code causes shows in every attempt, so the least of up to three attempts is what
// the bar holds. `again` runs the scan once more from nothing and returns its worst stall.
export const STALL_LIMIT_MS = 100
export async function calmest(first: number, again: () => Promise<number>): Promise<number> {
  let best = first
  for (let attempt = 1; attempt < 3 && best >= STALL_LIMIT_MS; attempt++) best = Math.min(best, await again())
  return best
}
