import { embedFromQuery, embedFromSource } from '../embed/context.js'
import { relayHls } from '../relay/hls.js'
import { resolveStream } from '../resolve/stream.js'
import { resolveEmbedStreamUrl } from '../embed/decrypt.js'
import { json, readBody, text } from './respond.js'
import { serveStatic } from './static.js'

export async function onReq(req, res) {
  if (!req.headers.host) return text(res, 400, 'missing host')

  const loc = new URL(req.url ?? '/', `http://${req.headers.host}`)
  const { pathname, searchParams, origin } = loc

  try {
    if (pathname === '/api/hls') {
      const target = searchParams.get('url')
      if (!target) return json(res, 400, { error: 'url required' })
      try {
        await relayHls(res, target, embedFromQuery(searchParams), origin)
      } catch (err) {
        text(res, 502, String(err.message || 'upstream error'))
      }
      return
    }

    if (pathname === '/api/stream') {
      if (req.method !== 'POST') return json(res, 405, { error: 'POST required' })
      return json(res, 200, await resolveStream(await readBody(req).catch(() => null), origin))
    }

    // New endpoint: resolve an embed URL directly (for substreams)
    if (pathname === '/api/embed') {
      if (req.method !== 'POST') return json(res, 405, { error: 'POST required' })
      const body = await readBody(req).catch(() => null)
      const iframeUrl = body?.iframe
      if (!iframeUrl) return json(res, 400, { error: 'iframe url required' })
      
      try {
        const embed = embedFromSource({ data: iframeUrl })
        const streamUrl = await resolveEmbedStreamUrl(embed)
        const proxiedUrl = `${origin}/api/hls?url=${encodeURIComponent(streamUrl)}&embed=${encodeURIComponent(embed.path)}&embedOrigin=${encodeURIComponent(embed.origin)}`
        return json(res, 200, {
          ok: true,
          streamUrl,
          proxiedUrl,
          embed: embed.path,
          embedOrigin: embed.origin,
        })
      } catch (err) {
        return json(res, 500, { ok: false, stage: 'decrypt', error: String(err.message || err) })
      }
    }

    if (serveStatic(pathname, res)) return
    text(res, 404, 'not found')
  } catch (err) {
    json(res, 500, { ok: false, error: String(err.message || err) })
  }
}