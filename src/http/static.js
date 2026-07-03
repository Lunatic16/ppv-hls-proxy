import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../public')

const routes = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/index.html': ['index.html', 'text/html; charset=utf-8'],
  '/css/app.css': ['css/app.css', 'text/css; charset=utf-8'],
  '/js/app.js': ['js/app.js', 'application/javascript; charset=utf-8'],
}

export function serveStatic(pathname, res) {
  const file = routes[pathname]
  if (!file) return false
  res.writeHead(200, { 'Content-Type': file[1], 'Cache-Control': 'no-store' })
  fs.createReadStream(path.join(root, file[0])).pipe(res)
  return true
}
