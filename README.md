# Anivexa-Proxy

Dynamic CORS proxy and media stream rewriter for HLS (`.m3u8`), DASH (`.mpd`), MP4, and `.ts` segments. Zero dependencies. No hardcoded CDN lists. Built on Web Standard APIs.

run it yourself:

```bash
node proxy.js
```

Defaults to port `8080`. Set `PORT` env variable to change it.

For Cloudflare Workers via Wrangler:

```bash
npx wrangler deploy proxy.js --name anivexa-proxy
```

---

## Usage

### Piped syntax

Target URL and referer separated by `|`:

```
/proxy?url=https://cdn.example.com/stream/master.m3u8|https://referer-site.com/
```

### Query parameter syntax

```
/proxy?url=https://cdn.example.com/stream/master.m3u8&ref=https://referer-site.com/
```

If no referer is provided, defaults to the target URL's origin.

---

## What it does

- Fetches any upstream URL with spoofed browser headers (`Referer`, `Origin`, `User-Agent`, `Sec-Fetch-*`).
- Detects `.m3u8` playlists and rewrites all segment URLs, variant stream URLs, and `#EXT-X-KEY URI=` entries back through the proxy.
- Detects `.mpd` manifests and rewrites `<BaseURL>`, `initialization`, `media`, and `sourceURL` attributes.
- Forwards `Range` headers for MP4 seeking (`206 Partial Content`).
- Returns proper CORS headers on every response.
- Passes through error pages from upstream without corrupting them.

---

## Endpoints

| Route | Method | Description |
|---|---|---|
| `/health` | GET | Returns `{"status":"ok"}` |
| `/proxy` | GET | Proxy endpoint, requires `?url=` parameter |
| `*` | OPTIONS | CORS preflight, returns `204` |

---

## Runs on

- Cloudflare Workers
- Vercel Edge Functions
- Deno
- Bun
- Node.js (v18+)

