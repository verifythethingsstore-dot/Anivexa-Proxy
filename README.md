# Anivexa Universal Stream Proxy (Cloudflare Pages & Workers)

High-performance, zero-bandwidth-drain M3U8 (HLS) and MP4 video streaming proxy built for Cloudflare Pages Functions and Workers.

Optimized specifically for **Reanime (FlixCloud)**, **Anikoto (MegaPlay/MegaCloud)**, **Animegg (Direct MP4)**, and generic anime video hosts.

---

## 🚀 Key Features

* **Unlimited Bandwidth:** Cloudflare does not charge for egress bandwidth. Saves your VPS bandwidth completely.
* **FlixCloud Manifest Decryption:** Automatically decrypts Base64 + XOR encrypted master and child `.m3u8` playlists using the provided `key`.
* **Disguised Segment Unwrapping:** Automatically strips fake `.png` / `.webp` headers and XOR-decrypts video/audio segments into standard **MPEG-TS (Sync byte `0x47`)** streams.
* **Dual Audio/Video Sync:** Handles separate video (`video.m3u8`) and multi-audio (`audio/native.m3u8`) playlist groups cleanly.
* **Direct MP4 Streaming:** Full support for byte-range requests (`Range: bytes=...`, `HTTP 206 Partial Content`) for instant seeking and smooth playback.
* **Automatic Referer & Origin Spoofing:** Auto-detects target hosts (`reanime.to`, `flixcloud.cc`, `anikototv.to`, `hianimes.re`, `animegg.org`, `vidcache.net`) or accepts custom headers.
* **Cloudflare Edge Caching:**
  * Uses Cloudflare Cache API (`caches.default`)
  * Media segments are cached for 1 year (`s-maxage=31536000, immutable`)
  * VOD playlists are cached for 2 hours (`s-maxage=7200`)
  * Second and subsequent viewers get instant playback directly from Cloudflare's nearest CDN Edge server.
* **Built-in Web Test Player:** Built directly into `_worker.js` with Hls.js and quick anime loader.

---

## 📦 Project Structure

```
proxy/
├── _worker.js     # Universal Cloudflare Pages & Worker script
├── worker.js      # Re-export for standard Cloudflare Worker deployments
├── wrangler.toml  # Wrangler configuration
└── README.md      # Documentation & deployment guide
```

---

## 🛠️ How to Deploy to Cloudflare Pages

### Option 1: Direct Deploy from Terminal (Recommended)

Run the following command from your project root:

```bash
npx wrangler pages deploy proxy --project-name=anivexa-proxy
```

1. If you are not logged in, Wrangler will open your browser to authorize with your Cloudflare account.
2. Select `Y` to create a new Pages project when prompted.
3. Once finished, you will receive a live URL:
   `https://anivexa-proxy.pages.dev`

---

### Option 2: Continuous Deployment via GitHub

1. Push your repository to **GitHub**.
2. Go to [Cloudflare Dashboard](https://dash.cloudflare.com/) → **Workers & Pages** → **Create application**.
3. Select **Pages** → **Connect to Git** and choose your repository.
4. Set the build configurations:
   * **Project name:** `anivexa-proxy`
   * **Production branch:** `main`
   * **Framework preset:** `None`
   * **Build command:** *(Leave empty)*
   * **Build output directory:** `proxy`
5. Click **Save and Deploy**.

---

## 📖 Query Parameters Reference

| Parameter | Type | Required | Description |
|---|---|---|---|
| `url` | `string` | **Yes** | Target stream URL (M3U8 playlist or MP4 link). Can be plain URL or prefixed with `b64:` |
| `ref` / `referer` | `string` | Optional | Custom HTTP `Referer` header to send upstream (Auto-detected if omitted) |
| `key` / `playlist_key` | `string` | Optional | Base64 decryption key for Reanime / FlixCloud encrypted playlists |
| `origin` | `string` | Optional | Custom HTTP `Origin` header |
| `ua` | `string` | Optional | Custom User-Agent header |
| `raw` | `boolean` | Optional | Set `raw=true` to force raw M3U8 text response even when opened directly in a web browser |

---

## 💡 Usage Examples

### 1. Reanime (FlixCloud XOR Encrypted)
```text
https://anivexa-proxy.pages.dev/?url=https%3A%2F%2Ffetch8.flixcloud.cc%2F_v7%2F...%2Fmaster.m3u8&ref=https%3A%2F%2Fflixcloud.cc%2F&key=VxTj7nxvuWLVckZi6HU%2BrRTJ1kir2ko0M6DheyDkS68%3D
```

### 2. Anikoto (MegaPlay / MegaCloud / HiAnime)
```text
https://anivexa-proxy.pages.dev/?url=https%3A%2F%2Ffetch.nexabloom.top%2Fanime%2F...%2Fmaster.m3u8&ref=https%3A%2F%2Fhianimes.re%2F
```

### 3. Animegg (Direct MP4 Streaming)
```text
https://anivexa-proxy.pages.dev/?url=https%3A%2F%2Fwww.animegg.org%2Fplay%2F67942%2Fvideo.mp4%3Ffor%3D101790256840059&ref=https%3A%2F%2Fwww.animegg.org%2F
```

---

## 🎬 Frontend Player Integration

### Using Hls.js (HTML5)
```html
<video id="player" controls playsinline></video>
<script src="https://cdn.jsdelivr.net/npm/hls.js@latest"></script>
<script>
  const video = document.getElementById("player");
  const streamUrl = "https://anivexa-proxy.pages.dev/?url=" + encodeURIComponent(m3u8Url) + "&ref=" + encodeURIComponent(referer) + "&key=" + encodeURIComponent(key);

  if (streamUrl.includes(".mp4")) {
    video.src = streamUrl;
  } else if (Hls.isSupported()) {
    const hls = new Hls({ enableWorker: true });
    hls.loadSource(streamUrl);
    hls.attachMedia(video);
  } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
    video.src = streamUrl;
  }
</script>
```

### Using Video.js
```javascript
const player = videojs("my-video");
player.src({
  src: "https://anivexa-proxy.pages.dev/?url=" + encodeURIComponent(streamUrl) + "&ref=" + encodeURIComponent(ref) + "&key=" + encodeURIComponent(key),
  type: streamUrl.includes(".mp4") ? "video/mp4" : "application/x-mpegURL"
});
```
