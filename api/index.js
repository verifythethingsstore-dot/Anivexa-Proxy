export const config = { runtime: 'edge' };

export default async function handler(req) {
  const url = new URL(req.url);
  const proxyBase = url.origin + '/api/proxy';

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }

  if (!url.searchParams.has('url')) {
    return new Response(JSON.stringify({ status: 'ok', time: Date.now() }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...corsHeaders() }
    });
  }

  const parsed = parseParams(req.url);
  if (!parsed || !parsed.targetUrl) {
    return new Response(JSON.stringify({ error: 'Missing or invalid target url' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', ...corsHeaders() }
    });
  }

  const { targetUrl, referer, origin } = parsed;
  const headers = browserHeaders(targetUrl, referer, origin, req.headers);

  let upstreamResp;
  try {
    upstreamResp = await fetch(targetUrl, {
      method: req.method === 'HEAD' ? 'HEAD' : 'GET',
      headers,
      redirect: 'follow'
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: 'Upstream request failed', detail: String(err) }), {
      status: 502,
      headers: { 'Content-Type': 'application/json', ...corsHeaders() }
    });
  }

  const status = upstreamResp.status;
  const contentType = (upstreamResp.headers.get('Content-Type') || '').toLowerCase();
  const isM3u8 = contentType.includes('mpegurl') || contentType.includes('x-mpegurl') || targetUrl.split('?')[0].endsWith('.m3u8');
  const isMpd = contentType.includes('dash+xml') || targetUrl.split('?')[0].endsWith('.mpd');

  if (req.method === 'HEAD') {
    const h = {
      'Content-Type': upstreamResp.headers.get('Content-Type') || 'application/octet-stream',
      ...corsHeaders()
    };
    const cl = upstreamResp.headers.get('Content-Length');
    if (cl) h['Content-Length'] = cl;
    const ar = upstreamResp.headers.get('Accept-Ranges');
    if (ar) h['Accept-Ranges'] = ar;
    return new Response(null, { status, headers: h });
  }

  if (isM3u8) {
    const text = await upstreamResp.text();
    if (isPlaylistContent(text)) {
      const rewritten = rewriteM3u8(text, targetUrl, referer, proxyBase);
      return new Response(rewritten, {
        status,
        headers: { 'Content-Type': 'application/vnd.apple.mpegurl', 'Cache-Control': 'no-cache', ...corsHeaders() }
      });
    }
    return new Response(text, {
      status,
      headers: { 'Content-Type': upstreamResp.headers.get('Content-Type') || 'text/html', ...corsHeaders() }
    });
  }

  if (isMpd) {
    const text = await upstreamResp.text();
    if (text.includes('<MPD') || text.includes('manifest')) {
      const rewritten = rewriteMpd(text, targetUrl, referer, proxyBase);
      return new Response(rewritten, {
        status,
        headers: { 'Content-Type': 'application/dash+xml', 'Cache-Control': 'no-cache', ...corsHeaders() }
      });
    }
    return new Response(text, {
      status,
      headers: { 'Content-Type': upstreamResp.headers.get('Content-Type') || 'text/xml', ...corsHeaders() }
    });
  }

  const passHeaders = {
    'Content-Type': upstreamResp.headers.get('Content-Type') || 'application/octet-stream',
    'Cache-Control': upstreamResp.headers.get('Cache-Control') || 'public, max-age=86400',
    ...corsHeaders()
  };
  const cl = upstreamResp.headers.get('Content-Length');
  if (cl) passHeaders['Content-Length'] = cl;
  const cr = upstreamResp.headers.get('Content-Range');
  if (cr) passHeaders['Content-Range'] = cr;
  const ar = upstreamResp.headers.get('Accept-Ranges');
  if (ar) passHeaders['Accept-Ranges'] = ar;

  return new Response(upstreamResp.body, { status, headers: passHeaders });
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS, POST',
    'Access-Control-Allow-Headers': '*',
    'Access-Control-Expose-Headers': '*',
  };
}

function parseParams(reqUrl) {
  const urlObj = new URL(reqUrl);
  let rawUrl = urlObj.searchParams.get('url');
  let rawRef = urlObj.searchParams.get('ref') || urlObj.searchParams.get('referer');
  if (!rawUrl) return null;
  try { rawUrl = decodeURIComponent(rawUrl); } catch (_) {}
  if (rawRef) { try { rawRef = decodeURIComponent(rawRef); } catch (_) {} }
  if (rawUrl.includes('|')) {
    const parts = rawUrl.split('|');
    rawUrl = parts[0].trim();
    if (!rawRef && parts[1]) rawRef = parts[1].trim();
  }
  if (!/^https?:\/\//i.test(rawUrl)) rawUrl = 'https://' + rawUrl;
  let referer = rawRef || null;
  let origin = null;
  if (referer) {
    if (!/^https?:\/\//i.test(referer)) referer = 'https://' + referer;
    try { origin = new URL(referer).origin; } catch (_) { referer = null; }
  }
  if (!origin) {
    try {
      const t = new URL(rawUrl);
      origin = t.origin;
      if (!referer) referer = t.origin + '/';
    } catch (_) {}
  }
  return { targetUrl: rawUrl, referer, origin };
}

function getSecSite(targetUrl, referer) {
  try {
    const tHost = new URL(targetUrl).hostname.toLowerCase();
    const rHost = referer ? new URL(referer).hostname.toLowerCase() : tHost;
    if (tHost === rHost) return 'same-origin';
    if (tHost.split('.').slice(-2).join('.') === rHost.split('.').slice(-2).join('.')) return 'same-site';
    return 'cross-site';
  } catch (_) { return 'cross-site'; }
}

function browserHeaders(targetUrl, referer, origin, requestHeaders) {
  const tHost = new URL(targetUrl).hostname;
  const h = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    'Accept': '*/*',
    'Accept-Language': 'en-US,en;q=0.9',
    'Referer': referer || `https://${tHost}/`,
    'Origin': origin || `https://${tHost}`,
    'Sec-Fetch-Dest': 'empty',
    'Sec-Fetch-Mode': 'cors',
    'Sec-Fetch-Site': getSecSite(targetUrl, referer),
    'Sec-CH-UA': '"Not/A)Brand";v="8", "Chromium";v="126", "Google Chrome";v="126"',
    'Sec-CH-UA-Mobile': '?0',
    'Sec-CH-UA-Platform': '"Windows"',
  };
  if (requestHeaders) {
    const range = requestHeaders.get('Range') || requestHeaders.get('range');
    if (range) h['Range'] = range;
  }
  return h;
}

function resolveUrl(rel, base) {
  if (/^https?:\/\//i.test(rel)) return rel;
  try { return new URL(rel, base).href; } catch (_) { return rel; }
}

function isPlaylistContent(text) {
  const t = text.trim();
  return t.startsWith('#EXTM3U') || t.includes('#EXT-X-STREAM-INF') || t.includes('#EXT-X-TARGETDURATION');
}

function rewriteM3u8(text, baseUrl, referer, proxyBase) {
  return text.split(/\r?\n/).map(line => {
    const t = line.trim();
    if (t.startsWith('#') && t.includes('URI="')) {
      return t.replace(/URI="([^"]+)"/g, (m, p1) => {
        const abs = resolveUrl(p1, baseUrl);
        return `URI="${proxyBase}?url=${encodeURIComponent(abs)}${referer ? '&ref=' + encodeURIComponent(referer) : ''}"`;
      });
    }
    if (t && !t.startsWith('#')) {
      const abs = resolveUrl(t, baseUrl);
      return `${proxyBase}?url=${encodeURIComponent(abs)}${referer ? '&ref=' + encodeURIComponent(referer) : ''}`;
    }
    return line;
  }).join('\n');
}

function rewriteMpd(text, baseUrl, referer, proxyBase) {
  let r = text.replace(/<BaseURL>([^<]+)<\/BaseURL>/g, (m, p1) => {
    const abs = resolveUrl(p1.trim(), baseUrl);
    return `<BaseURL>${proxyBase}?url=${encodeURIComponent(abs)}${referer ? '&ref=' + encodeURIComponent(referer) : ''}</BaseURL>`;
  });
  r = r.replace(/(initialization|media|sourceURL|manifestURL)="([^"]+)"/g, (m, attr, p1) => {
    const abs = resolveUrl(p1, baseUrl);
    return `${attr}="${proxyBase}?url=${encodeURIComponent(abs)}${referer ? '&ref=' + encodeURIComponent(referer) : ''}"`;
  });
  return r;
}
