const MARKER = '/embed/'
const RELAY = '/api/hls'

export function embedFromSource(source) {
  const raw = String(source?.data || '').trim()
  const url = new URL(raw)
  const idx = url.pathname.indexOf(MARKER)
  if (idx < 0) throw new Error('embed source missing /embed/ path')
  const path = url.pathname.slice(idx + MARKER.length).replace(/^\/+/, '')
  if (!path) throw new Error('embed source path empty')
  return { origin: url.origin, path }
}

export function embedFromQuery(searchParams) {
  const path = searchParams.get('embed')
  const origin = searchParams.get('embedOrigin')
  if (!path || !origin) throw new Error('embed and embedOrigin required')
  return { origin, path }
}

export function relayUrl(base, target, embed) {
  const q = new URLSearchParams({ url: target, embed: embed.path, embedOrigin: embed.origin })
  return `${base}${RELAY}?${q}`
}
