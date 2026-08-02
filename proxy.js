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
  
  if (!rawUrl) {
    const fullSearch = urlObj.search;
    if (fullSearch.startsWith('?')) {
      const query = fullSearch.substring(1);
      if (query.startsWith('http://') || query.startsWith('https://')) {
        rawUrl = query;
      }
    }
  }

  if (!rawUrl) return null;

  try { rawUrl = decodeURIComponent(rawUrl); } catch (_) {}
  if (rawRef) {
    try { rawRef = decodeURIComponent(rawRef); } catch (_) {}
  }

  if (rawUrl.includes('|')) {
    const parts = rawUrl.split('|');
    rawUrl = parts[0].trim();
    if (!rawRef && parts[1]) {
      rawRef = parts[1].trim();
    }
  }

  if (!/^https?:\/\//i.test(rawUrl)) {
    rawUrl = 'https://' + rawUrl;
  }

  let referer = rawRef || null;
  let origin = null;

  if (referer) {
    if (!/^https?:\/\//i.test(referer)) {
      referer = 'https://' + referer;
    }
    try {
      const refParsed = new URL(referer);
      origin = refParsed.origin;
    } catch (_) {
      referer = null;
    }
  }

  if (!origin) {
    try {
      const targetParsed = new URL(rawUrl);
      origin = targetParsed.origin;
      if (!referer) {
        referer = targetParsed.origin + '/';
      }
    } catch (_) {}
  }

  return { targetUrl: rawUrl, referer, origin };
}

function getSecSite(targetUrl, referer) {
  try {
    const tHost = new URL(targetUrl).hostname.toLowerCase();
    const rHost = referer ? new URL(referer).hostname.toLowerCase() : tHost;
    if (tHost === rHost) return 'same-origin';
    const tParts = tHost.split('.').slice(-2).join('.');
    const rParts = rHost.split('.').slice(-2).join('.');
    if (tParts === rParts) return 'same-site';
    return 'cross-site';
  } catch (_) {
    return 'cross-site';
  }
}

function browserHeaders(targetUrl, referer, origin, requestHeaders) {
  const tHost = new URL(targetUrl).hostname;
  const secSite = getSecSite(targetUrl, referer);
  const h = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    'Accept': '*/*',
    'Accept-Language': 'en-US,en;q=0.9',
    'Referer': referer || `https://${tHost}/`,
    'Origin': origin || `https://${tHost}`,
    'Sec-Fetch-Dest': 'empty',
    'Sec-Fetch-Mode': 'cors',
    'Sec-Fetch-Site': secSite,
    'Sec-CH-UA': '"Not/A)Brand";v="8", "Chromium";v="126", "Google Chrome";v="126"',
    'Sec-CH-UA-Mobile': '?0',
    'Sec-CH-UA-Platform': '"Windows"',
    'Connection': 'keep-alive',
    'Cache-Control': 'no-cache',
    'Pragma': 'no-cache'
  };
  if (requestHeaders) {
    const range = requestHeaders.get('Range') || requestHeaders.get('range');
    if (range) h['Range'] = range;
  }
  return h;
}

function resolveUrl(rel, base) {
  if (/^https?:\/\//i.test(rel)) return rel;
  try {
    return new URL(rel, base).href;
  } catch (_) {
    return rel;
  }
}

function isPlaylistContent(text) {
  const trimmed = text.trim();
  return trimmed.startsWith('#EXTM3U') || trimmed.includes('#EXT-X-STREAM-INF') || trimmed.includes('#EXT-X-TARGETDURATION');
}

function rewriteM3u8(text, baseUrl, referer, proxyBase) {
  const lines = text.split(/\r?\n/);
  const out = lines.map(line => {
    const trimmed = line.trim();
    if (trimmed.startsWith('#') && trimmed.includes('URI="')) {
      return trimmed.replace(/URI="([^"]+)"/g, (match, p1) => {
        const abs = resolveUrl(p1, baseUrl);
        const pUrl = `${proxyBase}?url=${encodeURIComponent(abs)}${referer ? '&ref=' + encodeURIComponent(referer) : ''}`;
        return `URI="${pUrl}"`;
      });
    }
    if (trimmed && !trimmed.startsWith('#')) {
      const abs = resolveUrl(trimmed, baseUrl);
      return `${proxyBase}?url=${encodeURIComponent(abs)}${referer ? '&ref=' + encodeURIComponent(referer) : ''}`;
    }
    return line;
  });
  return out.join('\n');
}

function rewriteMpd(text, baseUrl, referer, proxyBase) {
  let result = text.replace(/<BaseURL>([^<]+)<\/BaseURL>/g, (match, p1) => {
    const abs = resolveUrl(p1.trim(), baseUrl);
    const pUrl = `${proxyBase}?url=${encodeURIComponent(abs)}${referer ? '&ref=' + encodeURIComponent(referer) : ''}`;
    return `<BaseURL>${pUrl}</BaseURL>`;
  });
  result = result.replace(/(initialization|media|sourceURL|manifestURL)="([^"]+)"/g, (match, attr, p1) => {
    const abs = resolveUrl(p1, baseUrl);
    const pUrl = `${proxyBase}?url=${encodeURIComponent(abs)}${referer ? '&ref=' + encodeURIComponent(referer) : ''}`;
    return `${attr}="${pUrl}"`;
  });
  return result;
}

async function handleRequest(request) {
  const reqUrl = new URL(request.url);
  const proxyBase = reqUrl.origin + reqUrl.pathname;

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }

  if (reqUrl.pathname === '/health' || (reqUrl.pathname === '/' && !reqUrl.searchParams.has('url'))) {
    return new Response(JSON.stringify({ status: 'ok', time: Date.now() }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...corsHeaders() }
    });
  }

  const parsed = parseParams(request.url);
  if (!parsed || !parsed.targetUrl) {
    return new Response(JSON.stringify({ error: 'Missing or invalid target url' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', ...corsHeaders() }
    });
  }

  const { targetUrl, referer, origin } = parsed;
  const headers = browserHeaders(targetUrl, referer, origin, request.headers);

  let upstreamResp;
  try {
    upstreamResp = await fetch(targetUrl, {
      method: request.method === 'HEAD' ? 'HEAD' : 'GET',
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

  if (request.method === 'HEAD') {
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
        headers: {
          'Content-Type': 'application/vnd.apple.mpegurl',
          'Cache-Control': 'no-cache',
          ...corsHeaders()
        }
      });
    }
    return new Response(text, {
      status,
      headers: {
        'Content-Type': upstreamResp.headers.get('Content-Type') || 'text/html',
        ...corsHeaders()
      }
    });
  }

  if (isMpd) {
    const text = await upstreamResp.text();
    if (text.includes('<MPD') || text.includes('manifest')) {
      const rewritten = rewriteMpd(text, targetUrl, referer, proxyBase);
      return new Response(rewritten, {
        status,
        headers: {
          'Content-Type': 'application/dash+xml',
          'Cache-Control': 'no-cache',
          ...corsHeaders()
        }
      });
    }
    return new Response(text, {
      status,
      headers: {
        'Content-Type': upstreamResp.headers.get('Content-Type') || 'text/xml',
        ...corsHeaders()
      }
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

export default {
  async fetch(request, env, ctx) {
    return handleRequest(request);
  }
};

if (typeof process !== 'undefined' && process.release && process.release.name === 'node') {
  import('node:http').then(({ createServer }) => {
    const PORT = process.env.PORT || 8080;
    const server = createServer(async (req, res) => {
      const fullUrl = `http://${req.headers.host || '127.0.0.1:' + PORT}${req.url}`;
      const reqHeaders = new Headers();
      for (const [k, v] of Object.entries(req.headers)) {
        if (v) reqHeaders.set(k, Array.isArray(v) ? v.join(', ') : v);
      }
      const webReq = new Request(fullUrl, {
        method: req.method,
        headers: reqHeaders
      });
      const webResp = await handleRequest(webReq);
      res.statusCode = webResp.status;
      webResp.headers.forEach((val, key) => {
        res.setHeader(key, val);
      });
      if (webResp.body) {
        const reader = webResp.body.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          res.write(value);
        }
      }
      res.end();
    });
    server.listen(PORT, () => {
      console.log(`Proxy server listening on port ${PORT}`);
    });
  }).catch(() => {});
}
