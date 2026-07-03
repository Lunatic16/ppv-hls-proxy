import { Impit } from 'impit'
import { USER_AGENT } from '../env.js'
import { isPoisonPlaylist, okBody } from './media.js'

let client = null

const TIMEOUT = 120000

function impit() {
  if (!client) client = new Impit({ browser: 'chrome', timeout: TIMEOUT })
  return client
}

function headers(embed) {
  return {
    Referer: `${embed.origin}/embed/${embed.path}`,
    Origin: embed.origin,
    'User-Agent': USER_AGENT,
    Accept: '*/*',
  }
}

export async function upstreamFetch(url, embed) {
  const res = await impit().fetch(url, {
    headers: headers(embed),
    redirect: 'follow',
    timeout: TIMEOUT,
  })
  const body = Buffer.from(await res.arrayBuffer())
  if (res.status >= 200 && res.status < 300 && okBody(body, url)) {
    return { contentType: res.headers.get('content-type') || '', body }
  }
  if (isPoisonPlaylist(body)) throw new Error('upstream playlist blocked')
  throw new Error(`upstream ${res.status}`)
}
