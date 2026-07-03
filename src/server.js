import http from 'node:http'
import { port } from './env.js'
import { onReq } from './http/route.js'

const srv = http.createServer(onReq)

function boot() {
  const addr = srv.address()
  const host = typeof addr === 'string' ? addr : `localhost:${addr.port}`
  console.log(`http://${host}/`)
}

if (process.env.HOST) srv.listen(port, process.env.HOST, boot)
else srv.listen(port, boot)
