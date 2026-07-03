const NON_MEDIA_EXT = /\.(html|php|js|css|svg)(\?|$)/i
const STATIC_IMAGE_EXT = /\.(jpg|jpeg|png|gif|webp)(\?|$)/i
const STREAM_EXT = /\.(m3u8|ts|m4s|mp4)(\?|$)/i

function sniffMedia(body) {
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(body || [])
  if (!buf.length) return { kind: 'empty' }

  const sample = buf.subarray(0, Math.min(buf.length, 16384))
  const text = sample.toString('utf8')

  if (text.includes('#EXTM3U')) {
    const hasStreamInf = /#EXT-X-STREAM-INF/i.test(text)
    const hasExtinf = /#EXTINF:/i.test(text)
    return {
      kind: 'playlist',
      master: hasStreamInf && !hasExtinf,
      media: hasExtinf,
      text,
    }
  }

  if (buf[0] === 0x47 && buf.length >= 188) return { kind: 'segment' }
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    return { kind: 'segment' }
  }

  return { kind: 'binary' }
}

export function isM3u8Resource(url, contentType = '') {
  const ct = String(contentType).toLowerCase()
  if (ct.includes('mpegurl') || ct.includes('m3u8')) return true
  try {
    const path = new URL(url).pathname.toLowerCase()
    return path.endsWith('.m3u8') || path.includes('.m3u8?')
  } catch {
    return false
  }
}

function playlistResourceLines(text) {
  const lines = []
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    lines.push(line)
  }
  return lines
}

function uriLooksLikeVariant(uri) {
  if (/\.m3u8(\?|$)/i.test(uri)) return true
  if (!/^https?:\/\//i.test(uri)) return !NON_MEDIA_EXT.test(uri)
  return false
}

function uriLooksLikeStaticAsset(uri) {
  return STATIC_IMAGE_EXT.test(uri)
}

function uriLooksLikeMediaSegment(uri) {
  if (NON_MEDIA_EXT.test(uri)) return false
  if (STREAM_EXT.test(uri)) return true
  if (!/^https?:\/\//i.test(uri)) return true
  return !NON_MEDIA_EXT.test(uri)
}

export function isPoisonPlaylist(body) {
  const sniff = sniffMedia(body)
  if (sniff.kind !== 'playlist') return false
  const resources = playlistResourceLines(sniff.text)
  if (!resources.length) return false
  if (sniff.master) {
    if (resources.some(uriLooksLikeVariant)) return false
    return resources.every(uriLooksLikeStaticAsset)
  }
  if (sniff.media) return !resources.some(uriLooksLikeMediaSegment)
  return false
}

function isPlayablePlaylist(body) {
  const sniff = sniffMedia(body)
  if (sniff.kind !== 'playlist' || isPoisonPlaylist(body)) return false
  const resources = playlistResourceLines(sniff.text)
  if (sniff.master) return resources.some(uriLooksLikeVariant)
  if (sniff.media) return resources.some(uriLooksLikeMediaSegment)
  return true
}

export function shouldProxyPlaylistUri(abs, playlistUrl, embed) {
  if (!/^https?:\/\//i.test(abs)) return false
  try {
    if (new URL(abs).hostname === new URL(embed.origin).hostname) return false
  } catch {
    return false
  }
  if (uriLooksLikeMediaSegment(abs) || uriLooksLikeVariant(abs)) return true
  try {
    return new URL(abs).origin === new URL(playlistUrl).origin
  } catch {
    return false
  }
}

export function okBody(body, url) {
  if (!body?.length) return false
  const head = body.toString('utf8', 0, 200).toLowerCase()
  if (head.includes('<html') || head.includes('403 forbidden')) return false
  const sniff = sniffMedia(body)
  if (isM3u8Resource(url) || sniff.kind === 'playlist') {
    return isPlayablePlaylist(body) && !isPoisonPlaylist(body)
  }
  return sniff.kind === 'segment' || sniff.kind === 'binary'
}
