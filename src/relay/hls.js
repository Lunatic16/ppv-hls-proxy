import { isM3u8Resource } from '../embed/media.js'
import { upstreamFetch } from '../embed/upstream.js'
import { rewritePlaylist } from './rewrite.js'
import { segmentBody } from './segment.js'

const cors = {
  'Cache-Control': 'no-store, no-cache, must-revalidate',
  'Access-Control-Allow-Origin': '*',
}

const segHdr = () => ({ ...cors, 'Content-Type': 'video/mp2t' })

function isPlaylist(url, type, body) {
  const head = body.toString('utf8', 0, Math.min(body.length, 256))
  if (head.includes('#EXTM3U')) return true
  return isM3u8Resource(url, type) || (type.includes('text/plain') && head.includes('#EXT'))
}

async function relaySeg(url, embed) {
  const up = await upstreamFetch(url, embed)
  return { status: 200, headers: segHdr(), body: segmentBody(up.body) }
}

async function relayReq(url, embed, origin) {
  if (!isM3u8Resource(url)) return relaySeg(url, embed)

  const up = await upstreamFetch(url, embed)
  if (isPlaylist(url, up.contentType, up.body)) {
    return {
      status: 200,
      headers: { ...cors, 'Content-Type': 'application/vnd.apple.mpegurl' },
      body: rewritePlaylist(up.body.toString('utf8'), url, embed, origin),
    }
  }
  return { status: 200, headers: segHdr(), body: segmentBody(up.body) }
}

export async function relayHls(res, url, embed, origin) {
  const out = await relayReq(url, embed, origin)
  if (res.headersSent) return
  res.writeHead(out.status, out.headers)
  res.end(out.body)
}
