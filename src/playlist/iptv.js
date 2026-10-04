import { USER_AGENT, getAllApiBases } from '../env.js'
import { embedFromSource } from '../embed/context.js'
import { resolveEmbedStreamUrl } from '../embed/decrypt.js'

/**
 * Fetch all streams from the upstream API with domain failover.
 */
async function fetchAllStreams() {
  const bases = getAllApiBases()
  let lastError = null

  for (const base of bases) {
    try {
      const res = await fetch(`${base}/streams`, {
        headers: { 'User-Agent': USER_AGENT },
      })
      if (!res.ok) {
        lastError = `HTTP ${res.status} from ${base}`
        continue
      }
      const data = await res.json()
      if (!data?.success || !data?.streams) {
        lastError = data?.error || 'invalid response'
        continue
      }
      return data.streams
    } catch (e) {
      lastError = e.message
      continue
    }
  }
  throw new Error(lastError || 'all API domains failed')
}

/**
 * Fetch metadata for a single stream by URI, with domain failover.
 */
async function fetchStreamMeta(uri) {
  const bases = getAllApiBases()
  let lastError = null

  for (const base of bases) {
    try {
      const res = await fetch(`${base}/streams/${uri}`, {
        headers: { 'User-Agent': USER_AGENT },
      })
      if (!res.ok) {
        // A genuine upstream 404 means the item doesn't exist anywhere —
        // don't waste 6 more round trips walking the mirror chain.
        if (res.status === 404) throw new Error(`not found: ${uri}`)
        lastError = `upstream ${res.status} from ${base}`
        continue
      }
      const json = await res.json()
      if (!json?.success || !json?.data) {
        if (json?.statusCode === 404 || json?.status_code === 404) {
          throw new Error(`not found: ${uri}`)
        }
        lastError = json?.error || 'empty payload'
        continue
      }
      return json.data
    } catch (e) {
      lastError = e.message
      if (e.message.startsWith('not found:')) throw e
      continue
    }
  }
  throw new Error(lastError || 'all API domains failed')
}

/**
 * Escape a string for safe inclusion in M3U attributes.
 */
function escAttr(s) {
  return String(s || '').replace(/"/g, "'")
}

/**
 * Generate an M3U8 playlist for IPTV players (TiviMate, IPTV Smarters, etc).
 *
 * @param {string} origin - This server's origin, e.g. http://192.168.1.10:3000
 * @param {string} [categoryFilter] - Optional category name to filter by
 * @returns {Promise<string>} M3U8 playlist text
 */
export async function generatePlaylist(origin, categoryFilter) {
  const categories = await fetchAllStreams()

  const lines = ['#EXTM3U']

  for (const cat of categories) {
    const catName = cat.category || cat.category_name || 'Uncategorized'

    if (categoryFilter && catName.toLowerCase() !== categoryFilter.toLowerCase()) continue

    for (const stream of cat.streams || []) {
      const name = stream.name || 'Unknown'
      const uri = stream.uri_name || ''
      if (!uri || !stream.iframe) continue

      const logo = stream.poster || ''
      const group = catName
      const id = uri.replace(/\//g, '-')

      lines.push(
        `#EXTINF:-1 tvg-id="${escAttr(id)}" tvg-name="${escAttr(name)}" tvg-logo="${escAttr(logo)}" group-title="${escAttr(group)}",${name}`,
      )
      lines.push(`${origin}/live/${uri}.m3u8`)

      // Add substreams as separate channel entries
      for (const sub of stream.substreams || []) {
        if (!sub.iframe || !sub.uri_name) continue
        const subName = `${name} — ${sub.source_tag || sub.uri_name}`
        const subId = sub.uri_name.replace(/\//g, '-')

        lines.push(
          `#EXTINF:-1 tvg-id="${escAttr(subId)}" tvg-name="${escAttr(subName)}" tvg-logo="${escAttr(logo)}" group-title="${escAttr(group)}",${subName}`,
        )
        lines.push(`${origin}/live/${sub.uri_name}.m3u8`)
      }
    }
  }

  return lines.join('\n') + '\n'
}

/**
 * Find a substream by uri_name across the full event index.
 * Substream URIs are not top-level API items — they only exist nested
 * inside their parent stream's index entry, so a failed fetchStreamMeta()
 * for e.g. "247-willow-2" must fall back to this lookup.
 */
async function findSubstream(uri) {
  const categories = await fetchAllStreams()
  for (const cat of categories) {
    for (const stream of cat.streams || []) {
      for (const sub of stream.substreams || []) {
        if (sub.uri_name === uri && sub.iframe) return sub
      }
    }
  }
  return null
}

/**
 * Resolve a live channel URI to its stream URL and embed context.
 * Used by the /live/ endpoint to relay HLS on-the-fly.
 *
 * @param {string} uri - Stream URI (e.g. "nfl-network" or "cfb/2026-10-03/byu-tcu")
 * @returns {Promise<{streamUrl: string, embed: {origin: string, path: string}}>}
 */
export async function resolveLiveChannel(uri) {
  let data = null
  try {
    data = await fetchStreamMeta(uri)
  } catch (err) {
    // Top-level lookup failed — the URI may be a substream (e.g. "247-willow-2").
    // Resolve via its iframe URL from the event index, like /api/embed does.
    const sub = await findSubstream(uri)
    if (!sub) throw err
    const embed = embedFromSource({ data: sub.iframe })
    const streamUrl = await resolveEmbedStreamUrl(embed)
    return { streamUrl, embed }
  }

  const source = (data.sources || []).find((s) => s.default)
  if (!source?.data) throw new Error('no default embed source')

  const embed = embedFromSource(source)
  const streamUrl = await resolveEmbedStreamUrl(embed)

  return { streamUrl, embed }
}
