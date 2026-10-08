// Minimal logging reverse proxy: listens on :49498, forwards to the private server on :49499,
// logs "METHOD URL [body<=300 chars]" per request to stdout. Auth header is forwarded, never logged.
const http = require("http")
const [listen, target] = [Number(process.argv[2] || 49498), Number(process.argv[3] || 49499)]
http.createServer((req, res) => {
  const chunks = []
  req.on("data", (c) => chunks.push(c))
  req.on("end", () => {
    const body = Buffer.concat(chunks)
    if (!/^\/api\/event/.test(req.url) || req.method !== "GET")
      console.log(new Date().toISOString(), req.method, req.url, body.length ? body.toString().slice(0, 300) : "")
    const up = http.request({ host: "127.0.0.1", port: target, method: req.method, path: req.url, headers: req.headers }, (r) => {
      res.writeHead(r.statusCode, r.headers); r.pipe(res)
      if (r.statusCode >= 400) console.log("   ->", r.statusCode, req.method, req.url)
    })
    up.on("error", (e) => { res.writeHead(502); res.end(String(e)) })
    up.end(body)
  })
}).listen(listen, "127.0.0.1")
