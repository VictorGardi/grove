import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

// A tripwire, not proof: the evidence for "no outbound traffic" is the Wi-Fi-off and lsof checks
// in the run log. This fails early if a dictation module starts to look like it talks to a network.

const root = path.resolve(__dirname, '../../..')
const dictationDir = path.join(root, 'src/renderer/src/dictation')

const sources = (): string[] => [
  path.join(root, 'src/core/dictate.ts'),
  path.join(root, 'src/core/stt/whisper.ts'),
  ...fs
    .readdirSync(dictationDir)
    .filter((f) => /\.(ts|tsx|js)$/.test(f) && !/\.test\.tsx?$/.test(f))
    .map((f) => path.join(dictationDir, f))
]

const NET_MODULES = ['http', 'https', 'http2', 'net', 'dgram', 'tls', 'dns']
// Only comments that start a line or follow whitespace, so a `/*` or `//` inside a string cannot hide code.
const stripComments = (src: string): string =>
  src.replace(/^\s*\/\*[\s\S]*?\*\//gm, '').replace(/(^|\s)\/\/.*$/gm, '$1')

function findNetworkUse(src: string): string[] {
  const code = stripComments(src)
  const hits: string[] = []
  const mods = NET_MODULES.join('|')
  const importRe = new RegExp(`(?:from\\s*|import\\s*\\(?\\s*|require\\s*\\(\\s*)['"](?:node:)?(${mods})(?:/[^'"]*)?['"]`, 'g')
  for (const m of code.matchAll(importRe)) hits.push(`import ${m[1]}`)
  if (/\bfetch\s*\(/.test(code)) hits.push('fetch(')
  if (/\bXMLHttpRequest\b/.test(code)) hits.push('XMLHttpRequest')
  if (/\bWebSocket\b/.test(code)) hits.push('WebSocket')
  if (/\bEventSource\b/.test(code)) hits.push('EventSource')
  if (/\bsendBeacon\b/.test(code)) hits.push('sendBeacon')
  if (/\bRTCPeerConnection\b/.test(code)) hits.push('RTCPeerConnection')
  if (/\b(?:globalThis|window|self)\s*(?:\[\s*['"]fetch['"]\s*\]|\.fetch\b)/.test(code)) hits.push('global fetch')
  return hits
}

describe('dictation makes no network use', () => {
  it('finds the dictation modules to scan', () => {
    const files = sources().map((f) => path.relative(root, f))
    expect(files).toContain('src/core/dictate.ts')
    expect(files).toContain('src/core/stt/whisper.ts')
    expect(files).toContain('src/renderer/src/dictation/useDictation.ts')
    expect(files).toContain('src/renderer/src/dictation/capture.ts')
  })

  it.each(sources().map((f) => [path.relative(root, f), f]))('%s imports no network module and calls no fetch', (_name, file) => {
    expect(findNetworkUse(fs.readFileSync(file, 'utf8'))).toEqual([])
  })

  it('the detector fails when a network import or call is added', () => {
    expect(findNetworkUse(`import https from 'node:https'`)).toEqual(['import https'])
    expect(findNetworkUse(`import { connect } from "net"`)).toEqual(['import net'])
    expect(findNetworkUse(`const t = require('tls')`)).toEqual(['import tls'])
    expect(findNetworkUse(`const d = await import('dgram')`)).toEqual(['import dgram'])
    expect(findNetworkUse(`await fetch('https://x')`)).toEqual(['fetch('])
    expect(findNetworkUse(`new WebSocket('wss://x')`)).toEqual(['WebSocket'])
    expect(findNetworkUse(`new RTCPeerConnection()`)).toEqual(['RTCPeerConnection'])
    expect(findNetworkUse(`new XMLHttpRequest()`)).toEqual(['XMLHttpRequest'])
    expect(findNetworkUse(`new EventSource('/x')`)).toEqual(['EventSource'])
    expect(findNetworkUse(`navigator.sendBeacon('/x')`)).toEqual(['sendBeacon'])
    expect(findNetworkUse(`globalThis['fetch']`)).toEqual(['global fetch'])
    expect(findNetworkUse(`window["fetch"]`)).toEqual(['global fetch'])
    expect(findNetworkUse(`// import https from 'https'\nconst a = 1`)).toEqual([])
    expect(findNetworkUse(`const g = 'src/**/*.ts'\nimport https from 'https'\nconst h = 'a */'`)).toEqual(['import https'])
    expect(findNetworkUse(`import fs from 'node:fs'`)).toEqual([])
  })

  it('the renderer CSP has no connect-src', () => {
    const html = fs.readFileSync(path.join(root, 'src/renderer/index.html'), 'utf8')
    const csp = /http-equiv="Content-Security-Policy"\s+content="([^"]*)"/.exec(html)?.[1]
    expect(csp).toBeTruthy()
    expect(csp).not.toMatch(/connect-src/)
    expect(csp).toMatch(/default-src 'self'(;|$)/)
    expect(csp).not.toMatch(/\*|\bhttps?:|\bwss?:/)
    expect(csp).not.toMatch(/worker-src[^;]*blob:/)
  })
})
