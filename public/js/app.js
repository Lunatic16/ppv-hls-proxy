const $ = (id) => document.getElementById(id)

const filter = $('filter')
const category = $('category')
const events = $('events')
const eventsContainer = $('events-container')
const out = $('out')
const sourceSection = $('source-section')
const sourceList = $('source-list')
const backBtn = $('back-btn')
const title = $('title')
const vid = $('vid')
const err = $('err')
const fields = {
  direct: $('direct'),
  proxy: $('proxy'),
  vlc: $('vlc'),
  mpv: $('mpv'),
}

let hls = null
let allEvents = []
let categories = new Set()
let currentEvent = null
let currentSources = []

// API domain failover for frontend
const API_DOMAINS = ['ppv.st', 'ppv.cx', 'ppv.to', 'ppv.is', 'ppv.lc']
let currentApiDomain = API_DOMAINS[0]

const ANSI_RE = /\x1b\[[0-9;?]*[ -/]*[@-~]/g

function stripAnsi(s) {
  return s.replace(ANSI_RE, '')
}

function formatTime(unixTs, endsAt = 0) {
  if (!unixTs) return { text: '—', state: 'info' }
  const now = Math.floor(Date.now() / 1000)
  let state
  if (endsAt && endsAt < now) state = 'ended'
  else if (unixTs <= now) state = 'live'
  else if (unixTs - now < 86400) state = 'soon'
  else state = 'info'
  
  const d = new Date(unixTs * 1000)
  const txt = d.toLocaleString('en-US', { 
    month: 'short', day: '2-digit', 
    hour: '2-digit', minute: '2-digit',
    timeZoneName: 'short'
  })
  return { text: txt, state }
}

function renderEvent(ev) {
  const { text, state } = formatTime(ev.starts_at, ev.ends_at)
  
  let badge, badgeText
  if (ev.always_live) { badge = 'badge--live'; badgeText = '24/7' }
  else if (state === 'live') { badge = 'badge--live'; badgeText = 'LIVE' }
  else if (state === 'soon') { badge = 'badge--soon'; badgeText = 'SOON' }
  else if (state === 'ended') { badge = 'badge'; badgeText = 'DONE' }
  else { badge = 'badge'; badgeText = '' }
  
  const source = ev.source_tag || ''
  const cat = ev.category_name || ''
  
  const substreamCount = (ev.substreams || []).length
  
  return {
    raw: ev,
    text: `${badgeText}  ${ev.name}  ${source}  ${text}  ${cat}`,
    searchable: `${ev.name} ${source} ${cat}`.toLowerCase(),
    state,
    substreamCount
  }
}

function renderEvents() {
  const q = filter.value.toLowerCase()
  const cat = category.value
  
  const filtered = allEvents.filter(ev => {
    if (cat && ev.raw.category_name !== cat) return false
    if (q && !ev.searchable.includes(q)) return false
    return true
  })
  
  // No additional sort needed - already sorted in loadEvents()
  
  if (filtered.length === 0) {
    events.innerHTML = '<div class="browser__empty">No events match your filter</div>'
    return
  }
  
  events.innerHTML = filtered.map(ev => {
    const badgeClass = ev.raw.always_live ? 'badge--live' : 
                       ev.state === 'live' ? 'badge--live' :
                       ev.state === 'soon' ? 'badge--soon' : 'badge'
    const badgeText = ev.raw.always_live ? '24/7' : 
                      ev.state === 'live' ? 'LIVE' : 
                      ev.state === 'soon' ? 'SOON' : 
                      ev.state === 'ended' ? 'DONE' : ''
    const subHint = ev.substreamCount > 0 ? `<span class="browser__subs">+${ev.substreamCount} more</span>` : ''
    return `
      <div class="browser__item" data-uri="${ev.raw.uri}">
        <span class="badge ${badgeClass}">${badgeText}</span>
        <span class="browser__name">${stripAnsi(ev.raw.name)}</span>
        <span class="browser__source">${stripAnsi(ev.raw.source_tag || '')}</span>
        <span class="browser__time">${ev.text}</span>
        <span class="browser__cat">${stripAnsi(ev.raw.category_name || '')}</span>
        ${subHint}
      </div>
    `
  }).join('')
  
  events.querySelectorAll('.browser__item').forEach(item => {
    item.addEventListener('click', () => showSources(item.dataset.uri))
  })
}

async function loadEvents() {
  events.innerHTML = '<div class="browser__loading">Loading events…</div>'
  try {
    let data = null
    let lastErr = null
    
    // Try each API domain in order
    for (const domain of API_DOMAINS) {
      const apiBase = `https://api.${domain}/api`
      try {
        const res = await fetch(`${apiBase}/streams`)
        if (!res.ok) {
          lastErr = `HTTP ${res.status}`
          continue
        }
        data = await res.json()
        if (data?.success && data?.streams) {
          currentApiDomain = domain
          break
        }
        lastErr = data?.error || 'invalid response'
      } catch (e) {
        lastErr = e.message
        continue
      }
    }
    
    if (!data || !data.success) throw new Error(data?.error || lastErr || 'API returned success=false')
    
    const streams = data.streams || []
        allEvents = []
        categories = new Set()
    
        console.log(`Using API domain: api.${currentApiDomain}`)

        streams.forEach(cat => {
      const catName = cat.category || cat.category_name || '(?)'
      categories.add(catName)
      ;(cat.streams || []).forEach(raw => {
        allEvents.push({
          id: Number(raw.id) || 0,
          name: raw.name || '?',
          tag: raw.tag,
          source_tag: raw.source_tag,
          locale: raw.locale,
          category_name: catName,
          uri: raw.uri_name || '',
          poster: raw.poster,
          starts_at: Number(raw.starts_at) || 0,
          ends_at: Number(raw.ends_at) || 0,
          viewers: Number(raw.viewers) || 0,
          always_live: !!raw.always_live,
          iframe: raw.iframe,
          substreams: raw.substreams || []
        })
      })
    })
    
    const sortedCats = Array.from(categories).sort()
    category.innerHTML = '<option value="">All Categories</option>' + 
      sortedCats.map(c => `<option value="${c}">${c}</option>`).join('')
    
    // Sort: LIVE first, SOON next, then by start time, 24/7 always at bottom
    allEvents.sort((a, b) => {
      // 24/7 events ALWAYS at bottom, regardless of state
      if (a.always_live && !b.always_live) return 1
      if (!a.always_live && b.always_live) return -1
      
      // For non-24/7 events: LIVE before SOON before others
      const aState = formatTime(a.starts_at, a.ends_at).state
      const bState = formatTime(b.starts_at, b.ends_at).state
      const stateOrder = { live: 0, soon: 1, info: 2, ended: 3 }
      
      if (stateOrder[aState] !== stateOrder[bState]) {
        return stateOrder[aState] - stateOrder[bState]
      }
      
      // Within same state, sort by start time
      return a.starts_at - b.starts_at
    })
    
    console.log(`Sorted ${allEvents.length} events. 24/7 count: ${allEvents.filter(e => e.always_live).length}`)
    console.log('First 3 events (names + always_live):', JSON.stringify(allEvents.slice(0, 3).map(e => ({ name: e.name.substring(0, 25), always_live: e.always_live }))))
    console.log('Last 3 events (names + always_live):', JSON.stringify(allEvents.slice(-3).map(e => ({ name: e.name.substring(0, 25), always_live: e.always_live }))))
    
    const rendered = allEvents.map(renderEvent)
    allEvents = rendered
    
    renderEvents()
  } catch (error) {
    events.innerHTML = `<div class="browser__error">Failed to load events: ${error.message}</div>`
  }
}

async function showSources(uri) {
  err.hidden = true
  out.hidden = true
  sourceSection.hidden = false
  sourceList.innerHTML = '<div class="browser__loading">Loading sources…</div>'
  eventsContainer.classList.add('browser--sources')
  
  try {
    // Find the event in our cached data (which has substreams from the index)
    const event = allEvents.find(ev => ev.raw.uri === uri)
    if (!event) throw new Error('Event not found')
    
    const raw = event.raw
    currentEvent = raw
    
    // Build sources list: default iframe + substreams
    currentSources = []
    
    // Add default source if exists
    if (raw.iframe) {
      currentSources.push({
        label: raw.source_tag || 'Default',
        locale: raw.locale,
        data: raw.iframe,
        isDefault: true
      })
    }
    
    // Add substreams
    ;(raw.substreams || []).forEach(sub => {
      if (sub.iframe) {
        currentSources.push({
          label: sub.source_tag || sub.uri_name || 'Stream',
          locale: sub.locale,
          data: sub.iframe,
          isDefault: false
        })
      }
    })
    
    if (currentSources.length === 0) {
      throw new Error('No playable sources found')
    }
    
    // Render source list
    sourceList.innerHTML = `
      <h3 class="source-section__title">${stripAnsi(raw.name)}</h3>
      <p class="source-section__desc">Select a source to play:</p>
      <div class="source-list">
        ${currentSources.map((src, idx) => `
          <div class="source-item ${src.isDefault ? 'source-item--default' : ''}" data-idx="${idx}">
            <span class="source-item__label">${stripAnsi(src.label)}</span>
            ${src.locale ? `<span class="source-item__locale">${stripAnsi(src.locale)}</span>` : ''}
            ${src.isDefault ? '<span class="source-item__badge">default</span>' : ''}
          </div>
        `).join('')}
      </div>
    `
    
    // Add click handlers
    sourceList.querySelectorAll('.source-item').forEach(item => {
      item.addEventListener('click', () => {
        const idx = parseInt(item.dataset.idx, 10)
        selectSource(idx)
      })
    })
    
  } catch (error) {
    err.textContent = error.message
    err.hidden = false
    sourceSection.hidden = true
    eventsContainer.classList.remove('browser--sources')
  }
}

function selectSource(idx) {
  const src = currentSources[idx]
  if (!src) return
  
  sourceSection.hidden = true
  // Keep events collapsed - don't remove browser--sources class
  out.hidden = false
  title.textContent = `${currentEvent.name}${src.locale ? ` [${src.locale}]` : ''}`
  
  // Use the proxy resolver with the iframe URL
  resolveAndPlay(src.data)
}

async function resolveAndPlay(iframeUrl) {
  err.hidden = true
  
  try {
    // Use the embed endpoint which handles iframe URLs directly
    const res = await fetch('/api/embed', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ iframe: iframeUrl }),
    })
    const data = await res.json()
    if (!data.ok) throw new Error(`${data.stage || 'error'}: ${data.error || 'resolve failed'}`)
    if (!data.streamUrl || !data.proxiedUrl) throw new Error('missing stream URLs in response')
    
    try {
      await stop() // Stop any existing playback before starting new one
    } catch (e) {
      console.warn('Error stopping previous playback:', e)
    }

    fields.direct.value = data.streamUrl
    fields.proxy.value = data.proxiedUrl
    fields.vlc.value = vlc(data.proxiedUrl)
    fields.mpv.value = mpv(data.proxiedUrl, data.embed)
    await play(data.proxiedUrl)

  } catch (error) {
    err.textContent = error.message
    err.hidden = false
    out.hidden = true
  }
}

function vlc(url) {
  return `vlc "${url}"`
}

function mpv(url, name) {
  if (!name) return `mpv "${url}"`
  return `mpv --force-media-title="${name.replace(/"/g, '\\"')}" "${url}"`
}

function stop() {
  if (hls) {
    hls.destroy()
    hls = null
  }
  vid.removeAttribute('src')
  vid.load()
}

async function play(url) {
  stop()
  const { default: Hls } = await import('https://cdn.jsdelivr.net/npm/hls.js@1.5.20/+esm')
  if (!Hls.isSupported()) {
    throw new Error('HLS playback is not supported in this browser. Use VLC or MPV.')
  }
  hls = new Hls()
  hls.loadSource(url)
  hls.attachMedia(vid)
  await new Promise((resolve, reject) => {
    hls.on(Hls.Events.MANIFEST_PARSED, resolve)
    hls.on(Hls.Events.ERROR, (_, data) => {
      if (data.fatal) reject(new Error('playback failed'))
    })
  })
  await vid.play().catch(() => {})
}

document.querySelectorAll('[data-copy]').forEach((btn) => {
  btn.addEventListener('click', async () => {
    const node = $(btn.dataset.copy)
    const text = node.value
    
    // Try clipboard API first
    try {
      await navigator.clipboard.writeText(text)
      showCopied(btn)
      return
    } catch (err) {
      // Fallback: select text in input
      node.select()
      node.setSelectionRange(0, 99999) // Mobile Safari support
      try {
        document.execCommand('copy')
        showCopied(btn)
      } catch (err2) {
        btn.textContent = 'Failed'
        btn.classList.add('err')
        setTimeout(() => {
          btn.textContent = 'Copy'
          btn.classList.remove('err')
        }, 1500)
      }
    }
  })
})

function showCopied(btn) {
  const label = btn.textContent
  btn.textContent = 'Copied'
  btn.classList.add('ok')
  setTimeout(() => {
    btn.textContent = label
    btn.classList.remove('ok')
  }, 1200)
}

backBtn.addEventListener('click', () => {
  sourceSection.hidden = true
  eventsContainer.classList.remove('browser--sources')
  out.hidden = true
  //stop()
})

filter.addEventListener('input', renderEvents)
category.addEventListener('change', renderEvents)

loadEvents()