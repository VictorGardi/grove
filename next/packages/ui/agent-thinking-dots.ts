function createAgentThinkingDots(): HTMLSpanElement {
  const dots = document.createElement('span')
  dots.className = 'agent-thinking-dots'

  for (let index = 0; index < 3; index += 1) {
    const dot = document.createElement('span')
    dot.className = 'agent-thinking-dot'
    dots.append(dot)
  }

  return dots
}

export function createAgentWorkingMark(): HTMLSpanElement {
  const mark = document.createElement('span')
  mark.className = 'agent-working-mark'
  mark.setAttribute('aria-hidden', 'true')

  const waveform = document.createElement('span')
  waveform.className = 'agent-waveform'
  for (let index = 0; index < 3; index += 1) {
    const bar = document.createElement('span')
    bar.className = 'agent-wave-bar'
    waveform.append(bar)
  }

  mark.append(createAgentThinkingDots(), waveform)
  return mark
}
