// Developer-run: fetch the whisper model used by dictation into Grove's userData, verified against a pinned hash.
//   node scripts/stt-fetch-model.mjs            download ggml-base.en.bin
//   node scripts/stt-fetch-model.mjs --from F   verify and install a hand-copied file instead
// STT_MODEL_DIR overrides the target directory. Test hook: STT_MODEL_SHA256 overrides the pinned hash,
// honoured only when STT_MODEL_DIR is also set.
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

const URL_ = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin'
const FILE = 'ggml-base.en.bin'
const PINNED = 'a03779c86df3323075f5e796cb2ce5029f00ec8869eee3fdfb897afe36c6d002' // size 147964211
const testHook = Boolean(process.env.STT_MODEL_DIR)
const expected = (testHook && process.env.STT_MODEL_SHA256) || PINNED

// Electron's userData is <appData>/<app name>; the app name is package.json's productName/name, "grove".
const appData =
  process.platform === 'darwin' ? path.join(os.homedir(), 'Library', 'Application Support')
  : process.platform === 'win32' ? (process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming'))
  : (process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), '.config'))
const dir = process.env.STT_MODEL_DIR ?? path.join(appData, 'grove', 'stt')
const target = path.join(dir, FILE)

const fail = (msg) => { console.error(msg); process.exit(1) }

const hashFile = async (file) => {
  const h = crypto.createHash('sha256')
  await pipeline(fs.createReadStream(file), h)
  return h.digest('hex')
}

if (fs.existsSync(target) && (await hashFile(target)) === expected) {
  console.log(`already installed: ${target}\nsha256 ${expected}`)
  process.exit(0)
}

const argv = process.argv.slice(2)
const fromIdx = argv.indexOf('--from')
const from = fromIdx >= 0 ? argv[fromIdx + 1] : null
if (fromIdx >= 0 && !from) fail('--from needs a file path')

fs.mkdirSync(dir, { recursive: true })
const tmp = path.join(dir, `${FILE}.${process.pid}.part`)
const hash = crypto.createHash('sha256')
try {
  let source
  if (from) source = fs.createReadStream(from)
  else {
    const res = await fetch(URL_, { redirect: 'follow' })
    if (!res.ok || !res.body) fail(`download failed: HTTP ${res.status}`)
    source = Readable.fromWeb(res.body)
  }
  source.on('data', (c) => hash.update(c))
  await pipeline(source, fs.createWriteStream(tmp))
} catch (e) {
  fs.rmSync(tmp, { force: true })
  fail(`failed: ${e instanceof Error ? e.message : e}`)
}

const actual = hash.digest('hex')
if (actual !== expected) {
  fs.rmSync(tmp, { force: true })
  fail(`sha256 mismatch\nexpected ${expected}\nactual   ${actual}`)
}
fs.renameSync(tmp, target)
console.log(`${target}\nsha256 ${actual}`)
