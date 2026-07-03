import { API_DOMAINS, USER_AGENT, getAllApiBases } from '../env.js'
import { embedFromSource, relayUrl } from '../embed/context.js'
import { resolveEmbedStreamUrl } from '../embed/decrypt.js'

const fail = (stage, error, extra = {}) => ({ ok: false, stage, error, ...extra })

function parseInput(input) {
  const raw = typeof input === 'string' ? input : input?.url || ''
  if (!raw) return { error: 'url required' }

  let pathname = String(raw).trim()
  if (/^https?:\/\//i.test(pathname)) {
    try {
      pathname = new URL(pathname).pathname
    } catch {
      return { error: 'invalid url' }
    }
  }
  if (!pathname.startsWith('/')) pathname = `/${pathname}`

  let uri = pathname.replace(/^\/+/, '')
  if (uri.startsWith('live/')) uri = uri.slice(5)
  uri = uri.replace(/^24\/7-/i, '247-')
  if (!uri) return { error: 'url required' }

  return { uri, contentPath: pathname }
}

/**
 * Fetch metadata with API domain failover.
 * Tries each domain in API_DOMAINS order until one succeeds or all fail.
 */
async function fetchMeta(uri) {
  const bases = getAllApiBases()
  let lastError = null

  for (const base of bases) {
    try {
      const res = await fetch(`${base}/streams/${uri}`, {
        headers: { 'User-Agent': USER_AGENT },
      })
      
      if (!res.ok) {
        lastError = `upstream ${res.status} from ${base}`
        continue // try next domain
      }
      
      let json
      try {
        json = await res.json()
      } catch (e) {
        lastError = 'invalid JSON response'
        continue
      }
      
      if (!json?.success || !json?.data) {
        lastError = json?.error || 'empty stream payload'
        // Don't continue on success=false with 404 — event truly doesn't exist
        if (json?.statusCode === 404 || json?.status_code === 404) {
          throw new Error(`not found: ${uri}`)
        }
        continue
      }
      
      return { data: json.data, usedBase: base }
    } catch (err) {
      lastError = err.message
      continue
    }
  }
  
  return { error: lastError || 'all API domains failed' }
}

export async function resolveStream(input, origin) {
  const parsed = parseInput(input)
  if (parsed.error) return fail('input', parsed.error)

  const { uri, contentPath } = parsed
  const meta = await fetchMeta(uri)
  if (meta.error) return fail('meta', meta.error, { uri, contentPath })

  const source = (meta.data?.sources || []).find((s) => s.default)
  if (!source?.data) return fail('source', 'no default embed source in api response', { uri, contentPath })

  let embed
  try {
    embed = embedFromSource(source)
  } catch (err) {
    return fail('source', String(err.message || err), { uri, contentPath })
  }

  let streamUrl
  try {
    streamUrl = await resolveEmbedStreamUrl(embed)
  } catch (err) {
    return fail('decrypt', String(err.message || err), { uri, contentPath })
  }

  return {
    ok: true,
    uri,
    contentPath,
    streamUrl,
    proxiedUrl: relayUrl(origin, streamUrl, embed),
    resolvedFrom: meta.usedBase,
  }
}