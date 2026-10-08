// Prints a ses_ id in OpenCode 2.0.20's descending format (OC:packages/schema/src/identifier.ts:14-30)
const chars = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"
const current = BigInt(Date.now()) * 0x1000n + 1n
const value = ~current
const time = Array.from({ length: 6 }, (_, i) => Number((value >> BigInt(40 - 8 * i)) & 0xffn).toString(16).padStart(2, "0")).join("")
const bytes = require("crypto").randomBytes(14)
console.log("ses_" + time + Array.from(bytes, (b) => chars[b % 62]).join(""))
