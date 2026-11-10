// Stands in for the core in holder tests: records each start, then exits after 300 ms.
import fs from 'node:fs'
import path from 'node:path'

const home = process.env.GROVE_HOME
fs.appendFileSync(path.join(home, 'starts'), `${process.pid}\n`)
setTimeout(() => process.exit(0), 300)
