# PPV HLS Stream Resolver

> 🎬 Node.js resolver for **ppv.s\*\*** live streams with a browser-based event explorer and HLS proxy.

[![Node.js](https://img.shields.io/badge/Node.js-18%2B-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![License](https://img.shields.io/badge/License-MIT-blue.svg)](#disclaimer)
[![Docker](https://img.shields.io/badge/Docker-ready-2496ED?logo=docker&logoColor=white)](#-docker)

Fetches stream metadata from the public API, replays the `pooembed /fetch` protobuf handshake, runs the embed WASM decryptor, and proxies HLS playback — all behind a clean, responsive browser UI.

**Based on:** [sharoon7171/ppv-hls-stream-resolver](https://github.com/sharoon7171/ppv-hls-stream-resolver)

---

## ✨ Features

| | |
|---|---|
| 📺 **Event Browser UI** | Browse all live events with category filters and full-text search |
| 🎛️ **Substream Selection** | Pick from multiple broadcast sources per event (FOX, BBC, DAZN, …) |
| 🟢 **Real-Time Status** | `LIVE` / `SOON` / `DONE` / `24/7` badges driven by event timestamps |
| ▶️ **In-Browser Playback** | HLS.js integration for Chrome, Firefox, and Edge |
| 📋 **Export Commands** | One-click copy for direct URLs, VLC, and MPV |
| 📱 **Responsive Design** | Two-column desktop layout, single-column mobile |
| 🔁 **API Failover** | Automatic domain failover chain across 5 mirrors |
|📻 **Dynamic IPTV M3U8 Playlist** | Serves standard IPTV playlists (GET /playlist.m3u8) compatible with VLC, TiviMate, Kodi, IPTV Smarters, Dispatcharr, and Jellyfin. |

**Live demo:** browse at `http://localhost:3000/` after starting the server.

---

## 🏗️ Architecture

### Overview

```
┌──────────────────────────────────────────────────────────────────┐
│                     Browser UI  (port 3000)                      │
│  ┌────────────┐   ┌─────────────┐   ┌────────────────────────┐   │
│  │ Event List │ → │ Source Pick │ → │ Player + Export        │   │
│  │ + Filters  │   │ (substreams)│   │ (VLC / MPV commands)   │   │
│  └────────────┘   └─────────────┘   └────────────────────────┘   │
└──────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────────┐
│                     Backend API  (Node.js)                       │
│   POST /api/stream  →  ppv.s.. URL → embed → HLS                 │
│   POST /api/embed   →  embed URL directly (substreams)           │
│   GET  /api/hls     →  proxy HLS playlist + segments             │
└──────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────────┐
│                      External Services                           │
│   api.ppv.s..     →  event index + substream metadata            │
│   embedindia.s..  →  /fetch handshake + WASM decrypt             │
│   CDN             →  actual .m3u8 + .ts segments                 │
└──────────────────────────────────────────────────────────────────┘
```

### Request Flow

1. **User opens browser** → frontend fetches the event index.
2. **User clicks event** → substream picker shown (default + extras).
3. **User selects source** → `POST /api/embed` with iframe URL.
4. **Backend decrypts** → `/fetch` handshake → WASM → HLS URL.
5. **Frontend plays** → HLS.js loads proxied URL, or user copies to VLC/MPV.

---

## 🚀 Quick Start

### Prerequisites

- **Node.js 18+** (requires native `fetch`)
- npm or pnpm

### Local Install

```bash
git clone https://github.com/Lunatic16/ppv-hls-proxy.git
cd ppv-hls-proxy
npm install
npm start
```

Server starts at `http://localhost:3000/` (or `$PORT`).

### 🐳 Docker

**Docker Run**

```bash
docker build -t ppv-hls-proxy .
docker run -d --name ppv-hls-proxy -p 3000:3000 ppv-hls-proxy
```

**Docker Compose**

```bash
cp .env.example .env
# edit .env as needed
docker compose up -d
```

### Usage

1. Open `http://localhost:3000/`
2. Filter by category or search text
3. Click an event → choose a broadcaster
4. Play in-browser or copy the VLC/MPV command

**Mobile:** the UI collapses to a single column, copy buttons use a `document.execCommand('copy')` fallback, and Safari uses native HLS while Android Chrome falls back to HLS.js.

---

## 📡 API Reference

### `POST /api/stream`

Resolve a `ppv.st` live URL using the default embed source.

<details>
<summary><b>Request</b></summary>

```json
{
  "url": "https://ppv.s../l../wc/2026-07-02/p..."
}
```
</details>

<details>
<summary><b>Response (200 OK)</b></summary>

```json
{
  "ok": true,
  "uri": "wc/2026-07-02/...o",
  "contentPath": "/live/wc/2026-07-02/...",
  "streamUrl": "https://cdn.example/secure/.../index.m3u8",
  "proxiedUrl": "http://localhost:3000/api/hls?url=...&embed=...&embedOrigin=..."
}
```
</details>

<details>
<summary><b>Error response</b></summary>

```json
{
  "ok": false,
  "stage": "meta",
  "error": "upstream 404",
  "uri": "...",
  "contentPath": "..."
}
```

**Stages:** `input` · `meta` · `source` · `decrypt`
</details>

---

### `POST /api/embed` <sub>`NEW`</sub>

Resolve an **embed URL directly** — used for substreams that have their own embed URLs in the index API.

<details>
<summary><b>Request</b></summary>

```json
{
  "iframe": "https://embedindia.s../embed/wc/2026-07-02/por-cro/fox"
}
```
</details>

<details>
<summary><b>Response</b></summary>

```json
{
  "ok": true,
  "streamUrl": "https://cdn.example/secure/.../FOX/index.m3u8",
  "proxiedUrl": "http://localhost:3000/api/hls?url=...&embed=...&embedOrigin=...",
  "embed": "wc/2026-07-02/por-cro/fox",
  "embedOrigin": "https://embedindia.s.."
}
```
</details>

> ℹ️ Use this endpoint for **substreams** — `/api/stream` only handles the default source.

---

### `GET /api/hls`

Proxy HLS playlists and segments through your server.

| Parameter     | Required | Description                         |
|---------------|:--------:|-------------------------------------|
| `url`         |    ✅    | Absolute upstream URL (`.m3u8`/`.ts`) |
| `embed`       |    ✅    | Embed path from resolve response    |
| `embedOrigin` |    ✅    | Embed origin from resolve response  |

**Response content types**

- `application/vnd.apple.mpegurl` — rewritten M3U8 playlists
- `video/mp2t` — TS segments
- `502 text/plain` — upstream failure

**CORS:** all endpoints return `Access-Control-Allow-Origin: *`.

---

## 🎨 Frontend UI

### Layout

- **Wide screens (≥1200px)** — left column: event browser (sticky); right column: player + exports (sticky).
- **Mobile / tablet (<1200px)** — single-column stack: events → source picker → player.

### Event Browser

Displays events with status badges, name, source, start time, category, and a `+N more` indicator for extra substreams. Includes a category dropdown and live text search.

### Source Picker

Clicking an event collapses the list and shows all available sources:

- Broadcaster name (FOX, BBC One, DAZN Spain, …)
- Locale (`en`, `en-GB`, `es`, …)
- `default` badge for the primary source

### Export Section

After selecting a source, you get:

- **Direct URL** — upstream M3U8 (VLC/MPV)
- **Proxied URL** — routed through this server (browser)
- **VLC** / **MPV** commands

…each with a mobile-aware **Copy** button.

---

## 📺New IPTV Playlist Feature

Two new endpoints for use with VLC, TiviMate, Kodi, IPTV Smarters, Dispatcharr, and Jellyfin, or any M3U-compatible player:

### GET `/playlist.m3u8`

Dynamically generates a full M3U playlist with all available channels. Each entry includes:

* `tvg-id` — unique channel identifier
* `tvg-name` — channel display name
* `tvg-logo` — channel poster/thumbnail
* `group-title` — sport category for channel grouping

> **Optional filter:** `?category=Ice+Hockey` to get only a specific category.

### GET `/live/<uri>.m3u8`

Per-channel endpoint that resolves the embed + WASM decrypt on-the-fly and relays the HLS stream. This is what the IPTV player hits when you tune to a channel — no pre-resolution needed, URLs are resolved fresh each time.

### How to use in TiviMate

1. Add a new playlist → **M3U Playlist**
2. Enter URL: `http://<your-server-ip>:3000/playlist.m3u8`
3. All 77 channels appear grouped by sport, with logos and substreams as separate entries

---

## 🔐 How Decryption Works

### 1. Embed source extraction

```
https://embedindia.s../embed/wc/2026-07-02/por-cro
  → { origin: "https://embedindia.s..", path: "wc/2026-07-02/por-cro" }
```

### 2. `/fetch` handshake

```
POST {origin}/fetch
Content-Type: application/octet-stream
Origin:       {origin}
Referer:      {origin}/embed/{path}
Body:         length-prefixed protobuf encoding of {path}
```

Response carries an `island` header (session key) and a protobuf body.

### 3. WASM decryption (`gasm.wasm`)

Runs in a `happy-dom` sandbox with stubbed `jwplayer` / `fetch`. `set_stream_jw(island, body)` mutates WASM memory, and the playlist URL is recovered by scanning for:

```
https://{host}/secure/{...}index.m3u8
```

A protobuf slug selects the correct URL when multiple matches exist.

### 4. Relay / Proxy

The resolved M3U8 plays directly in VLC/MPV. Browser playback requires proxying:

- **M3U8 rewrite** — media URIs remapped to `/api/hls?...`
- **Segment proxy** — strips non-TS wrapper bytes, returns `video/mp2t`
- **CORS** — headers added for browser access

---

## 🗺️ Code Map

```
src/
  server.js              # HTTP server boot
  env.js                 # PORT, API_BASE, USER_AGENT
  http/
    route.js             # /api/hls, /api/stream, /api/embed, static
    respond.js           # json, text, readBody helpers
    static.js            # Serve public assets
  resolve/
    stream.js            # resolveStream() — metadata → embed → HLS
  relay/
    hls.js               # relayHls() — fetch, playlist vs segment
    rewrite.js           # rewritePlaylist(), syncLiveMediaPlaylist()
    segment.js           # segmentBody() — TS payload strip
  playlist/
    iptv.js              # New module — playlist generation + per-channel resolution
  embed/
    context.js           # embedFromSource(), relayUrl()
    decrypt.js           # resolveEmbedStreamUrl() — /fetch + WASM
    media.js             # isM3u8Resource(), isPoisonPlaylist(), ...
    upstream.js          # upstreamFetch() — impit client
    wasm/
      gasm.js            # WASM loader
      gasm.wasm          # Decryptor binary

public/
  index.html             # UI shell
  css/app.css            # Dark theme, responsive layout
  js/app.js              # Event browser, source picker, HLS.js
```

---

## ⚙️ Configuration

### Environment Variables

| Variable | Default | Description                      |
|----------|---------|----------------------------------|
| `PORT`   | `3000`  | HTTP listen port                 |
| `HOST`   | all     | Bind address (e.g. `127.0.0.1`)  |

### API Domain Failover

The backend walks a mirror chain when the primary API fails:

1. `api.ppv.s..` *(primary)*
2. `api.ppv.c..`
3. `api.ppv.t..`
4. `api.ppv.i..`
5. `api.ppv.l..`

Each request independently walks the chain and reports `resolvedFrom` in the response. The frontend implements the same failover when loading the event index, logging the active domain to the console.

> Hardcoded in `src/env.js` → `API_DOMAINS`.

### User Agent

Set in `src/env.js` — mimics Chrome on macOS to avoid bot detection.

---

## 📱 Mobile Support

### Copy Button Fallback

Mobile browsers (especially iOS Safari) may block `navigator.clipboard.writeText()`:

1. Try `navigator.clipboard.writeText()`.
2. On failure, select the input text and run `document.execCommand('copy')`.
3. User sees the text selected and can tap **Copy** from the context menu.

### Layout Adaptations

- Single-column below 1200px
- Touch-friendly button sizes
- Native `<video>` controls
- Mobile-optimized keyboard types for filters

### HLS Playback Matrix

| Platform               | Engine              |
|------------------------|---------------------|
| iOS Safari             | Native HLS          |
| Android Chrome         | HLS.js → native     |
| Desktop Chrome/Firefox | HLS.js (bundled)    |

---

## ⚠️ Disclaimer

This project:

- Does **not** host, store, or distribute media content.
- Only reads **public API metadata**.
- Calls embed endpoints the same way a browser player would.
- Proxies streams for browser compatibility (like a CORS proxy).

**You are responsible for:**

- Complying with copyright law in your jurisdiction.
- Respecting site terms of service.
- Using only on content you have the right to access.

**No warranty.** Use at your own risk.
