# PPV HLS Stream Resolver

**Based on:** [sharoon7171/ppv-hls-stream-resolver](https://github.com/sharoon7171/ppv-hls-stream-resolver)

Node.js resolver for ppv.st live streams with a browser-based event browser UI. Fetches stream metadata from the public API, replays the pooembed `/fetch` protobuf handshake, runs the embed WASM decryptor, and proxies HLS playback.

**This fork adds:**
- Event browser UI with category/text filtering
- Substream selection (multiple sources per event)
- API domain failover chain (ppv.s.. → ppv.c.. → ppv.t.. → ppv.i.. → ppv.l..)
- Two-column responsive layout (events left, player right on wide screens)
- Mobile clipboard fallback for iOS/Android
- 24/7 events sorted to bottom of list

**Live demo**: Browse events at `http://localhost:3000/` after starting the server.

## Table of Contents

- [Features](#features)
- [Architecture](#architecture)
- [Quick Start](#quick-start)
- [API Reference](#api-reference)
- [Frontend UI](#frontend-ui)
- [How Decryption Works](#how-decryption-works)
- [Code Map](#code-map)
- [Configuration](#configuration)
- [Mobile Support](#mobile-support)
- [Disclaimer](#disclaimer)

## Features

- **Event Browser UI** — Browse all ppv.st live events with filtering by category and text search
- **Substream Selection** — Pick from multiple broadcast sources (FOX, BBC, DAZN, etc.) for each event
- **Real-time Status** — LIVE, SOON, and DONE badges based on event timestamps
- **In-Browser Playback** — HLS.js integration for Chrome/Firefox/Edge playback
- **Export Commands** — Copy direct URLs or VLC/MPV commands for external players
- **Responsive Design** — Two-column layout on wide screens, mobile-optimized on tablets/phones
- **Mobile Clipboard** — Fallback copy mechanism for iOS Safari and Android Chrome

## Architecture

### Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                    Browser UI (port 3000)                       │
│  ┌──────────────┐  ┌─────────────┐  ┌────────────────────────┐  │
│  │ Event List   │→ │ Source Pick │→ │ Video Player + Export  │  │
│  │ + Filters    │  │ (substreams)│  │ (VLC/MPV commands)     │  │
│  └──────────────┘  └─────────────┘  └────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────────┐
│                    Backend API (Node.js)                        │
│  POST /api/stream  — resolve ppv.st URL → embed → HLS           │
│  POST /api/embed   — resolve embed URL directly (substreams)    │
│  GET  /api/hls     — proxy HLS playlist + segments              │
└─────────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────────┐
│                    External Services                            │
│  api.ppv.st       — event index + substreams metadata           │
│  embedindia.st    — /fetch handshake + WASM decrypt             │
│  CDN (indianservers.st, etc.) — actual .m3u8 + .ts segments     │
└─────────────────────────────────────────────────────────────────┘
```

### Request Flow

1. **User opens browser** → Frontend fetches `https://api.ppv.s../api/streams`
2. **User clicks event** → Shows substream picker (default + all substreams)
3. **User selects source** → Calls `POST /api/embed` with iframe URL
4. **Backend decrypts** → `/fetch` handshake → WASM → HLS URL
5. **Frontend plays** → HLS.js loads proxied URL or user copies to VLC/MPV

## Quick Start

### Prerequisites

- Node.js 18+ (native `fetch` required)
- npm or pnpm

### Installation

```bash
cd ppv-hls-stream-resolver
npm install
npm start
```

Server starts on `http://localhost:3000/` (or port from `PORT` env var).

### Usage

1. Open `http://localhost:3000/` in your browser
2. Filter events by category or search text
3. Click an event to see available sources (broadcasters)
4. Select a source to play in-browser
5. Use **Copy** buttons for VLC/MPV or share URLs

### Mobile Usage

On mobile devices:
- The UI adapts to a single-column layout
- Copy buttons use `document.execCommand('copy')` fallback (selects text for manual copy)
- Video player uses native HLS on Safari, HLS.js on Android Chrome

## API Reference

### `POST /api/stream`

Resolve a ppv.st live URL (uses default embed source from API metadata).

**Request:**
```json
{
  "url": "https://ppv.s../l../wc/2026-07-02/p..."
}
```

**Response (200 OK):**
```json
{
  "ok": true,
  "uri": "wc/2026-07-02/...o",
  "contentPath": "/live/wc/2026-07-02/...",
  "streamUrl": "https://cdn.example/secure/.../index.m3u8",
  "proxiedUrl": "http://localhost:3000/api/hls?url=...&embed=...&embedOrigin=..."
}
```

**Response (error):**
```json
{
  "ok": false,
  "stage": "meta",
  "error": "upstream 404",
  "uri": "...",
  "contentPath": "..."
}
```

**Stages:** `input`, `meta`, `source`, `decrypt`

---

### `POST /api/embed` (NEW)

Resolve an embed URL directly (used for substreams).

**Request:**
```json
{
  "iframe": "https://embedindia.s../embed/wc/2026-07-02/por-cro/fox"
}
```

**Response:**
```json
{
  "ok": true,
  "streamUrl": "https://cdn.example/secure/.../FOX/index.m3u8",
  "proxiedUrl": "http://localhost:3000/api/hls?url=...&embed=...&embedOrigin=...",
  "embed": "wc/2026-07-02/por-cro/fox",
  "embedOrigin": "https://embedindia.s.."
}
```

**Use case:** Substreams have their own embed URLs in the index API — use this endpoint instead of `/api/stream` which only handles default sources.

---

### `GET /api/hls`

Proxy HLS playlists and segments through your server.

**Query parameters:**

| Parameter     | Required | Description                              |
|---------------|----------|------------------------------------------|
| `url`         | yes      | Absolute upstream URL (M3U8 or .ts)      |
| `embed`       | yes      | Embed path from resolve response         |
| `embedOrigin` | yes      | Embed origin from resolve response       |

**Response:**
- `application/vnd.apple.mpegurl` for M3U8 playlists (rewritten)
- `video/mp2t` for TS segments
- `502` plain text on upstream failure

**CORS:** All endpoints return `Access-Control-Allow-Origin: *`

## Frontend UI

### Layout

**Wide screens (≥1200px):**
- **Left column:** Event browser (sticky, scrollable)
- **Right column:** Video player + export section (sticky)

**Mobile/tablet (<1200px):**
- Single-column stacked layout
- Events → Source picker → Player (full width)

### Event Browser

Displays events with:
- **Status badges:** ●LIVE (orange), SOON (amber), DONE (grey), 24/7 (green)
- **Event name, source, start time, category**
- **Substream count:** Shows "+N more" for events with additional sources
- **Filter by category** dropdown
- **Text search** (filters in real-time)

### Source Picker

When you click an event:
- Events list collapses
- Shows all available sources (default + substreams)
- Each source displays:
  - Broadcaster name (FOX, BBC One, DAZN Spain, etc.)
  - Locale (en, en-GB, es, etc.)
  - "default" badge for primary source
- Click a source to play

### Export Section

After selecting a source, shows:
- **Direct URL:** Upstream M3U8 (for VLC/MPV)
- **Proxied URL:** Stream through this server (for browser)
- **VLC:** `vlc <url>` command
- **MPV:** `mpv <url>` command

All with **Copy** buttons (mobile-aware).

## How Decryption Works

### 1. Embed Source Extraction

From API metadata:
```
https://embedindia.s../embed/wc/2026-07-02/por-cro
→ { origin: "https://embedindia.s..", path: "wc/2026-07-02/por-cro" }
```

### 2. `/fetch` Handshake

```
POST {origin}/fetch
Content-Type: application/octet-stream
Origin: {origin}
Referer: {origin}/embed/{path}
Body: length-prefixed protobuf encoding of {path}
```

Response includes:
- `island` header (session key)
- Binary protobuf body

### 3. WASM Decryption (`gasm.wasm`)

- Runs in `happy-dom` sandbox with stubbed `jwplayer`, `fetch`
- `set_stream_jw(island, body)` modifies WASM memory
- Playlist URL extracted by scanning memory for:
  ```
  https://{host}/secure/{...}index.m3u8
  ```
- Slug from protobuf used to select correct URL when multiple exist

### 4. Relay/Proxy

The resolved M3U8 works in VLC/MPV directly. Browser playback requires proxying:

- **M3U8 rewrite:** All media URIs mapped back to `/api/hls?...`
- **Segment proxy:** Strips non-TS wrapper bytes, returns `video/mp2t`
- **CORS:** Adds headers for browser access

## Code Map

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

## Configuration

### Environment Variables

| Variable | Default | Description                    |
|----------|---------|--------------------------------|
| `PORT`   | `3000`  | HTTP listen port               |
| `HOST`   | all     | Bind address (e.g., `127.0.0.1`) |

### API Domain Failover

The backend automatically tries alternative API domains if the primary fails:

**Failover order:**
1. `api.ppv.s..` (primary)
2. `api.ppv.c..`
3. `api.ppv.t..`
4. `api.ppv.i..`
5. `api.ppv.l..`

Each API request independently walks the failover chain. The response includes `resolvedFrom` to show which domain succeeded.

**Frontend failover:** The browser UI also implements the same failover chain when fetching the event index. The active domain is logged to the browser console.

**Hardcoded in:** `src/env.js` (`API_DOMAINS` array)

### User Agent

Set in `src/env.js` — mimics Chrome on macOS to avoid bot detection.

## Mobile Support

### Copy Button Fallback

Mobile browsers (especially iOS Safari) may block `navigator.clipboard.writeText()`.

**Fallback flow:**
1. Try `navigator.clipboard.writeText()`
2. On failure: select text in input + `document.execCommand('copy')`
3. User sees text selected + can tap "Copy" from context menu

### Layout Adaptations

- Single-column on screens < 1200px
- Touch-friendly button sizes
- Video player uses native controls
- Filter/category inputs use mobile keyboard types

### HLS Playback

- **iOS Safari:** Native HLS in `<video>` element
- **Android Chrome:** HLS.js falls back to native if needed
- **Desktop Chrome/Firefox:** HLS.js required (included)

## Disclaimer

This project:
- Does **not** host, store, or distribute media content
- Only reads **public API metadata** from ppv.st
- Calls embed endpoints the same way a browser player would
- Proxies streams for browser compatibility (like a CORS proxy)

**You are responsible for:**
- Complying with copyright law in your jurisdiction
- Respecting site terms of service
- Using only on content you have the right to access

**No warranty.** Use at your own risk.
