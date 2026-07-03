import { relayUrl } from '../embed/context.js'
import { isM3u8Resource, isPoisonPlaylist, shouldProxyPlaylistUri } from '../embed/media.js'

function abs(uri, base) {
  return uri.startsWith('http') ? uri : new URL(uri, base).href
}

function syncLiveMediaPlaylist(text) {
  if (!text.includes('#EXTINF:') || text.includes('#EXT-X-ENDLIST') || text.includes('#EXT-X-STREAM-INF')) {
    return text
  }

  const lines = text.split('\n')
  const header = []
  const entries = []
  let target = 4
  let i = 0

  while (i < lines.length) {
    const line = lines[i]
    const trimmed = line.trim()
    if (trimmed.startsWith('#EXT-X-TARGETDURATION:')) {
      target = parseFloat(trimmed.slice(22)) || target
    }
    if (trimmed.startsWith('#EXTINF:')) {
      const duration = parseFloat(trimmed.slice(8))
      const uriLine = lines[i + 1]
      if (uriLine !== undefined && uriLine.trim() && !uriLine.trim().startsWith('#')) {
        entries.push({ extinf: line, uri: lines[i + 1], duration })
        i += 2
        continue
      }
    }
    if (!entries.length) header.push(line)
    i += 1
  }

  if (!entries.length) return text

  const min = target * 0.95
  const kept = entries.at(-1).duration < min ? entries.slice(0, -1) : entries
  if (!kept.length) return text

  const out = [...header]
  for (const entry of kept) {
    out.push(entry.extinf, entry.uri)
  }
  return out.join('\n')
}

export function rewritePlaylist(text, base, embed, origin) {
  const synced = syncLiveMediaPlaylist(text)
  const lines = synced.split('\n')
  const out = []
  let segs = 0

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) {
      out.push(line)
      continue
    }
    if (trimmed.startsWith('#')) {
      if (trimmed.startsWith('#EXT-X-MAP:')) {
        out.push(
          trimmed.replace(/URI="([^"]+)"/, (_, uri) => {
            const href = abs(uri, base)
            if (!shouldProxyPlaylistUri(href, base, embed)) return `URI="${uri}"`
            return `URI="${relayUrl(origin, href, embed)}"`
          }),
        )
      } else {
        out.push(line)
      }
      continue
    }
    const href = abs(trimmed, base)
    if (!shouldProxyPlaylistUri(href, base, embed)) continue
    out.push(relayUrl(origin, href, embed))
    if (!isM3u8Resource(href)) segs += 1
  }

  if (text.includes('#EXTINF:') && segs === 0) {
    throw new Error(isPoisonPlaylist(Buffer.from(synced)) ? 'upstream playlist blocked' : 'playlist has no stream segments')
  }
  return out.join('\n')
}
