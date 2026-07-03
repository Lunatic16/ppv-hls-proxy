export function json(res, status, body) {
  if (res.headersSent) return
  res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' })
  res.end(JSON.stringify(body))
}

export function text(res, status, msg) {
  if (res.headersSent) return
  res.writeHead(status, { 'Content-Type': 'text/plain' })
  res.end(msg)
}

export async function readBody(req) {
  let raw = ''
  for await (const chunk of req) raw += chunk
  return JSON.parse(raw)
}
