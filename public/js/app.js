const $ = (id) => document.getElementById(id)

const filter = $('filter')
const category = $('category')
const events = $('events')
const eventsContainer = $('events-container')
const out = $('out')
const placeholder = $('placeholder')
const sourceSection = $('source-section')
const sourceList = $('source-list')
const backBtn = $('back-btn')
const closeBtn = $('close-btn')
const refreshBtn = $('refresh-btn')
const statusSeg = $('status-seg')
const title = $('title')
const vid = $('vid')
const err = $('err')
const playerStatus = $('player-status')
const playerStatusText = $('player-status-text')
const fields = {
  direct: $('direct'),
  proxy: $('proxy'),
  vlc: $('vlc'),
  mpv: $('mpv'),
}

// Events with a start time but no end time count as live for this long.
const LIVE_WINDOW_SECS = 4 * 3600
const REFRESH_MS = 5 * 60 * 1000
const RERENDER_MS = 60 * 1000

let hls = null
let allEvents = []
let currentEvent = null
let currentSources = []
let currentUri = null
let currentSrcIdx = -1
let statusFilter = 'live' // live | upcoming | all
let playToken = 0

// API domain failover for frontend
const API_DOMAINS = ['ppv.tj', 'ppvs.pk', 'ppv.rw', 'ppv.ms', 'ppv.bi', 'ppv.ug']

const ANSI_RE = /\x1b\[[0-9;?]*[ -/]*[@-~]/g
const HTML_ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }

function clean(s) {
  return String(s ?? '').replace(ANSI_RE, '')
}

function esc(s) {
  return clean(s).replace(/[&<>"']/g, (c) => HTML_ESC[c])
}

/* ---------- Event state ---------- */

function getState(ev, now = Math.floor(Date.now() / 1000)) {
  if (ev.always_live) return 'live'
  if (!ev.starts_at) return 'info'
  if (ev.ends_at && ev.ends_at < now) return 'ended'
  if (ev.starts_at <= now) {
    if (!ev.ends_at && now - ev.starts_at > LIVE_WINDOW_SECS) return 'ended'
    return 'live'
  }
  if (ev.starts_at - now < 86400) return 'soon'
  return 'info'
}

function formatStart(ev) {
  if (ev.always_live) return 'Always on'
  if (!ev.starts_at) return ''
  const d = new Date(ev.starts_at * 1000)
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function relative(ev, state, now) {
  if (ev.always_live || !ev.starts_at) return ''
  const diff = ev.starts_at - now
  const abs = Math.abs(diff)
  const h = Math.floor(abs / 3600)
  const m = Math.floor((abs % 3600) / 60)
  const span = h ? `${h}h ${m}m` : `${m}m`
  if (state === 'live') return `started ${span} ago`
  if (state === 'soon') return `in ${span}`
  return ''
}

function badgeFor(ev, state) {
  if (ev.always_live) return { cls: 'badge--live badge--247', text: '24/7' }
  if (state === 'live') return { cls: 'badge--live', text: 'LIVE' }
  if (state === 'soon') return { cls: 'badge--soon', text: 'SOON' }
  if (state === 'ended') return { cls: '', text: 'DONE' }
  return { cls: '', text: '' }
}

function matchesStatus(state) {
  if (statusFilter === 'live') return state === 'live'
  if (statusFilter === 'upcoming') return state === 'soon' || state === 'info'
  return true
}

/* ---------- Rendering ---------- */

function setCounts(now) {
  let live = 0
  let upcoming = 0
  for (const ev of allEvents) {
    const s = getState(ev, now)
    if (s === 'live') live++
    else if (s === 'soon' || s === 'info') upcoming++
  }
  $('n-live').textContent = live
  $('n-upcoming').textContent = upcoming
  $('n-all').textContent = allEvents.length
}

function renderEvents() {
  const now = Math.floor(Date.now() / 1000)
  const q = filter.value.trim().toLowerCase()
  const cat = category.value

  setCounts(now)

  const rows = []
  for (const ev of allEvents) {
    if (cat && ev.category_name !== cat) continue
    if (q && !ev.searchable.includes(q)) continue
    const state = getState(ev, now)
    if (!matchesStatus(state)) continue
    rows.push({ ev, state })
  }

  if (rows.length === 0) {
    const hint =
      statusFilter === 'live' && allEvents.length
        ? `<br><button type="button" class="btn" data-show-all>Show all events</button>`
        : ''
    events.innerHTML = `<div class="browser__empty">No ${statusFilter === 'all' ? '' : statusFilter + ' '}events match${hint}</div>`
    events.querySelector('[data-show-all]')?.addEventListener('click', () => setStatus('all'))
    return
  }

  // Sort: live, soon, later, ended — 24/7 channels last. Group headers between.
  const order = { live: 0, soon: 1, info: 2, ended: 3 }
  rows.sort((a, b) => {
    if (a.ev.always_live !== b.ev.always_live) return a.ev.always_live ? 1 : -1
    if (order[a.state] !== order[b.state]) return order[a.state] - order[b.state]
    return a.ev.starts_at - b.ev.starts_at
  })

  const groupOf = ({ ev, state }) =>
    ev.always_live ? '24/7 channels' : state === 'live' ? 'Live now' : state === 'soon' ? 'Starting soon' : state === 'ended' ? 'Ended' : 'Later'

  let lastGroup = null
  const html = []
  for (const row of rows) {
    const g = groupOf(row)
    if (g !== lastGroup) {
      html.push(`<div class="group-label" role="presentation">${g}</div>`)
      lastGroup = g
    }
    const { ev, state } = row
    const badge = badgeFor(ev, state)
    const rel = relative(ev, state, now)
    const subCount = (ev.substreams || []).filter((s) => s.iframe).length
    html.push(`
      <button type="button" class="event${ev.uri === currentUri ? ' is-selected' : ''}" role="listitem" data-uri="${esc(ev.uri)}">
        <span class="badge ${badge.cls}">${badge.text || '&nbsp;'}</span>
        <span class="event__main">
          <span class="event__name" title="${esc(ev.name)}">${esc(ev.name)}</span>
          <span class="event__meta">
            <span>${esc(ev.category_name)}</span>
            ${ev.source_tag ? `<span class="event__dot">${esc(ev.source_tag)}</span>` : ''}
          </span>
        </span>
        <span class="event__side">
          <span>${esc(rel || formatStart(ev))}</span>
          ${subCount > 0 ? `<span class="event__subs">+${subCount} more</span>` : ''}
        </span>
      </button>`)
  }
  events.innerHTML = html.join('')
}

// One delegated handler instead of re-binding on every render.
events.addEventListener('click', (e) => {
  const item = e.target.closest('.event')
  if (item) showSources(item.dataset.uri)
})

function setStatus(next) {
  statusFilter = next
  statusSeg.querySelectorAll('.seg__btn').forEach((b) => {
    const on = b.dataset.status === next
    b.classList.toggle('is-active', on)
    b.setAttribute('aria-pressed', String(on))
  })
  renderEvents()
  events.scrollTop = 0
}

statusSeg.addEventListener('click', (e) => {
  const btn = e.target.closest('.seg__btn')
  if (btn) setStatus(btn.dataset.status)
})

/* ---------- Data ---------- */

async function fetchStreams() {
  let lastErr = null
  for (const domain of API_DOMAINS) {
    try {
      const res = await fetch(`https://api.${domain}/api/streams`)
      if (!res.ok) {
        lastErr = `HTTP ${res.status}`
        continue
      }
      const data = await res.json()
      if (data?.success && data?.streams) return data.streams
      lastErr = data?.error || 'invalid response'
    } catch (e) {
      lastErr = e.message
    }
  }
  throw new Error(lastErr || 'all API domains failed')
}

async function loadEvents({ quiet = false } = {}) {
  if (!quiet) events.innerHTML = '<div class="browser__loading">Loading events…</div>'
  refreshBtn.disabled = true
  refreshBtn.classList.add('is-spinning')
  try {
    const streams = await fetchStreams()
    const next = []
    const cats = new Set()

    streams.forEach((cat) => {
      const catName = cat.category || cat.category_name || '(?)'
      cats.add(catName)
      ;(cat.streams || []).forEach((raw) => {
        const name = clean(raw.name || '?')
        const source = clean(raw.source_tag || '')
        next.push({
          id: Number(raw.id) || 0,
          name,
          tag: raw.tag,
          source_tag: source,
          locale: raw.locale,
          category_name: clean(catName),
          uri: raw.uri_name || '',
          poster: raw.poster,
          starts_at: Number(raw.starts_at) || 0,
          ends_at: Number(raw.ends_at) || 0,
          viewers: Number(raw.viewers) || 0,
          always_live: !!raw.always_live,
          iframe: raw.iframe,
          substreams: raw.substreams || [],
          searchable: `${name} ${source} ${catName}`.toLowerCase(),
        })
      })
    })

    allEvents = next

    const selected = category.value
    const sortedCats = Array.from(cats).map(clean).sort()
    category.innerHTML =
      '<option value="">All categories</option>' +
      sortedCats.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join('')
    if (sortedCats.includes(selected)) category.value = selected

    renderEvents()
  } catch (error) {
    if (quiet && allEvents.length) return // keep showing the last good list
    events.innerHTML = `<div class="browser__error">Failed to load events: ${esc(error.message)}<br><button type="button" class="btn" data-retry>Retry</button></div>`
    events.querySelector('[data-retry]')?.addEventListener('click', () => loadEvents())
  } finally {
    refreshBtn.disabled = false
    refreshBtn.classList.remove('is-spinning')
  }
}

/* ---------- Source picker & playback ---------- */

function showError(message) {
  err.textContent = message
  err.hidden = false
}

function showSources(uri) {
  err.hidden = true

  const event = allEvents.find((ev) => ev.uri === uri)
  if (!event) {
    showError('Event not found — try refreshing the list.')
    return
  }

  currentEvent = event
  currentUri = uri
  currentSrcIdx = -1

  currentSources = []
  if (event.iframe) {
    currentSources.push({
      label: event.source_tag || 'Default',
      locale: event.locale,
      data: event.iframe,
      isDefault: true,
    })
  }
  ;(event.substreams || []).forEach((sub) => {
    if (sub.iframe) {
      currentSources.push({
        label: clean(sub.source_tag || sub.uri_name || 'Stream'),
        locale: sub.locale,
        data: sub.iframe,
        isDefault: false,
      })
    }
  })

  if (currentSources.length === 0) {
    showError('No playable sources found for this event.')
    return
  }

  // Single source: skip the picker and play straight away.
  if (currentSources.length === 1) {
    renderEvents()
    selectSource(0)
    return
  }

  sourceList.innerHTML = `
    <h3 class="source-section__title">${esc(event.name)}</h3>
    <p class="source-section__desc">Choose a source to play (${currentSources.length} available):</p>
    <div class="source-list">
      ${currentSources
        .map(
          (src, idx) => `
        <button type="button" class="source-item${src.isDefault ? ' source-item--default' : ''}" data-idx="${idx}">
          <span class="source-item__label">${esc(src.label)}</span>
          ${src.locale ? `<span class="source-item__locale">${esc(src.locale)}</span>` : ''}
          ${src.isDefault ? '<span class="source-item__badge">default</span>' : ''}
        </button>`,
        )
        .join('')}
    </div>
  `
  sourceSection.hidden = false
  eventsContainer.classList.add('browser--sources')
  sourceList.querySelector('.source-item')?.focus()
}

sourceList.addEventListener('click', (e) => {
  const item = e.target.closest('.source-item')
  if (item) selectSource(parseInt(item.dataset.idx, 10))
})

function showList() {
  sourceSection.hidden = true
  eventsContainer.classList.remove('browser--sources')
  renderEvents()
}

function selectSource(idx) {
  const src = currentSources[idx]
  if (!src) return

  currentSrcIdx = idx
  sourceSection.hidden = true
  eventsContainer.classList.remove('browser--sources')
  out.hidden = false
  placeholder.classList.add('is-hidden')
  title.textContent = `${currentEvent.name}${src.locale ? ` [${src.locale}]` : ''}`
  renderEvents()

  // On narrow screens the player stacks below the list — bring it into view.
  if (window.matchMedia('(max-width: 1099px)').matches) {
    out.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  resolveAndPlay(src.data)
}

function setPlayerStatus(text) {
  playerStatus.hidden = !text
  if (text) playerStatusText.textContent = text
}

async function resolveAndPlay(iframeUrl) {
  const token = ++playToken
  err.hidden = true
  stop()
  setPlayerStatus('Resolving stream…')
  Object.values(fields).forEach((f) => (f.value = ''))

  try {
    const res = await fetch('/api/embed', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ iframe: iframeUrl }),
    })
    const data = await res.json()
    if (token !== playToken) return // superseded by a newer selection
    if (!data.ok) throw new Error(`${data.stage || 'error'}: ${data.error || 'resolve failed'}`)
    if (!data.streamUrl || !data.proxiedUrl) throw new Error('missing stream URLs in response')

    fields.direct.value = data.streamUrl
    fields.proxy.value = data.proxiedUrl
    fields.vlc.value = vlc(data.proxiedUrl)
    fields.mpv.value = mpv(data.proxiedUrl, data.embed)

    setPlayerStatus('Loading video…')
    await play(data.proxiedUrl, token)
    if (token === playToken) setPlayerStatus('')
  } catch (error) {
    if (token !== playToken) return
    setPlayerStatus('')
    showError(error.message)
    // Keep the export links visible if we got that far; otherwise hide the panel.
    if (!fields.proxy.value) out.hidden = true
    if (out.hidden) placeholder.classList.remove('is-hidden')
  }
}

function vlc(url) {
  return `vlc "${url}"`
}

function mpv(url, name) {
  if (!name) return `mpv "${url}"`
  return `mpv --force-media-title="${String(name).replace(/"/g, '\\"')}" "${url}"`
}

function stop() {
  if (hls) {
    hls.destroy()
    hls = null
  }
  vid.pause()
  vid.removeAttribute('src')
  vid.load()
}

async function play(url, token) {
  const { default: Hls } = await import('https://cdn.jsdelivr.net/npm/hls.js@1.5.20/+esm')
  if (token !== playToken) return
  if (!Hls.isSupported()) {
    throw new Error('HLS playback is not supported in this browser. Use VLC or MPV.')
  }
  hls = new Hls()
  const instance = hls
  instance.loadSource(url)
  instance.attachMedia(vid)
  await new Promise((resolve, reject) => {
    instance.on(Hls.Events.MANIFEST_PARSED, resolve)
    instance.on(Hls.Events.ERROR, (_, data) => {
      if (data.fatal) reject(new Error('playback failed — try another source'))
    })
  })
  if (token !== playToken) return
  await vid.play().catch(() => {})
}

/* ---------- Clipboard ---------- */

/**
 * Copy text to clipboard with a fallback for insecure contexts (plain HTTP on
 * a LAN IP), where navigator.clipboard is undefined.
 * @returns {Promise<boolean>} true if the copy succeeded
 */
async function copyToClipboard(text, node = null) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      // fall through to execCommand fallback
    }
  }

  let tmp = null
  if (!node) {
    tmp = document.createElement('textarea')
    tmp.value = text
    tmp.setAttribute('readonly', '')
    tmp.style.cssText = 'position:fixed;top:0;left:-9999px;opacity:0;'
    document.body.appendChild(tmp)
    node = tmp
  }
  node.focus()
  node.select()
  if (node.setSelectionRange) node.setSelectionRange(0, text.length)
  let ok = false
  try {
    ok = document.execCommand('copy')
  } catch {
    ok = false
  }
  if (tmp) tmp.remove()
  return ok
}

function flash(btn, text, cls, ms) {
  const label = btn.dataset.label ?? btn.textContent
  btn.dataset.label = label
  btn.textContent = text
  btn.classList.add(cls)
  setTimeout(() => {
    btn.textContent = label
    btn.classList.remove(cls)
    delete btn.dataset.label
  }, ms)
}

document.querySelectorAll('[data-copy]').forEach((btn) => {
  btn.addEventListener('click', async () => {
    const node = $(btn.dataset.copy)
    if (!node.value) return
    const copied = await copyToClipboard(node.value, node)
    if (copied) flash(btn, 'Copied', 'ok', 1200)
    else flash(btn, 'Failed', 'err', 1500)
  })
})

/* ---------- Wiring ---------- */

backBtn.addEventListener('click', showList)

closeBtn.addEventListener('click', () => {
  playToken++
  stop()
  setPlayerStatus('')
  out.hidden = true
  placeholder.classList.remove('is-hidden')
  currentUri = null
  err.hidden = true
  renderEvents()
})

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !sourceSection.hidden) showList()
})

refreshBtn.addEventListener('click', () => loadEvents({ quiet: true }))
filter.addEventListener('input', renderEvents)
category.addEventListener('change', renderEvents)

// Copy playlist URL to clipboard
const copyPlaylistBtn = $('copy-playlist-btn')
const copyPlaylistLabel = copyPlaylistBtn.querySelector('.btn__label')
copyPlaylistBtn.addEventListener('click', async () => {
  const url = `${location.origin}/playlist.m3u8`
  const copied = await copyToClipboard(url)
  if (copied) {
    copyPlaylistLabel.textContent = 'Copied!'
    copyPlaylistBtn.classList.add('btn--copied')
    setTimeout(() => {
      copyPlaylistLabel.textContent = 'Copy URL'
      copyPlaylistBtn.classList.remove('btn--copied')
    }, 1500)
  } else {
    prompt('Copy this playlist URL:', url)
  }
})

// Keep LIVE/SOON badges honest and pick up new events without a manual reload.
setInterval(() => {
  if (!document.hidden) renderEvents()
}, RERENDER_MS)
setInterval(() => {
  if (!document.hidden) loadEvents({ quiet: true })
}, REFRESH_MS)

loadEvents()
